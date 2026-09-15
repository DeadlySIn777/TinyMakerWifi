"""PC bridge raster and deferred-import tests. All HTTP targets are loopback."""
import contextlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import threading
import unittest
import urllib.parse
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("tm_send", Path(__file__).resolve().parents[1] / "tm_send.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def png(width=320, height=240):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)
    # A visible square, not just an empty mask.
    raw = b"".join(b"\0" + bytes(255 if 145 <= x < 175 and 100 <= y < 140 else 0 for x in range(width)) for y in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def make_sl1(path, layers=(0, 1, 2), image=None, config="layerHeight = 0.05\n", extra=()):
    image = png() if image is None else image
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("config.ini", config)
        archive.writestr("thumbnail/thumbnail400x400.png", png(10, 10))
        for i in layers:
            archive.writestr("model{:05d}.png".format(i), image)
        for name, data in extra:
            archive.writestr(name, data)


class PrinterFixture:
    def __init__(self):
        self.status = dict(ok=True, busy=False, receiving=False, sdReady=True, webControl=True, sdJob="", sdRev=1, resumePending=False)
        self.models = {}
        self.uploads = []
        self.starts = []
        self.busy_reads = 2
        self.pending = None
        self.accept_without_import = False
        self.upload_response = None
        self.start_response = dict(ok=True, queued=True)
        self.preflight = dict(ok=True, ready=True, checks=[])
        self.detail_layers = 3
        self.hidden_count = 6  # ordinary printer config/system files
        self.import_as = None
        self.detail_name = None

    def complete(self):
        name = self.pending
        self.models[name] = dict(type="model", name=name, printable=True, importSeq=1 + max([v.get("importSeq", 0) for v in self.models.values()] or [0]))
        self.pending = None

    def get(self, route):
        parsed = urllib.parse.urlsplit(route)
        if parsed.path == "/api/status":
            result = dict(self.status)
            if self.pending:
                if self.busy_reads:
                    self.busy_reads -= 1
                    result.update(sdJob="import", busy=True)
                elif not self.accept_without_import:
                    self.complete()
            return result
        if parsed.path == "/api/files":
            return dict(ok=True, sdReady=True, hiddenCount=self.hidden_count, items=list(self.models.values()))
        if parsed.path == "/api/config":
            return dict(ok=True, layerHeight=0.05, baseExposure=35, regularExposure=14)
        if parsed.path == "/api/files/model":
            name = urllib.parse.parse_qs(parsed.query)["name"][0]
            return dict(ok=True, name=self.detail_name or name, sourceLayers=self.detail_layers, slicedLayerHeightMm=0.05, flatWarning=False)
        if parsed.path == "/api/preflight":
            return self.preflight
        raise AssertionError(route)

    def post(self, route, data):
        if route == "/upload":
            self.uploads.append(data)
            if self.upload_response:
                return self.upload_response
            name = re.search(br'filename="([^"]+)"', data).group(1).decode()[:-4]
            final = name
            if b'\r\n\r\nrename\r\n' in data and name in self.models:
                i = 2
                while final in self.models:
                    final = name + "-" + str(i)
                    i += 1
            self.pending = self.import_as or final
            return 201, dict(ok=True, queued=True, name=name)
        if route == "/api/print/start":
            self.starts.append(urllib.parse.parse_qs(data.decode()))
            return 200, self.start_response
        raise AssertionError(route)


@contextlib.contextmanager
def printer_server(fixture):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def reply(self, code, payload):
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        def do_GET(self):
            self.reply(200, fixture.get(self.path))
        def do_POST(self):
            data = self.rfile.read(int(self.headers["Content-Length"]))
            assert self.headers.get("X-TinyMaker") == "tm_send"
            self.reply(*fixture.post(self.path, data))
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    worker.start()
    try:
        yield "127.0.0.1:{}".format(server.server_port)
    finally:
        server.shutdown()
        server.server_close()
        worker.join(2)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="tm_bridge_tests_")
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "QA_Cube.sl1"
        make_sl1(self.path)
        self.messages = []
        self.log = patch.object(bridge, "log", self.messages.append)
        self.log.start()
        self.addCleanup(self.log.stop)

    def test_valid_raster_and_thumbnail_excluded(self):
        self.assertEqual(bridge.check_sl1(self.path), 3)
        self.assertEqual(bridge.layer_index("slice/Benchy00016.PNG"), 16)
        self.assertIsNone(bridge.layer_index("thumbnail400.png"))

    def test_indexed_png_requires_palette(self):
        image = bytearray(png())
        image[25] = 3  # switch IHDR to indexed color and repair its CRC
        image[29:33] = struct.pack(">I", zlib.crc32(image[12:29]) & 0xffffffff)
        make_sl1(self.path, image=bytes(image))
        with self.assertRaisesRegex(bridge.BridgeError, "no PNG palette"):
            bridge.inspect_sl1(self.path)

    def test_invalid_archives_blocked(self):
        cases = [dict(layers=()), dict(image=png(16, 16)), dict(layers=(0, 2)),
                 dict(config="layerHeight = 0.1\n"), dict(config="layerHeight = nan\n"),
                 dict(extra=(("prusaslicer.ini", "display_width=100\n"),)),
                 dict(extra=(("../../bad.png", b"x"),)),
                 dict(extra=(("slice/other00000.png", png()),)),
                 dict(image=png()[:-2]), dict(image=png()[:-14] + b"xx" + png()[-12:])]
        for options in cases:
            with self.subTest(options=list(options)):
                make_sl1(self.path, **options)
                with self.assertRaises(bridge.BridgeError):
                    bridge.inspect_sl1(self.path)

    def test_import_waits_for_finished_model(self):
        fixture = PrinterFixture()
        with printer_server(fixture) as host:
            final = bridge.upload(host, self.path, "", False, timeout=2, poll=0.01)
        self.assertEqual(final, "QA_Cube")
        self.assertEqual(len(fixture.uploads), 1)
        self.assertEqual(fixture.starts, [])
        self.assertEqual(fixture.busy_reads, 0)
        self.assertTrue(any("3 verified source layers" in msg for msg in self.messages))
        payload = fixture.uploads[0]
        start = payload.index(b"PK\x03\x04")
        end = payload.rfind(b"\r\n--")
        with zipfile.ZipFile(io.BytesIO(payload[start:end])) as archive:
            self.assertEqual(archive.read("model00001.png"), png())

    def test_renamed_model_used_for_start_without_force(self):
        fixture = PrinterFixture()
        fixture.models["QA_Cube"] = dict(name="QA_Cube", type="model", importSeq=7)
        with printer_server(fixture) as host:
            final = bridge.upload(host, self.path, "rename", True, timeout=2, poll=0.01)
        self.assertEqual(final, "QA_Cube-2")
        self.assertEqual(fixture.starts, [{"name": ["QA_Cube-2"]}])

    def test_forty_character_name_retains_rename_suffix(self):
        name = "A" * 40
        self.path = self.path.with_name(name + "-extra.sl1")
        make_sl1(self.path)
        fixture = PrinterFixture()
        fixture.models[name] = dict(name=name, type="model", importSeq=7)
        fixture.models[name + "-2"] = dict(name=name + "-2", type="model", importSeq=8)
        with printer_server(fixture) as host:
            final = bridge.upload(host, self.path, "rename", True, timeout=1, poll=0.01)
        self.assertEqual(final, name + "-3")
        self.assertEqual(len(final), 42)
        self.assertEqual(fixture.starts, [{"name": [final]}])

    def test_unrelated_prefix_or_unrequested_rename_never_identifies_upload(self):
        for final, action in (("QA_Cube-artwork", "rename"), ("QA_Cube-2", "replace")):
            fixture = PrinterFixture()
            fixture.import_as = final
            with self.subTest(final=final), printer_server(fixture) as host, self.assertRaises(bridge.BridgeError) as raised:
                bridge.upload(host, self.path, action, True, timeout=0.12, poll=0.01)
            self.assertTrue(raised.exception.uploaded)
            self.assertEqual(fixture.starts, [])

    def test_acknowledgment_must_name_this_queued_import(self):
        for response in (dict(ok=True, queued=True, name="Other_Model"), dict(ok=True, name="QA_Cube")):
            fixture = PrinterFixture()
            fixture.upload_response = 201, response
            with printer_server(fixture) as host, self.assertRaises(bridge.BridgeError) as raised:
                bridge.upload(host, self.path, "rename", True, timeout=0.12, poll=0.01)
            self.assertTrue(raised.exception.uploaded)
            self.assertEqual(fixture.starts, [])

    def test_server_200_error_is_failure(self):
        fixture = PrinterFixture()
        fixture.upload_response = 200, dict(ok=False, error="SD write failed")
        with printer_server(fixture) as host, self.assertRaisesRegex(bridge.BridgeError, "SD write failed"):
            bridge.upload(host, self.path, "", False, timeout=1, poll=0.01)
        self.assertFalse(any("ready -" in msg for msg in self.messages))

    def test_ambiguous_upload_response_never_allows_retry(self):
        fixture = PrinterFixture()
        fixture.upload_response = 503, dict(ok=False, error="proxy disconnected")
        with printer_server(fixture) as host, self.assertRaises(bridge.BridgeError) as raised:
            bridge.upload(host, self.path, "rename", False, timeout=1, poll=0.01)
        self.assertTrue(raised.exception.uploaded)

    def test_readiness_blocks_upload(self):
        for key, value in (("busy", True), ("sdReady", False), ("webControl", False), ("resumePending", True)):
            fixture = PrinterFixture()
            fixture.status[key] = value
            with self.subTest(key=key), printer_server(fixture) as host, self.assertRaises(bridge.BridgeError):
                bridge.upload(host, self.path, "replace", False, timeout=1, poll=0.01)
            self.assertEqual(fixture.uploads, [])

    def test_accepted_but_failed_import_never_claims_ready(self):
        fixture = PrinterFixture()
        fixture.accept_without_import = True
        with printer_server(fixture) as host, self.assertRaises(bridge.BridgeError) as raised:
            bridge.upload(host, self.path, "", False, timeout=0.12, poll=0.01)
        self.assertTrue(raised.exception.uploaded)
        self.assertIn("readiness was not verified", str(raised.exception))
        self.assertFalse(any("ready -" in msg for msg in self.messages))

    def test_final_metadata_mismatch_never_claims_ready(self):
        fixture = PrinterFixture()
        fixture.detail_layers = 2
        with printer_server(fixture) as host, self.assertRaises(bridge.BridgeError) as raised:
            bridge.upload(host, self.path, "", False, timeout=1, poll=0.01)
        self.assertTrue(raised.exception.uploaded)
        self.assertFalse(any("ready -" in msg for msg in self.messages))

    def test_final_metadata_names_same_model(self):
        fixture = PrinterFixture()
        fixture.detail_name = "Other_Model"
        with printer_server(fixture) as host, self.assertRaises(bridge.BridgeError) as raised:
            bridge.upload(host, self.path, "", False, timeout=1, poll=0.01)
        self.assertTrue(raised.exception.uploaded)

    def test_truncated_http_response_is_a_bridge_error(self):
        class Response:
            status = 201
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def read(self, *_):
                raise http.client.IncompleteRead(b'{"ok":true,', 40)
        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()), self.assertRaises(bridge.BridgeError) as raised:
            bridge._request(bridge.urllib.request.Request("http://127.0.0.1/"), "fixture", 1)
        self.assertTrue(raised.exception.retryable)

    def test_cleanup_failure_cannot_replay_completed_or_uncertain_upload(self):
        snapshot_dir = Path(self.tmp.name) / "snapshot"
        snapshot_dir.mkdir()
        class CleanupFailure:
            def __init__(self, **_):
                pass
            def __enter__(self):
                return str(snapshot_dir)
            def __exit__(self, *_):
                raise PermissionError("temporary file is locked")
        for uncertain in (False, True):
            def delivered(*args, **kwargs):
                if uncertain:
                    raise bridge.BridgeError("delivery response lost", uploaded=True)
                return "QA_Cube"
            with patch.object(bridge.tempfile, "TemporaryDirectory", CleanupFailure), patch.object(bridge, "upload", delivered), self.assertRaises(bridge.BridgeError) as raised:
                bridge.send(str(self.path), "fixture", "rename", False, None)
            self.assertTrue(raised.exception.uploaded)

    def test_start_warning_or_failed_preflight_never_overridden(self):
        for failed_preflight in (False, True):
            fixture = PrinterFixture()
            fixture.start_response = dict(ok=True, warning="low_resin")
            if failed_preflight:
                fixture.preflight = dict(ok=True, ready=True, checks=[dict(check="resin", **{"pass": False}, detail="Low resin")])
            with printer_server(fixture) as host, self.assertRaises(bridge.BridgeError) as raised:
                bridge.upload(host, self.path, "", True, timeout=1, poll=0.01)
            self.assertTrue(raised.exception.uploaded)
            self.assertEqual(len(fixture.starts), 0 if failed_preflight else 1)
            self.assertFalse(any("print start queued" in msg for msg in self.messages))

    def test_start_network_uncertainty_does_not_allow_replay(self):
        fixture = PrinterFixture()
        original = bridge.get_json
        def get(host, path, **kwargs):
            if path.startswith("/api/preflight"):
                raise bridge.BridgeError("connection lost", retryable=True)
            return original(host, path, **kwargs)
        with printer_server(fixture) as host, patch.object(bridge, "get_json", get), self.assertRaises(bridge.BridgeError) as raised:
            bridge.upload(host, self.path, "rename", True, timeout=1, poll=0.01)
        self.assertTrue(raised.exception.uploaded)
        self.assertEqual(len(fixture.uploads), 1)

    def test_snapshot_is_the_file_that_was_validated(self):
        original_bytes = self.path.read_bytes()
        def fake_upload(host, path, *args, **kwargs):
            self.assertNotEqual(Path(path), self.path)
            self.path.write_bytes(b"new export in progress")
            self.assertEqual(Path(path).read_bytes(), original_bytes)
            self.assertEqual(bridge.check_sl1(path), 3)
            return "QA_Cube"
        with patch.object(bridge, "upload", fake_upload):
            self.assertEqual(bridge.send(str(self.path), "unused", "", False, None), "QA_Cube")
        self.assertEqual(self.path.read_bytes(), b"new export in progress")


if __name__ == "__main__":
    unittest.main()
