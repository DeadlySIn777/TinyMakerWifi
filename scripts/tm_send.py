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
import http.client
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import zlib

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


class BridgeError(RuntimeError):
    def __init__(self, message, retryable=False, uploaded=False):
        super().__init__(message)
        self.retryable = retryable
        self.uploaded = uploaded


def die(msg, code=1):
    raise BridgeError(msg)


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
    # Some UVtools builds return a nonzero status with a complete output.
    # Validate the new file's raster contract before allowing any upload.
    if not os.path.isfile(out) or os.path.getsize(out) == 0:
        detail = (r.stderr or r.stdout or "").strip()
        die("UVtools could not convert this file.\n"
            f"        command: {' '.join(cmd)}\n"
            f"        said:    {detail[:500] or '(nothing)'}")
    return out


MAX_LAYERS = 1200
RESOLUTION = (320, 240)
DISPLAY_MM = (40.8, 30.6)
MAX_ENTRY = 1024 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024


def layer_index(name):
    """Match Import.ino's trailing-digit layer rule, excluding thumbnails."""
    if "thumbnail" in name.lower():
        return None
    match = re.search(r"([0-9]+)\.png$", name.rsplit("/", 1)[-1], re.I)
    return int(match[1]) if match else None


def _ini(data):
    result = {}
    for line in data.decode("utf-8-sig", "replace").splitlines():
        if "=" in line and not line.lstrip().startswith(("#", ";")):
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip()
    return result


def _number(value, label):
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise BridgeError(f"{label} is missing or invalid; export with the TinyMaker 0.05 mm profile")
    if not math.isfinite(result):
        raise BridgeError(f"{label} is not a finite number")
    return result


def _check_png(data, name):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise BridgeError(f"{name} is not a valid PNG layer")
    offset, header, compressed, ended = 8, None, bytearray(), False
    palette = None
    while offset + 12 <= len(data):
        count = struct.unpack_from(">I", data, offset)[0]
        end = offset + 12 + count
        if end > len(data):
            raise BridgeError(f"{name} has a truncated PNG chunk")
        kind = data[offset+4:offset+8]
        payload = data[offset+8:offset+8+count]
        crc = struct.unpack_from(">I", data, offset+8+count)[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            raise BridgeError(f"{name} has a corrupt PNG chunk")
        if header is None and kind != b"IHDR":
            raise BridgeError(f"{name} has no PNG header")
        if kind == b"IHDR":
            if header is not None or count != 13:
                raise BridgeError(f"{name} has an invalid PNG header")
            header = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"PLTE":
            if palette is not None or compressed or not count or count > 768 or count % 3:
                raise BridgeError(f"{name} has an invalid PNG palette")
            palette = payload
        elif kind == b"IEND":
            ended = count == 0 and end == len(data)
            break
        offset = end
    if not header or not ended or not compressed:
        raise BridgeError(f"{name} is incomplete")
    width, height, depth, color, compression, filtering, interlace = header
    if (width, height) != RESOLUTION:
        raise BridgeError(f"{name} is {width}x{height}; TinyMaker requires 320x240 layer images. Re-slice using its printer profile; conversion does not resize safely.")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color)
    if depth != 8 or not channels or compression or filtering or interlace:
        raise BridgeError(f"{name} must be an 8-bit, non-interlaced PNG")
    if color == 3 and palette is None:
        raise BridgeError(f"{name} is indexed but has no PNG palette")
    expected = (width * channels + 1) * height
    decoder = zlib.decompressobj()
    try:
        raw = decoder.decompress(bytes(compressed), expected + 1)
    except zlib.error as exc:
        raise BridgeError(f"{name} has corrupt PNG pixels: {exc}")
    if len(raw) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise BridgeError(f"{name} has incomplete or oversized PNG pixels")
    if any(raw[row * (width * channels + 1)] > 4 for row in range(height)):
        raise BridgeError(f"{name} has invalid PNG scanlines")


