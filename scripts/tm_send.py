#!/usr/bin/env python3
"""Send a sliced model to the printer over the network - from any slicer.

WHY THIS EXISTS
---------------
PrusaSlicer can already hit "Send to printer" because the firmware answers
enough of the OctoPrint API for it (`/api/version`, `/api/files/local`).
Chitubox and Lychee cannot, and the reason is not the network - it is the file.

The printer prints PNG layer images. An `.sl1` is literally a ZIP of PNGs plus
a `config.ini`, which is why it works. Chitubox exports `.ctb` / `.photon` /
`.pwmx`: proprietary, run-length-encoded, and different between versions. There
is no decoder for those on an ESP32 with 4 MB of flash and no PSRAM, and there
should not be one - chasing format revisions on the printer is a losing game.

So the conversion happens here, on the PC, where UVtools already does it well,
and the printer keeps its one simple contract: hand me a ZIP of PNGs.

WHAT IT DOES
------------
    tm_send.py model.ctb                 convert -> upload
    tm_send.py model.sl1                 upload (already the right shape)
    tm_send.py model.ctb --start         upload, then start the print
    tm_send.py --watch "C:/Chitubox/out" anything exported there is sent

The watch mode is the point: leave it running, slice in Chitubox as usual, hit
export, and the model is on the printer before you have walked over to it.

REQUIREMENTS
------------
Python 3.8+, standard library only - no pip install.
For `.ctb` and friends: UVtools (free, open source) must be installed.
    https://github.com/sn4k3/UVtools
`.sl1` and `.zip` need nothing at all.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

# Formats the printer eats as-is. An .sl1 IS a zip - the extension is the only
# difference, and the firmware looks at the bytes, not the name.
NATIVE = {".sl1", ".zip"}

# Formats UVtools can turn into .sl1. Listed so that an unknown extension gets a
# clear "I don't know this one" instead of a confusing converter error.
CONVERTIBLE = {
    ".ctb", ".cbddlp", ".photon", ".photons", ".phz",
    ".pwmx", ".pwmo", ".pwms", ".pws", ".pw0", ".pwma",
    ".goo", ".lgs", ".lgs30", ".zcode", ".cws",
}

UVTOOLS_HINTS = [
    r"C:\Program Files\UVtools\UVtoolsCmd.exe",
    r"C:\Program Files (x86)\UVtools\UVtoolsCmd.exe",
    "/usr/bin/UVtoolsCmd",
    "/opt/UVtools/UVtoolsCmd",
    os.path.expanduser("~/Applications/UVtools/UVtoolsCmd"),
]


def log(msg):
    print(msg, flush=True)


def die(msg, code=1):
    print(f"error: {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


# --------------------------------------------------------------------------
# conversion
# --------------------------------------------------------------------------

def find_uvtools(explicit=None):
    """Locate UVtoolsCmd, or return None."""
    if explicit:
        return explicit if os.path.isfile(explicit) else None
    found = shutil.which("UVtoolsCmd") or shutil.which("uvtoolscmd")
    if found:
        return found
    for p in UVTOOLS_HINTS:
        if os.path.isfile(p):
            return p
    return None


def convert_to_sl1(src, uvtools, workdir):
    """Run UVtools to turn a proprietary file into .sl1. Returns the new path."""
    out = os.path.join(workdir, os.path.splitext(os.path.basename(src))[0] + ".sl1")
    cmd = [uvtools, "convert", src, "sl1", out]
    log(f"  converting with UVtools: {os.path.basename(src)} -> .sl1")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    except FileNotFoundError:
        die(f"could not run UVtools at {uvtools}")
    except subprocess.TimeoutExpired:
        die("UVtools took longer than 15 minutes - giving up")
    if r.returncode != 0 or not os.path.isfile(out):
        detail = (r.stderr or r.stdout or "").strip()
        die("UVtools could not convert this file.\n"
            f"        command: {' '.join(cmd)}\n"
            f"        said:    {detail[:500] or '(nothing)'}")
    return out


def check_sl1(path):
    """Make sure we are about to upload something the printer can actually use.

    Cheap here, expensive on the printer: a bad archive is minutes of unpacking
    on the ESP32 before it fails, with the user watching a progress bar.
    """
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
    except zipfile.BadZipFile:
        die(f"{os.path.basename(path)} is not a ZIP archive - the printer "
            "prints ZIPs of PNG layers")
    pngs = [n for n in names if n.lower().endswith(".png")]
    if not pngs:
        die(f"{os.path.basename(path)} has no PNG layers in it")
    return len(pngs)


# --------------------------------------------------------------------------
# upload
# --------------------------------------------------------------------------

def multipart(fields, filefield, filename, filebytes):
    """Build a multipart/form-data body. Stdlib has no helper for this."""
    boundary = "----tmsend" + uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f"--{boundary}\r\n".encode()
        out += f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode()
        out += f"{v}\r\n".encode()
    out += f"--{boundary}\r\n".encode()
    out += (f'Content-Disposition: form-data; name="{filefield}"; '
            f'filename="{filename}"\r\n').encode()
    out += b"Content-Type: application/octet-stream\r\n\r\n"
    out += filebytes
    out += f"\r\n--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def post(host, path, fields=None, filefield=None, filename=None,
         filebytes=None, timeout=900):
    url = f"http://{host}{path}"
    if filebytes is not None:
        body, ctype = multipart(fields or {}, filefield, filename, filebytes)
    else:
        body = urllib.parse.urlencode(fields or {}).encode()
        ctype = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", ctype)
    # The firmware's CSRF rule (issue #95): a request with no Origin header is
    # not a browser, and is only allowed through if it carries this one. The
    # upload route does not demand it, but the print-start route does, and
    # sending it everywhere keeps this tool working if that ever tightens.
    req.add_header("X-TinyMaker", "tm_send")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except urllib.error.URLError as e:
        die(f"cannot reach the printer at {host} - {e.reason}\n"
            "        Is it powered on and on the same network? Try its IP "
            "address instead of tinymaker.local.")


def upload(host, path, action, start):
    name = os.path.splitext(os.path.basename(path))[0]
    size = os.path.getsize(path)
    layers = check_sl1(path)
    log(f"  uploading {name}  ({layers} layers, {size/1048576:.1f} MB)")
    log("  the printer unpacks as it receives - this can take a few minutes")

    with open(path, "rb") as f:
        data = f.read()

    code, body = post(host, "/upload",
                      fields={"action": action, "source": "tm_send"},
                      filefield="file",
                      filename=os.path.basename(path),
                      filebytes=data)

    if code == 409 and "conflict" in body:
        die(f'a model called "{name}" is already on the card.\n'
            "        Re-run with --action replace to overwrite it, "
            "or --action rename to keep both.")
    if code == 409:
        die("the printer is busy - it will not accept a model mid-print")
    if code == 503:
        die("the printer cannot reach its SD card")
    if code >= 400:
        die(f"upload failed (HTTP {code}): {body[:300]}")

    log(f"  done - \"{name}\" is on the printer")

    if start:
        log("  starting the print")
        code, body = post(host, "/api/print/start", fields={"name": name, "force": "1"})
        if code >= 400:
            die(f"uploaded fine, but the print would not start (HTTP {code}): {body[:300]}")
        log("  printing")
    return True


# --------------------------------------------------------------------------
# one file, end to end
# --------------------------------------------------------------------------

def send(path, host, action, start, uvtools_path):
    ext = os.path.splitext(path)[1].lower()
    log(f"\n{os.path.basename(path)}")

    if ext in NATIVE:
        return upload(host, path, action, start)

    if ext not in CONVERTIBLE:
        die(f"I don't know the format {ext}.\n"
            f"        Ready to send: {', '.join(sorted(NATIVE))}\n"
            f"        Converted first: {', '.join(sorted(CONVERTIBLE))}")

    uv = find_uvtools(uvtools_path)
    if not uv:
        die(f"{ext} has to be converted first, and UVtools was not found.\n"
            "        Install it from https://github.com/sn4k3/UVtools "
            "(free), or pass --uvtools <path to UVtoolsCmd>.\n"
            "        Or export .sl1 from your slicer instead - Lychee can, "
            "and PrusaSlicer sends straight to the printer with no tool at all.")

    with tempfile.TemporaryDirectory(prefix="tm_send_") as tmp:
        sl1 = convert_to_sl1(path, uv, tmp)
        return upload(host, sl1, action, start)


# --------------------------------------------------------------------------
# watch mode
# --------------------------------------------------------------------------

def watch(folder, host, action, start, uvtools_path, settle=2.0):
    """Send anything new that lands in a folder.

    Point it at the export folder of Chitubox or Lychee and forget about it.
    Files are only picked up once they have stopped growing, so a half-written
    export is never sent.
    """
    if not os.path.isdir(folder):
        die(f"{folder} is not a folder")
    known = {f for f in os.listdir(folder)}
    watched = NATIVE | CONVERTIBLE
    log(f"watching {folder}")
    log(f"sending to {host} - press Ctrl+C to stop\n")
    pending = {}
    try:
        while True:
            time.sleep(1.0)
            try:
                now = set(os.listdir(folder))
            except OSError:
                continue
            for f in now - known:
                if os.path.splitext(f)[1].lower() in watched:
                    pending[f] = (0, 0.0)
            known = now

            for f in list(pending):
                p = os.path.join(folder, f)
                if not os.path.exists(p):
                    pending.pop(f, None)
                    continue
                size = os.path.getsize(p)
                last_size, stable_since = pending[f]
                if size != last_size:
                    pending[f] = (size, time.time())
                    continue
                if time.time() - stable_since < settle:
                    continue
                pending.pop(f, None)
                try:
                    send(p, host, action, start, uvtools_path)
                except SystemExit:
                    # One bad export should not take the watcher down.
                    log("  skipped - still watching\n")
    except KeyboardInterrupt:
        log("\nstopped")


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Send a sliced model to a TinyMakerWifi printer.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("WHAT IT DOES")[1].split("REQUIREMENTS")[0].strip())
    ap.add_argument("files", nargs="*", help="model file(s) to send")
    ap.add_argument("--printer", default="tinymaker.local",
                    help="printer host or IP (default: tinymaker.local)")
    ap.add_argument("--start", action="store_true",
                    help="start printing once the upload finishes")
    ap.add_argument("--action", choices=["replace", "rename"], default="replace",
                    help="what to do if the name is already on the card")
    ap.add_argument("--watch", metavar="DIR",
                    help="keep running and send anything new in DIR")
    ap.add_argument("--uvtools", metavar="PATH", help="path to UVtoolsCmd")
    a = ap.parse_args()

    if a.watch:
        watch(a.watch, a.printer, a.action, a.start, a.uvtools)
        return
    if not a.files:
        ap.error("give me a file to send, or --watch a folder")
    for f in a.files:
        if not os.path.isfile(f):
            die(f"no such file: {f}")
        send(f, a.printer, a.action, a.start, a.uvtools)


if __name__ == "__main__":
    main()
