"""Watch export lifecycle regression tests; all uploads use a loopback fixture."""
from pathlib import Path
import os
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from test_tm_send_bridge import bridge, make_sl1, PrinterFixture, printer_server


def until(predicate, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Watcher condition did not arrive")


class WatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="tm_watch_tests_")
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.stop = threading.Event()
        self.started = threading.Event()
        self.messages = []
        self.errors = []
        self.log = patch.object(bridge, "log", self.capture)
        self.log.start()
        self.addCleanup(self.log.stop)

    def capture(self, message):
        self.messages.append(message)
        if message.startswith("sending to"):
            self.started.set()

    def run_watch(self, host="unused"):
        def work():
            try:
                bridge.watch(str(self.folder), host, "rename", False, None, settle=0.06,
                             poll_interval=0.01, stop_event=self.stop, wait_timeout=2)
            except Exception as exc:
                self.errors.append(exc)
        worker = threading.Thread(target=work, daemon=True)
        worker.start()
        self.assertTrue(self.started.wait(1))
        def finish():
            self.stop.set()
            worker.join(4)
            self.assertFalse(worker.is_alive())
            self.assertEqual(self.errors, [])
        self.addCleanup(finish)

    def test_empty_then_growing_file_reaches_completed_printer_import(self):
        fixture = PrinterFixture()
        fixture.busy_reads = 0
        with printer_server(fixture) as host:
            self.run_watch(host)
            target = self.folder / "Dragon.sl1"
            target.touch()
            time.sleep(0.18)
            self.assertEqual(fixture.uploads, [])
            make_sl1(target)
            until(lambda: any("ready -" in msg for msg in self.messages))
            self.assertEqual(len(fixture.uploads), 1)
            self.assertEqual(fixture.starts, [])
            self.assertTrue(target.is_file())
            self.stop.set()

    def test_overwritten_existing_filename_even_same_length_is_sent(self):
        target = self.folder / "Same.sl1"
        target.write_bytes(b"old data")
        seen = []
        with patch.object(bridge, "send", side_effect=lambda path, *args, **kwargs: seen.append(Path(path).read_bytes())):
            self.run_watch()
            self.assertEqual(seen, [])
            target.write_bytes(b"new data")
            stamp = time.time_ns() + 1_000_000_000
            os.utime(target, ns=(stamp, stamp))
            until(lambda: len(seen) == 1)
            target.write_bytes(b"newest!!")
            os.utime(target, ns=(stamp + 1_000_000_000, stamp + 1_000_000_000))
            until(lambda: len(seen) == 2)
            self.assertEqual(seen, [b"new data", b"newest!!"])
            self.stop.set()

    def test_busy_error_retries_without_losing_source(self):
        seen = []
        def send(path, *args, **kwargs):
            seen.append(path)
            if len(seen) == 1:
                raise bridge.BridgeError("Printer busy", retryable=True)
        with patch.object(bridge, "send", send):
            self.run_watch()
            target = self.folder / "Retry.sl1"
            target.write_bytes(b"completed fixture")
            until(lambda: len(seen) == 2, timeout=4)
            self.assertTrue(target.is_file())
            self.assertTrue(any("Retrying in" in msg for msg in self.messages))
            self.stop.set()

    def test_bad_and_uncertain_delivery_are_held_without_hot_retry(self):
        seen = []
        def send(path, *args, **kwargs):
            seen.append(path)
            raise bridge.BridgeError("delivery uncertain", retryable=True, uploaded=True)
        with patch.object(bridge, "send", send):
            self.run_watch()
            target = self.folder / "Uncertain.sl1"
            target.write_bytes(b"completed fixture")
            until(lambda: len(seen) == 1)
            time.sleep(0.2)
            self.assertEqual(len(seen), 1)
            self.assertTrue(target.is_file())
            self.assertTrue(any("re-export" in msg for msg in self.messages))
            self.stop.set()

    def test_enabling_web_control_releases_waiting_export(self):
        fixture = PrinterFixture()
        fixture.busy_reads = 0
        fixture.status["webControl"] = False
        with printer_server(fixture) as host:
            self.run_watch(host)
            target = self.folder / "Waiting.sl1"
            make_sl1(target)
            until(lambda: any("Enable Web control" in msg for msg in self.messages))
            self.assertEqual(fixture.uploads, [])
            fixture.status["webControl"] = True
            until(lambda: any("ready -" in msg for msg in self.messages), timeout=4)
            self.assertEqual(len(fixture.uploads), 1)
            self.assertTrue(target.exists())
            self.stop.set()

    def test_invalid_export_is_held_then_corrected_export_is_sent(self):
        fixture = PrinterFixture()
        fixture.busy_reads = 0
        with printer_server(fixture) as host:
            self.run_watch(host)
            target = self.folder / "Corrected.sl1"
            target.write_bytes(b"incomplete invalid zip")
            until(lambda: any("re-export" in msg for msg in self.messages))
            time.sleep(0.1)
            self.assertEqual(fixture.uploads, [])
            self.assertEqual(sum("re-export" in msg for msg in self.messages), 1)
            make_sl1(target)
            until(lambda: any("ready -" in msg for msg in self.messages))
            self.assertEqual(len(fixture.uploads), 1)
            self.assertTrue(target.exists())
            self.stop.set()


if __name__ == "__main__":
    unittest.main()
