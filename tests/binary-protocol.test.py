# Protocol test for the PACKED binary: describe/health/invoke, sequential
# requests on one process, and export_pptx against a mock host (no network).
import json, subprocess, sys, http.server, socketserver, threading, io, os

BIN = sys.argv[1] if len(sys.argv) > 1 else r"E:\anna\my-focus-flow\executas\focus-flow\dist-anna\staging-windows-x86_64\bin\tool-arctic-focus-flow-gqm57t3n.exe"
fails = 0

def check(name, cond, extra=""):
    global fails
    print(("PASS" if cond else "FAIL"), name, extra)
    if not cond:
        fails += 1

captured = {}
class H(http.server.BaseHTTPRequestHandler):
    def do_PUT(self):
        n = int(self.headers.get("Content-Length", 0))
        captured["pptx"] = self.rfile.read(n)
        self.send_response(200); self.send_header("ETag", '"bin-mock-etag"'); self.end_headers()
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

DECK = {"title": "二进制协议测试", "subtitle": "packaged executa", "slides": [
    {"title": "正文一", "bullets": ["a", "b"]},
    {"title": "正文二", "bullets": ["c"]},
    {"title": "正文三", "bullets": ["d", "e"]},
    {"title": "总结", "bullets": ["f"]},
]}

proc = subprocess.Popen([BIN], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
next_id = [0]
def rpc(method, params=None):
    next_id[0] += 1
    rid = next_id[0]
    frame = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        frame["params"] = params
    proc.stdin.write(json.dumps(frame) + "\n"); proc.stdin.flush()
    # Answer any reverse-RPC the binary makes, then return its response.
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("binary exited")
        env = json.loads(line)
        if env.get("method") == "files/upload_begin":
            proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": env["id"], "result": {
                "put_url": f"http://127.0.0.1:{port}/put",
                "headers": {"Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}}}) + "\n"); proc.stdin.flush()
        elif env.get("method") == "files/upload_complete":
            proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": env["id"], "result": {"path": "pptx/deck.pptx"}}) + "\n"); proc.stdin.flush()
        elif env.get("id") == rid and "method" not in env:
            if "error" in env:
                raise RuntimeError(env["error"])
            return env["result"]

# 1. describe / health (routing is by tool_id, not the self-reported manifest name)
m = rpc("describe")
check("describe lists export_pptx tool", any(t["name"] == "export_pptx" for t in m.get("tools", [])))
check("health ready", rpc("health") == {"status": "ready"})

# 2. sequential invokes on the SAME process (persistent JSON-RPC loop)
r1 = rpc("invoke", {"tool": "ping", "arguments": {}, "context": {}})
r2 = rpc("invoke", {"tool": "ping", "arguments": {}, "context": {}})
check("two sequential ping invocations", r1.get("data", {}).get("pong") is True and r2.get("data", {}).get("pong") is True)

# 3. export_pptx end-to-end through the binary
captured.clear()
r3 = rpc("invoke", {"tool": "export_pptx", "arguments": {"deck": DECK}, "context": {}})
d3 = r3.get("data", {})
check("export_pptx success via binary", r3.get("success") is True and d3.get("slide_count") == 5, str(d3.get("filename", "")))
check("PPTX bytes captured from PUT", len(captured.get("pptx", b"")) > 5000)

# 4. validate the bytes the binary produced
from pptx import Presentation
prs = Presentation(io.BytesIO(captured["pptx"]))
check("binary-produced pptx has 5 slides", len(prs.slides) == 5, f"({len(prs.slides)})")

# 5. a second export on the same process still works (state cleanliness)
captured.clear()
r4 = rpc("invoke", {"tool": "export_pptx", "arguments": {"deck": DECK}, "context": {}})
check("second export on same process", r4.get("success") is True and len(captured.get("pptx", b"")) > 5000)

# 6. unknown tool -> contract envelope failure
r5 = rpc("invoke", {"tool": "nope", "arguments": {}, "context": {}})
check("unknown method returns failure envelope", r5.get("success") is False and "unknown" in r5.get("error", ""))

proc.kill()
print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILURES'}")
sys.exit(1 if fails else 0)
