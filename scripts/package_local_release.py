"""Package a locally verified TinyMaker build; this script never flashes a device."""
from pathlib import Path
import hashlib
import json
import shutil
import re
import argparse
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--notes', default='FINISH_NOTES.md')
parser.add_argument('--receipt', action='append', help='Validation path relative to .cache; may be repeated')
args = parser.parse_args()
versions=set(re.findall(r'FIRMWARE_VERSION=\\"([0-9]+\.[0-9]+\.[0-9]+)\\"', (root/'platformio.ini').read_text(encoding='utf-8')))
if len(versions)!=1:
    raise SystemExit('Expected one matching firmware version across the build environments.')
version = versions.pop()
dest = root / 'release' / version
dest.mkdir(parents=True, exist_ok=True)
products = {
    f'TinyMaker-{version}-OTA.bin': root / '.cache/pio-build/tinymaker/firmware.bin',
    f'TinyMaker-{version}-full-USB.bin': root / '.cache/pio-build/tinymaker/firmware-full.bin',
    'README.md': root / args.notes,
}
for name, src in products.items():
    if not src.is_file():
        raise SystemExit(f'Missing release input: {src}')
    shutil.copy2(src, dest / name)

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

source_hashes = {}
for base in ['src', 'web']:
    for p in sorted((root / base).rglob('*')):
        if p.is_file():
            source_hashes[p.relative_to(root).as_posix()] = sha(p)
for rel in ['platformio.ini', 'scripts/inject_git_rev.py', 'scripts/gen_dashboard_gz.py', 'scripts/assemble_dashboard.py']:
    source_hashes[rel] = sha(root / rel)
build_log = root / f'.cache/build-{version}.log'
build_tags = re.findall(r'GIT_REV = (\S+)', build_log.read_text(encoding='utf-8', errors='replace')) if build_log.is_file() else []
receipt_names = args.receipt or ['final-frontend-results.json', 'actual-wasm-result.json', 'browser-actions/upload-result.json', 'browser-color-reference.json']
receipts = {}
for rel in receipt_names:
    src = root / '.cache' / rel
    if args.receipt and not src.is_file():
        raise SystemExit(f'Missing requested validation receipt: {src}')
    if src.is_file():
        out = dest / 'validation' / Path(rel).name
        out.parent.mkdir(exist_ok=True)
        shutil.copy2(src, out)
        receipts[out.relative_to(dest).as_posix()] = {'bytes': out.stat().st_size, 'sha256': sha(out)}
manifest = {
    'product': 'TinyMaker ESP32 printer', 'version': version,
    'packagedAtUtc': datetime.now(timezone.utc).isoformat(),
    'installation': 'See device-installation.json for verified live installation state.',
    'files': {name: {'bytes': (dest / name).stat().st_size, 'sha256': sha(dest / name)} for name in products},
    'build': build_tags[-1] if build_tags else None,
    'validation': receipts,
    'source': source_hashes,
    'provenance': 'Original files recorded in ../../resume-source-manifest.json; source copy retained in workspace.'
}
(dest / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
(dest / 'SHA256SUMS.txt').write_text(''.join(f'{v["sha256"]}  {name}\n' for name, v in manifest['files'].items()), encoding='utf-8')
print(json.dumps({'folder': str(dest), 'files': manifest['files']}, indent=2))
