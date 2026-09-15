"""Audit/select source files for a separate publishing checkout; never commit/push.

Run without --apply first. Files omitted by this allowlist remain untouched in
the publishing checkout, preserving upstream assets and licenses. No removals
are inferred from a missing local file. Audit receipts stay in .cache locally.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

BASE_COMMIT = "0a797c3ec4abdc744820c2124a2344b8f57ed6d2"
BRANCH = "codex/0.18.10-studio-fixes"
TOP = {".gitignore", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE.md",
       "README.md", "ROADMAP.md", "platformio.ini"}
SOURCE_DIRS = {"src", "web", "include", "wasm", "PrusaSlicer", "test", ".github", "docs"}
BLOCKED_PARTS = {".git", ".cache", ".pio", "research", "release", "__pycache__", "node_modules", ".claude", ".vscode"}
CODE_EXT = {".py", ".js", ".mjs", ".cjs", ".ps1", ".cpp", ".h", ".hpp", ".ino",
            ".html", ".css", ".md", ".json", ".yml", ".yaml", ".sh", ".ini", ".txt", ".patch", ".svg"}
SECRET = re.compile(r"github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|"
                    r"msy_[A-Za-z0-9_-]{28,}|sk-[A-Za-z0-9_-]{28,}|"
                    r"AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
MACHINE_PATH = re.compile(r"[A-Za-z]:[/\\]+Users[/\\]+[^/\\\s'\"]+")


def git(target, *args):
    result = subprocess.run(["git", "-C", str(target), *args], check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.stdout.decode("utf-8", "replace")


def selected(rel, tracked):
    parts = Path(rel).parts
    if any(p in BLOCKED_PARTS for p in parts):
        return False
    if rel == "src/dashboard_html_gz.h" or rel.endswith(".ino.cpp"):
        return False
    if rel in TOP:
        return True
    if parts[0] in SOURCE_DIRS:
        return Path(rel).suffix.lower() in CODE_EXT or rel in tracked
    if parts[0] == "lib":
        return rel in tracked  # preserve checked-in dependencies; no downloaded additions
    if parts[0] == "scripts":
        if len(parts) == 2:
            return Path(rel).suffix.lower() in CODE_EXT
        if parts[1] == "tests":
            return Path(rel).suffix.lower() in CODE_EXT
        if parts[1] == "dev":
            # Include existing public developer tools and new test harnesses.
            # Personal live-printer verification/render scripts are excluded.
            return rel in tracked or (len(parts) == 3 and Path(rel).name.startswith(("test_", "browser_"))
                                      and Path(rel).suffix.lower() in CODE_EXT)
    return False


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--target", type=Path)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    source = args.source.resolve()
    target = (args.target or source.parent / "tinymaker_publish").resolve()
    if target == source or source in target.parents or target in source.parents:
        ap.error("Use a separate sibling checkout, never an overlapping source directory")
    if not (target / ".git").exists():
        ap.error("Target must already be the prepared Git checkout")
    branch = git(target, "branch", "--show-current").strip()
    if branch != BRANCH:
        ap.error("Target must be on " + BRANCH)
    git(target, "merge-base", "--is-ancestor", BASE_COMMIT, "HEAD")
    remote = git(target, "remote", "get-url", "origin").strip()
    if remote.lower().removesuffix(".git") != "https://github.com/deadlysin777/tinymakerwifi":
        ap.error("Unexpected publishing remote")
    if git(target, "diff", "--cached", "--name-only").strip():
        ap.error("The checkout has staged changes; inspect them before syncing")
    tracked = set(git(target, "ls-files").splitlines())
    changed, unchanged, excluded, secrets, paths, collisions = [], [], [], [], [], []
    previous_path = source / ".cache" / "publish-sync-applied.json"
    previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path.is_file() else {}
    prior_hashes = {item["path"]: item["sha256"] for item in previous.get("changed", []) + previous.get("unchanged", [])}
    modified = set(git(target, "diff", "--name-only").splitlines())
    modified.update(git(target, "ls-files", "--others", "--exclude-standard").splitlines())
    payloads = []
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(source).as_posix()
        if not selected(rel, tracked):
            excluded.append(rel)
            continue
        if path.is_symlink():
            raise SystemExit("Refusing symbolic-link source: " + rel)
        data = path.read_bytes()
        if b"\0" not in data:
            content = data.decode("utf-8", "replace")
            for lineno, line in enumerate(content.splitlines(), 1):
                if SECRET.search(line):
                    secrets.append({"path": rel, "line": lineno})
                if MACHINE_PATH.search(line):
                    paths.append({"path": rel, "line": lineno})
        dest = target / rel
        if dest.is_symlink():
            raise SystemExit("Refusing symbolic-link destination: " + rel)
        current = dest.read_bytes() if dest.is_file() else None
        record = {"path": rel, "bytes": len(data), "sha256": sha(data)}
        if current == data:
            unchanged.append(record)
        else:
            changed.append(record)
            if rel in modified and (current is None or sha(current) != prior_hashes.get(rel)):
                collisions.append(rel)
            payloads.append((path, dest, sha(data)))
    history_diff = git(target, "diff", "--no-ext-diff", "--no-color", "origin/ours...HEAD")
    history_secrets = [i for i, line in enumerate(history_diff.splitlines(), 1) if line.startswith("+") and SECRET.search(line)]
    report = {"at": datetime.now(timezone.utc).isoformat(), "applied": False,
              "branch": branch, "origin": remote, "baseCommit": BASE_COMMIT,
              "head": git(target, "rev-parse", "HEAD").strip(),
              "changed": changed, "unchanged": unchanged, "excluded": excluded,
              "secretCandidates": secrets, "historySecretDiffLines": history_secrets,
              "machinePathReferences": paths, "checkoutCollisions": collisions,
              "limitations": "Pattern scan is an aid, not proof; browser test harnesses may need local runtime/fixture path overrides."}
    report_dir = source / ".cache"
    report_dir.mkdir(exist_ok=True)
    if args.apply and (secrets or history_secrets or collisions):
        (report_dir / "publish-sync-plan.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        raise SystemExit("Review secret candidates or modified-checkout collisions in .cache/publish-sync-plan.json before applying")
    if args.apply:
        for src, dest, expected in payloads:
            if sha(src.read_bytes()) != expected:
                raise SystemExit("Source changed during sync: " + str(src))
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
        report["applied"] = True
    output = report_dir / ("publish-sync-applied.json" if args.apply else "publish-sync-plan.json")
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"applied": report["applied"], "branch": branch, "changed": len(changed),
                      "unchanged": len(unchanged), "excluded": len(excluded), "secretCandidates": len(secrets),
                      "historySecretCandidates": len(history_secrets), "machinePathReferences": len(paths),
                      "checkoutCollisions": collisions, "report": str(output)}, indent=2))


if __name__ == "__main__":
    main()