def inspect_sl1(path):
    """Validate the actual raster contract, without changing pixels or scale."""
    try:
        if os.path.getsize(path) > MAX_ARCHIVE:
            raise BridgeError("The archive exceeds the bridge's 512 MB limit")
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_LAYERS + 100 or sum(e.file_size for e in entries) > MAX_ARCHIVE:
                raise BridgeError("Archive entries exceed TinyMaker's layer or size limits")
            seen, layers, configs = set(), {}, {}
            for entry in entries:
                name = entry.filename
                parts = name.replace("\\", "/").split("/")
                if name in seen or ".." in parts or name.startswith(("/", "\\")) or ":" in name:
                    raise BridgeError("Archive has duplicate or unsafe entry names")
                seen.add(name)
                if entry.is_dir():
                    continue
                if entry.file_size > MAX_ENTRY or entry.flag_bits & 1:
                    raise BridgeError(f"{name} is oversized or encrypted")
                index = layer_index(name)
                basename = name.rsplit("/", 1)[-1].lower()
                if index is not None:
                    if index in layers:
                        raise BridgeError(f"Layer {index} appears more than once")
                    _check_png(archive.read(entry), name)
                    layers[index] = name
                elif basename in ("config.ini", "prusaslicer.ini"):
                    if basename in configs:
                        raise BridgeError(f"Archive has more than one {basename}")
                    configs[basename] = _ini(archive.read(entry))
            if not layers:
                raise BridgeError("The archive contains no numbered PNG layers; thumbnails are not layers")
            indexes = sorted(layers)
            if len(indexes) > MAX_LAYERS or indexes[0] not in (0, 1) or indexes != list(range(indexes[0], indexes[0] + len(indexes))):
                raise BridgeError("Layers must be consecutive, start at 0 or 1, and contain at most 1200 images")
            config = configs.get("config.ini", {})
            layer = _number(config.get("layerHeight"), "config.ini layerHeight")
            if abs(layer - 0.05) > 0.0001:
                raise BridgeError(f"Source layers are {layer:g} mm; TinyMaker source images must be sliced at 0.05 mm")
            # Physical dimensions can be absent in a printer-native archive.
            # If a slicer declares them, do not accept another machine's scale.
            settings = dict(configs.get("prusaslicer.ini", {}))
            settings.update(config)
            for aliases, expected in ((('display_pixels_x', 'resolutionX'), 320), (('display_pixels_y', 'resolutionY'), 240),
                                      (('display_width', 'displayWidth'), 40.8), (('display_height', 'displayHeight'), 30.6)):
                for key in aliases:
                    if key in settings and abs(_number(settings[key], key) - expected) > 0.001:
                        raise BridgeError(f"{key} must be {expected}; re-slice using the TinyMaker profile")
            if archive.testzip():
                raise BridgeError("The ZIP archive failed its CRC check")
            return {"layers": len(layers), "layerHeight": layer, "settings": config,
                    "uncompressedBytes": sum(e.file_size for e in entries)}
    except (OSError, zipfile.BadZipFile, RuntimeError, zlib.error) as exc:
        if isinstance(exc, BridgeError):
            raise
        raise BridgeError(f"Cannot read completed slice archive: {exc}")


def check_sl1(path):
    return inspect_sl1(path)["layers"]


# --------------------------------------------------------------------------
# self-describing names
# --------------------------------------------------------------------------

# The printer keeps 40 characters and throws away everything that is not a
# letter, a digit, "-" or "_" (safeModelName, src/Import.ino:71). So "0.05"
# arrives as "005", and a long name loses its TAIL - which is where the date is.
# That is why the model name is trimmed here rather than left to the firmware:
# trimmed here, the reading survives; trimmed there, the timestamp is the first
# thing to go.
NAME_MAX = 40


def _clean(v, default="x"):
    out = "".join(c for c in str(v) if c.isascii() and c.isalnum())
    return out or default


def sl1_settings(path):
    """Pull layer height, exposure and printer from an .sl1's config.ini.

    PrusaSlicer writes one; a bare ZIP of PNGs (which the printer also accepts)
    does not. Missing values are not an error - the name just carries fewer
    facts.
    """
    out = {}
    try:
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.lower().endswith("config.ini")]
            if not names:
                return out
            for line in z.read(names[0]).decode("utf-8", "replace").splitlines():
                if "=" not in line:
                    continue
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip()
    except (zipfile.BadZipFile, OSError):
        pass
    return out


