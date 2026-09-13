"""Mock of the printer's upload contract, to test tm_send.py without hardware."""
import re, io, zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

EXISTS = set()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        hdr = self.headers.get("X-TinyMaker")
        if self.path == "/upload":
            fn = re.search(rb'filename="([^"]+)"', body)
            fn = fn.group(1).decode() if fn else "?"
            act = re.search(rb'name="action"\r\n\r\n([^\r]*)', body)
            act = act.group(1).decode() if act else ""
            src = re.search(rb'name="source"\r\n\r\n([^\r]*)', body)
            src = src.group(1).decode() if src else ""
            marker = b"application/octet-stream\r\n\r\n"
            s = body.find(marker) + len(marker)
            e = body.rfind(b"\r\n------tmsend")
            payload = body[s:e]
            okzip = zipfile.is_zipfile(io.BytesIO(payload))
            name = fn.rsplit(".", 1)[0]
            print(f"EVENT upload name={name} bytes={len(payload)} validzip={okzip} "
                  f"action={act} source={src} xheader={hdr}", flush=True)
            if name in EXISTS and act not in ("replace", "rename"):
                self.send_response(409); self.end_headers()
                self.wfile.write(b'{"ok":false,"conflict":true}'); return
            EXISTS.add(name)
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}'); return
        if self.path == "/api/print/start":
            if hdr is None:
                print("EVENT start REJECTED no-x-header", flush=True)
                self.send_response(403); self.end_headers()
                self.wfile.write(b'{"error":"must come from the printer\'s own dashboard"}'); return
            nm = re.search(rb"name=([^&]*)", body)
            print(f"EVENT start name={nm.group(1).decode() if nm else '?'} xheader={hdr}", flush=True)
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}'); return
        self.send_response(404); self.end_headers()

HTTPServer(("127.0.0.1", 8766), H).serve_forever()
