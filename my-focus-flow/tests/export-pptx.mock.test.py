# Mock-host test for export_pptx: drives the real plugin process over stdio
# with a stubbed host (local PUT receiver), so no staging/AI quota is used.
# The PPTX bytes are captured from the PUT body and validated with python-pptx.
import json, subprocess, sys, http.server, socketserver, threading, io

captured = {}

class H(http.server.BaseHTTPRequestHandler):
    def do_PUT(self):
        n = int(self.headers.get("Content-Length", 0))
        captured["pptx"] = self.rfile.read(n)
        captured["content_type"] = self.headers.get("Content-Type")
        self.send_response(200)
        self.send_header("ETag", '"mock-etag"')
        self.end_headers()
    def log_message(self, *a): pass

srv = socketserver.TCPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

def run_export(deck):
    captured.clear()
    proc = subprocess.Popen(
        ["E:/anna/my-focus-flow/executas/focus-flow/.venv/Scripts/python.exe", "focus_flow_plugin.py"],
        cwd="E:/anna/my-focus-flow/executas/focus-flow",
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    def send(o): proc.stdin.write(json.dumps(o) + "\n"); proc.stdin.flush()
    send({"jsonrpc": "2.0", "id": 1, "method": "invoke",
          "params": {"tool": "export_pptx", "arguments": {"deck": deck}, "context": {}}})
    result = None
    for line in proc.stdout:
        env = json.loads(line)
        if env.get("method") == "files/upload_begin":
            send({"jsonrpc": "2.0", "id": env["id"], "result": {
                "put_url": f"http://127.0.0.1:{port}/put",
                "headers": {"Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}}})
        elif env.get("method") == "files/upload_complete":
            send({"jsonrpc": "2.0", "id": env["id"], "result": {"path": "pptx/deck.pptx"}})
        elif env.get("id") == 1 and "method" not in env:
            result = env
            break
    proc.kill()
    return result

GOOD = {"title": "人工智能在教育中的应用", "subtitle": "科技赋能学习",
        "slides": [
            {"title": "引言：AI 走进课堂", "bullets": ["智能批改与答疑已普及", "个性化学习成为现实", "教师角色正在转变"]},
            {"title": "个性化学习", "bullets": ["按学生水平动态出题", "实时反馈薄弱知识点", "自适应学习路径规划"]},
            {"title": "课堂与作业中的应用", "bullets": ["自动批改节省时间", "学情数据辅助决策"]},
            {"title": "总结与展望", "bullets": ["AI 是工具而非替代", "教育本质仍是育人"]},
        ]}

fails = 0

# 1. valid deck -> success, 5 pages (cover + 4), correct mime on PUT
r = run_export(GOOD)
res = r.get("result") or {}
ok = res.get("success") and res.get("data", {}).get("slide_count") == 5 and "pptx" in captured
print(("PASS" if ok else "FAIL"), "valid deck -> 5 pages, uploaded")
if not ok:
    fails += 1
    print("  result:", json.dumps(r, ensure_ascii=False)[:200])
else:
    from pptx import Presentation
    prs = Presentation(io.BytesIO(captured["pptx"]))
    n = len(prs.slides)
    ct = captured.get("content_type")
    print("  pptx slides:", n, "| PUT content-type:", ct)
    if n != 5 or "presentationml" not in (ct or ""):
        fails += 1
        print("FAIL slide count or content-type")
    # edited-content round trip: title/bullet text present and editable (text frames)
    texts = []
    for s in prs.slides:
        for sh in s.shapes:
            if sh.has_text_frame:
                texts.append(sh.text_frame.text)
    joined = "\n".join(texts)
    for want in ["人工智能在教育中的应用", "总结与展望", "教育本质仍是育人"]:
        if want not in joined:
            fails += 1
            print("FAIL missing text:", want)

# 2. invalid decks -> clean errors
for label, bad in [
    ("missing slides", {"title": "t"}),
    ("slides not a list", {"title": "t", "slides": "x"}),
    ("slide not an object", {"title": "t", "slides": [1]}),
    ("bullets wrong type", {"title": "t", "slides": [{"title": "a", "bullets": 5}]}),
]:
    r = run_export(bad)
    msg = (r.get("error") or {}).get("message") or (r.get("result") or {}).get("error") or ""
    good = "deck" in msg or "页" in msg
    print(("PASS" if good else "FAIL"), f"invalid deck ({label}) -> {msg[:60]}")
    if not good:
        fails += 1

sys.exit(1 if fails else 0)