def describe_name(path):
    """model_platform_layer_exposure_YYYY_MM_DD_HH_MM_SS, inside 40 chars.

    The date is the file's own modification time - when it was sliced, which is
    the fact worth keeping, not when it happened to be uploaded.
    """
    cfg = sl1_settings(path)
    model = os.path.splitext(os.path.basename(path))[0]
    model = "".join(c for c in model if (c.isascii() and c.isalnum()) or c in "-_") or "Model"

    platform = _clean(cfg.get("printerModel") or cfg.get("printerProfile") or "", "")
    layer = _clean(cfg.get("layerHeight", ""), "")
    expo = _clean(cfg.get("expTime", ""), "")

    stamp = time.strftime("%Y_%m_%d_%H_%M_%S", time.localtime(os.path.getmtime(path)))

    tail = ""
    for part in (platform, layer, expo):
        if part:
            tail += "_" + part
    tail += "_" + stamp

    # Spend what is left on the model name, never on the tail.
    room = NAME_MAX - len(tail)
    if room < 1:
        # Nothing sensible fits - keep the model and let the date go rather than
        # hand back a name that is only numbers.
        return model[:NAME_MAX], True
    return model[:room] + tail, len(model) > room


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


def printer_url(host):
    value = host if "://" in host else "http://" + host
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise BridgeError("--printer must be a host/IP with optional port, or an http(s) origin")
    try:
        parsed.port
    except ValueError:
        raise BridgeError("Invalid printer port")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _request(request, host, timeout):
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read(2 * 1024 * 1024).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(65536).decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
        raise BridgeError(f"Cannot reach {host}: {getattr(exc, 'reason', exc)}", retryable=True)


def _json_response(code, body, action):
    try:
        result = json.loads(body)
    except (ValueError, TypeError):
        raise BridgeError(f"{action}: printer returned HTTP {code} without valid JSON", retryable=code >= 500)
    if not isinstance(result, dict):
        raise BridgeError(f"{action}: invalid printer response")
    if code >= 400 or result.get("ok") is False or result.get("error"):
        message = result.get("error") or f"HTTP {code}"
        conflict = result.get("conflict") is True
        if conflict:
            message += "; choose --action rename to keep both, or --action replace to overwrite"
        raise BridgeError(f"{action}: {message}", retryable=not conflict and (code in (409, 429) or code >= 500))
    if result.get("ok") is not True:
        raise BridgeError(f"{action}: printer did not confirm success")
    return result


def get_json(host, path, timeout=15):
    request = urllib.request.Request(printer_url(host) + path, method="GET")
    return _json_response(*_request(request, host, timeout), action="Reading printer")


def post(host, path, fields=None, filefield=None, filename=None,
         filebytes=None, timeout=900):
    url = printer_url(host) + path
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
    return _request(req, host, timeout)


def safe_name(value):
    return "".join(c for c in value if (c.isascii() and c.isalnum()) or c in "-_")[:NAME_MAX] or "Model"


def ready_status(status):
    if status.get("resumePending"):
        raise BridgeError("An interrupted print is waiting to resume; resolve it on the printer before sending", retryable=True)
    if status.get("busy") or status.get("receiving") or status.get("sdJob"):
        raise BridgeError("Printer is busy; keep the slice and try again when it is idle", retryable=True)
    if status.get("sdReady") is not True:
        raise BridgeError("Printer SD card is not ready", retryable=True)
    if status.get("webControl") is not True:
        raise BridgeError("Enable Web control on the printer before sending", retryable=True)


def model_inventory(host):
    listing = get_json(host, "/api/files")
    # hiddenCount includes normal system/config files, not just truncation.
    # Completion is verified separately against model metadata and importSeq.
    items = listing.get("items", listing.get("files"))
    if not isinstance(items, list):
        raise BridgeError("Printer did not return its model inventory")
    return {item["name"]: item for item in items if isinstance(item, dict) and item.get("type") == "model" and isinstance(item.get("name"), str)}


