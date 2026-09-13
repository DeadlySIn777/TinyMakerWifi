"""End-to-end regression test: a slicer export that appears empty and then grows.

Chitubox (and every other slicer) creates the file first and writes into it
after. The watcher must wait for it to stop growing, not pounce on the empty
placeholder.
"""
import os, shutil, socket, subprocess, sys, tempfile, time, zipfile, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "tm_send.py")
WATCH = os.path.join(tempfile.gettempdir(), "tm_send_watch_test")
PORT = 8766


def png(w, h):
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    raw = b"".join(b"\x00" + b"\x00" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def make_sl1(path):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("config.ini", "layerHeight = 0.1\n")
        for i in range(1, 9):
            z.writestr("l%05d.png" % i, png(16, 16))


def wait_port(port, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.3):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def main():
    shutil.rmtree(WATCH, ignore_errors=True)
    os.makedirs(WATCH)

    mock = subprocess.Popen([sys.executable, os.path.join(HERE, "mock_printer.py")],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if not wait_port(PORT):
        mock.kill()
        print("FAIL: mock printer never came up")
        return 2

    watcher = subprocess.Popen(
        [sys.executable, SCRIPT, "--watch", WATCH, "--printer", "127.0.0.1:%d" % PORT],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(2.5)  # let it take its baseline listing

    # Stage 1: the slicer creates the file. Nothing in it yet.
    target = os.path.join(WATCH, "Dragon.sl1")
    open(target, "wb").close()
    print("created empty Dragon.sl1")
    time.sleep(4.0)  # longer than the watcher's settle window

    # Stage 2: the slicer writes the real content.
    make_sl1(target)
    print("wrote real content, %d bytes" % os.path.getsize(target))
    time.sleep(7.0)

    watcher.terminate()
    try:
        wout = watcher.communicate(timeout=5)[0]
    except subprocess.TimeoutExpired:
        watcher.kill()
        wout = ""
    mock.terminate()
    try:
        mout = mock.communicate(timeout=5)[0]
    except subprocess.TimeoutExpired:
        mock.kill()
        mout = ""

    print("--- watcher said ---")
    print(wout.strip() or "(nothing)")
    print("--- printer received ---")
    print(mout.strip() or "(nothing)")

    good = [l for l in mout.splitlines() if "validzip=True" in l]
    if good:
        print("\nPASS: the complete file arrived (%s)" % good[-1].strip())
        return 0
    print("\nFAIL: the complete file never arrived")
    return 1


if __name__ == "__main__":
    sys.exit(main())