def import_name_matches(candidate, requested, allow_rename=True):
    # uniqueModelName() preserves its 40-character base, then adds a numeric
    # suffix. Do not mistake an unrelated '<base>-artwork' upload for this one.
    return candidate == requested or (allow_rename and re.fullmatch(re.escape(requested) + r"-[0-9]+", candidate) is not None)


def import_sequence(item):
    value = item.get("importSeq", 0)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or int(value) != value:
        raise BridgeError("Printer returned an invalid model import sequence")
    return int(value)


def wait_import(host, name, before, info, timeout=900, poll=1.0, allow_rename=True):
    deadline = time.monotonic() + timeout
    last = "the printer has not finished importing"
    while time.monotonic() < deadline:
        try:
            status = get_json(host, "/api/status", timeout=min(10, max(0.1, deadline-time.monotonic())))
            if status.get("busy") or status.get("sdJob") or status.get("receiving"):
                last = "printer is still importing or busy"
            elif status.get("sdReady") is not True:
                last = "the SD card is not ready"
            else:
                current = model_inventory(host)
                changed = [key for key, item in current.items()
                           if import_name_matches(key, name, allow_rename) and
                           import_sequence(item) > import_sequence(before.get(key, {}))]
                if len(changed) > 1:
                    raise BridgeError("Several matching models changed; cannot identify this upload safely", uploaded=True)
                if len(changed) == 1:
                    final_name = changed[0]
                    detail = get_json(host, "/api/files/model?" + urllib.parse.urlencode({"name": final_name}))
                    if detail.get("name") != final_name or detail.get("sourceLayers") != info["layers"] or detail.get("flatWarning") is True or abs(_number(detail.get("slicedLayerHeightMm"), "Imported layer height") - 0.05) > 0.0001:
                        raise BridgeError("Imported model metadata does not match this slice; inspect it on the printer", uploaded=True)
                    return final_name
                last = "no new completed model matching this upload was found"
        except BridgeError as exc:
            if exc.uploaded:
                raise
            last = str(exc)
        time.sleep(min(poll, max(0, deadline-time.monotonic())))
    raise BridgeError("Upload was accepted, but readiness was not verified: " + last + ". The source file is kept; inspect the printer before sending again.", uploaded=True)


def upload(host, path, action, start, describe=False, timeout=900, poll=1.0):
    info = inspect_sl1(path)
    name = safe_name(os.path.splitext(os.path.basename(path))[0])
    if describe:
        name, trimmed = describe_name(path)
        log("  naming it " + name)
        if trimmed:
            log("  (model name shortened - the printer keeps 40 characters)")
    size = os.path.getsize(path)
    layers = info["layers"]
    status = get_json(host, "/api/status")
    ready_status(status)
    before = model_inventory(host)
    config = get_json(host, "/api/config")
    log("  exposure comes from the printer: base {} s, regular {} s; active layer {} mm".format(
        config.get("baseExposure", "unknown"), config.get("regularExposure", "unknown"), config.get("layerHeight", "unknown")))
    if config.get("layerHeight") != 0.05:
        log("  source remains 0.05 mm; a 0.10 mm printer profile uses every other source layer")
    log(f"  uploading {name}  ({layers} layers, {size/1048576:.1f} MB)")
    log("  waiting for the printer to finish unpacking and confirm the model")

    with open(path, "rb") as f:
        data = f.read()

    # Recheck just before the mutation: validation and file reads may take time.
    ready_status(get_json(host, "/api/status"))
    try:
        code, body = post(host, "/upload",
                      fields={"action": action, "source": "tm_send"},
                      filefield="file",
                      filename=name + ".sl1",
                      filebytes=data)
    except BridgeError as exc:
        # Connection loss after sending may mean the import was queued. Never
        # blindly replay a rename upload and create an unknown duplicate.
        raise BridgeError(str(exc) + "; delivery is uncertain, inspect the printer before retrying", uploaded=True)
    try:
        response = _json_response(code, body, "Upload")
    except BridgeError as exc:
        # A response lost after queuing can be an HTML proxy error or truncated
        # JSON. Only a structured, explicit 4xx rejection proves no delivery.
        try:
            rejection = json.loads(body)
        except (ValueError, TypeError):
            rejection = None
        known_rejection = 400 <= code < 500 and isinstance(rejection, dict) and rejection.get("ok") is False
        if not known_rejection:
            raise BridgeError(str(exc) + "; inspect the printer before sending again", uploaded=True) from exc
        raise
    requested = response.get("name")
    if requested != name or response.get("queued") is not True:
        raise BridgeError("Printer did not acknowledge this model's queued import; inspect its file list before sending again", uploaded=True)
    final_name = wait_import(host, requested, before, info, timeout, poll, allow_rename=action == "rename")
    log(f"  ready - \"{final_name}\" is on the printer ({layers} verified source layers)")

    if start:
        try:
            return start_verified_model(host, final_name)
        except BridgeError as exc:
            # Upload is already complete. A lost start response must never
            # cause a watched export to upload or start again automatically.
            raise BridgeError(str(exc), uploaded=True) from exc
    return final_name


def start_verified_model(host, final_name):
    preflight = get_json(host, "/api/preflight?" + urllib.parse.urlencode({"name": final_name}))
    if preflight.get("ready") is not True or any(c.get("pass") is False for c in preflight.get("checks", [])):
        problems = "; ".join(c.get("detail", c.get("check", "check failed")) for c in preflight.get("checks", []) if c.get("pass") is False)
        raise BridgeError("Model is ready, but print preflight needs attention: " + problems, uploaded=True)
    result = _json_response(*post(host, "/api/print/start", fields={"name": final_name}), action="Starting print")
    if result.get("warning") or result.get("queued") is not True:
        raise BridgeError("Model is ready; printing was not started: " + str(result.get("warning", "printer did not queue the print")), uploaded=True)
    log("  print start queued (no safety warnings overridden)")
    return final_name


# --------------------------------------------------------------------------
# one file, end to end
# --------------------------------------------------------------------------

def fingerprint(path):
    stat = os.stat(path)
    return stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def send(path, host, action, start, uvtools_path, describe=False, wait_timeout=900):
    ext = os.path.splitext(path)[1].lower()
    log(f"\n{os.path.basename(path)}")

    if ext not in NATIVE | CONVERTIBLE:
        die(f"I don't know the format {ext}.\n"
            f"        Ready to send: {', '.join(sorted(NATIVE))}\n"
            f"        Converted first: {', '.join(sorted(CONVERTIBLE))}")

    uv = find_uvtools(uvtools_path) if ext in CONVERTIBLE else None
    if ext in CONVERTIBLE and not uv:
        die(f"{ext} has to be converted first, and UVtools was not found.\n"
            "        Install it from https://github.com/sn4k3/UVtools "
            "(free), or pass --uvtools <path to UVtoolsCmd>.\n"
            "        Or export .sl1 from your slicer instead - Lychee can, "
            "and PrusaSlicer sends straight to the printer with no tool at all.")

    delivered = False
    try:
        with tempfile.TemporaryDirectory(prefix="tm_send_") as tmp:
            # A slicer may overwrite its export while the bridge is validating it.
            # Validate and send the same immutable snapshot, keeping the source.
            before = fingerprint(path)
            snapshot = os.path.join(tmp, os.path.basename(path))
            shutil.copy2(path, snapshot)
            if fingerprint(path) != before:
                raise BridgeError("Export changed while it was being read; waiting for it to finish", retryable=True)
            sl1 = convert_to_sl1(snapshot, uv, tmp) if uv else snapshot
            if uv:
                shutil.copystat(snapshot, sl1)
            try:
                result = upload(host, sl1, action, start, describe, timeout=wait_timeout)
                delivered = True
                return result
            except BridgeError as exc:
                delivered = exc.uploaded
                raise
    except OSError as exc:
        if delivered:
            # Windows can briefly lock a converter's temporary files. Cleanup
            # failure after delivery must not replay an already imported job.
            raise BridgeError("Model delivery already completed or was accepted, but temporary-file cleanup failed: " + str(exc), uploaded=True) from exc
        raise


# --------------------------------------------------------------------------
# watch mode
# --------------------------------------------------------------------------

def watch(folder, host, action, start, uvtools_path, describe=False, settle=2.0,
          poll_interval=1.0, stop_event=None, wait_timeout=900):
    """Send anything new that lands in a folder.

    Point it at the export folder of Chitubox or Lychee and forget about it.
    Files are only picked up once they have stopped growing, so a half-written
    export is never sent.
    """
    if not os.path.isdir(folder):
        die(f"{folder} is not a folder")
    known = {}
    watched = NATIVE | CONVERTIBLE
    def scan():
        found = {}
        with os.scandir(folder) as entries:
            for entry in entries:
                if entry.is_file() and os.path.splitext(entry.name)[1].lower() in watched:
                    try:
                        found[entry.name] = fingerprint(entry.path)
                    except OSError:
                        pass
        return found
    known = scan()
    log(f"watching {folder}")
    log(f"sending to {host} - press Ctrl+C to stop\n")
    pending = {}
    try:
        while not (stop_event and stop_event.is_set()):
            if stop_event:
                if stop_event.wait(poll_interval):
                    break
            else:
                time.sleep(poll_interval)
            try:
                now = scan()
            except OSError:
                continue
            tick = time.monotonic()
            for f, signature in now.items():
                if known.get(f) != signature:
                    pending[f] = {"signature": signature, "stable": tick, "next": tick, "attempt": 0}
            known = now

            for f in list(pending):
                p = os.path.join(folder, f)
                if f not in now:
                    pending.pop(f, None)
                    continue
                job = pending[f]
                if now[f][0] == 0:
                    job["stable"] = tick
                    continue
                if tick - job["stable"] < settle or tick < job["next"]:
                    continue
                try:
                    send(p, host, action, start, uvtools_path, describe, wait_timeout=wait_timeout)
                    pending.pop(f, None)
                except (BridgeError, OSError) as exc:
                    retry = isinstance(exc, OSError) or (exc.retryable and not exc.uploaded)
                    if retry:
                        job["attempt"] += 1
                        delay = min(60, 2 ** min(job["attempt"], 6))
                        job["next"] = time.monotonic() + delay
                        log("  kept - {}. Retrying in {} seconds.".format(exc, delay))
                    else:
                        pending.pop(f, None)
                        log("  kept - {}. Fix or re-export this file to retry; still watching.".format(exc))
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
    ap.add_argument("--action", choices=["replace", "rename"], default="",
                    help="explicitly replace or rename a name already on the card; default: refuse the conflict")
    ap.add_argument("--watch", metavar="DIR",
                    help="keep running and send anything new in DIR")
    ap.add_argument("--uvtools", metavar="PATH", help="path to UVtoolsCmd")
    ap.add_argument("--check", action="store_true", help="validate a native .sl1/.zip locally without contacting a printer")
    ap.add_argument("--wait-seconds", type=float, default=900,
                    help="maximum time to verify a completed import (default: 900)")
    ap.add_argument("--describe", action="store_true",
                    help="name it model_printer_layer_exposure_date so the "
                         "printer's file list says what each model is")
    a = ap.parse_args()
    if not math.isfinite(a.wait_seconds) or a.wait_seconds <= 0:
        ap.error("--wait-seconds must be a positive finite number")
    if a.check and (a.watch or a.start):
        ap.error("--check cannot be combined with --watch or --start")

    if a.watch:
        watch(a.watch, a.printer, a.action, a.start, a.uvtools, a.describe, wait_timeout=a.wait_seconds)
        return
    if not a.files:
        ap.error("give me a file to send, or --watch a folder")
    for f in a.files:
        if not os.path.isfile(f):
            die(f"no such file: {f}")
        if a.check:
            info = inspect_sl1(f)
            log("{}: valid, {} layers, 320 x 240 pixels, 0.05 mm source layers".format(f, info["layers"]))
        else:
            send(f, a.printer, a.action, a.start, a.uvtools, a.describe, wait_timeout=a.wait_seconds)


if __name__ == "__main__":
    try:
        main()
    except (BridgeError, OSError) as exc:
        print("Error: " + str(exc), file=sys.stderr)
        sys.exit(1)
