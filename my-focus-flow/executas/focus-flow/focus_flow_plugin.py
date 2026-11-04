"""Stdio plugin for the focus-flow Anna App (stage 1: PPTX pipeline)."""

import io
import json
import sys
import urllib.request

MANIFEST = {
    "name": "tool-dev-focus-flow",
    "version": "0.1.0",
    # Declares the reverse-RPC host capabilities this plugin uses, so the
    # platform mints a plugin storage_token (APS files) in production.
    "host_capabilities": ["aps.files"],
    "tools": [
        {
            "name": "ping",
            "description": "Smoke-test method.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "name": "create_pptx",
            "description": (
                "Generate a fixed two-slide PPTX with python-pptx, upload it "
                "to the app's APS file scope via reverse-RPC, and return the "
                "APS path for the frontend to download."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "name": "export_pptx",
            "description": (
                "Render a deck JSON ({title, subtitle?, slides:[{title, "
                "bullets:[str]}]}) into a uniformly styled PPTX with "
                "python-pptx, upload it to the app's APS file scope, and "
                "return the APS path for the frontend to download."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "deck": {
                        "type": "object",
                        "description": "Deck content produced by the LLM and edited by the user.",
                    },
                },
                "required": ["deck"],
                "additionalProperties": False,
            },
        },
    ],
}

_next_rpc_id = 0


def host_call(method: str, params: dict) -> dict:
    """Plugin -> host reverse-RPC over stdio.

    Writes one JSON-RPC request frame to stdout and scans stdin for the
    response with the matching id. Production-parity methods only (see
    anna_app_runtime_local.executa.SERVER_REQUEST_METHODS).
    """
    global _next_rpc_id
    _next_rpc_id += 1
    req_id = _next_rpc_id
    frame = json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
    sys.stdout.write(frame + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            env = json.loads(line)
        except json.JSONDecodeError:
            continue
        if env.get("id") == req_id and "method" not in env:
            if "error" in env:
                err = env["error"] or {}
                raise RuntimeError(f"host reverse-RPC {method} failed: [{err.get('code')}] {err.get('message')}")
            return env.get("result") or {}
    raise RuntimeError(f"stdin closed while awaiting reverse-RPC response for {method}")


def upload_to_app_files(data: bytes, path: str, content_type: str) -> dict:
    """Upload bytes into the app's APS file scope via reverse-RPC."""
    init = host_call(
        "files/upload_begin",
        {
            "path": path,
            "content_type": content_type,
            "size_bytes": len(data),
            # Production parity: executa files/* travel on the executa's own
            # storage_token with app-scope semantics; the hosting app's
            # iframe reads the same path back via files.download.
            "scope": "app",
        },
    )
    put_url = init.get("put_url") or init.get("upload_url")
    if not put_url:
        raise RuntimeError(f"files/upload_begin returned no put_url: {sorted(init)}")
    headers = {str(k): str(v) for k, v in (init.get("headers") or {}).items()}
    # Direct connection, no proxy chain: presigned object-store PUTs must
    # reach the origin untouched, with the signed headers exactly as issued.
    # Transient handshake drops are retried.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    etag = None
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(put_url, data=data, headers=headers, method="PUT")
            with opener.open(req, timeout=15) as resp:
                etag = resp.headers.get("ETag")
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    if not etag:
        raise RuntimeError(f"PUT to presigned upload URL failed after retries: {last_err}")
    done = host_call(
        "files/upload_complete",
        {"path": path, "etag": etag, "size_bytes": len(data), "scope": "app"},
    )
    return {"path": done.get("path", path), "size_bytes": len(data)}


def build_sample_pptx() -> bytes:
    """Fixed two-slide deck (stage 1 placeholder content)."""
    from pptx import Presentation
    from pptx.util import Pt

    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "focus-flow"
    slide.placeholders[1].text = "Anna App PPTX pipeline — stage 1 smoke deck"

    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Pipeline verified"
    body = slide.placeholders[1].text_frame
    body.text = "Frontend -> tools.invoke -> Python Executa"
    for line in (
        "python-pptx builds the .pptx in memory",
        "Executa uploads it to APS files (app scope)",
        "Frontend delivers it via anna.files.download",
    ):
        body.add_paragraph().text = line

    for s in prs.slides:
        if s.shapes.title is not None:
            s.shapes.title.text_frame.paragraphs[0].runs[0].font.size = Pt(40)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def sanitize_deck(raw: dict) -> dict:
    """Validate and normalize the deck JSON.

    Raises ValueError with a user-facing message on structural problems;
    coerces minor type issues (numbers -> str, str -> [str]) silently.
    """
    if not isinstance(raw, dict):
        raise ValueError("deck 必须是 JSON 对象")

    def text(value, field: str, limit: int) -> str:
        if value is None:
            return ""
        if not isinstance(value, str):
            value = str(value)
        value = value.strip()
        return value[:limit]

    title = text(raw.get("title"), "title", 120) or "未命名演示文稿"
    subtitle = text(raw.get("subtitle"), "subtitle", 200)

    slides_raw = raw.get("slides")
    if not isinstance(slides_raw, list) or not slides_raw:
        raise ValueError("deck.slides 必须是非空数组")

    slides = []
    for i, s in enumerate(slides_raw, 1):
        if not isinstance(s, dict):
            raise ValueError(f"第 {i} 页必须是对象")
        s_title = text(s.get("title"), f"slides[{i}].title", 120) or f"第 {i} 页"
        bullets_raw = s.get("bullets")
        if bullets_raw is None:
            bullets_raw = []
        if isinstance(bullets_raw, str):
            bullets_raw = [bullets_raw]
        if not isinstance(bullets_raw, list):
            raise ValueError(f"第 {i} 页的 bullets 必须是数组")
        bullets = []
        for b in bullets_raw[:6]:
            bt = text(b, f"slides[{i}].bullets", 200)
            if bt:
                bullets.append(bt)
        slides.append({"title": s_title, "bullets": bullets})
    return {"title": title, "subtitle": subtitle, "slides": slides}


def build_deck_pptx(deck: dict) -> bytes:
    """Render the deck with one unified, minimal style: 16:9, plain fonts."""
    from pptx import Presentation
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # Title slide.
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = deck["title"]
    title_p = slide.shapes.title.text_frame.paragraphs[0]
    title_p.runs[0].font.size = Pt(40)
    title_p.runs[0].font.bold = True
    sub = slide.placeholders[1].text_frame
    sub.text = deck["subtitle"] or ""
    for p in sub.paragraphs:
        for r in p.runs:
            r.font.size = Pt(20)

    # Content slides: same layout, same sizes, left-aligned.
    for s in deck["slides"]:
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = s["title"]
        tp = slide.shapes.title.text_frame.paragraphs[0]
        tp.runs[0].font.size = Pt(30)
        tp.runs[0].font.bold = True
        body = slide.placeholders[1].text_frame
        body.word_wrap = True
        if s["bullets"]:
            body.text = s["bullets"][0]
            for line in s["bullets"][1:]:
                body.add_paragraph().text = line
            for p in body.paragraphs:
                for r in p.runs:
                    r.font.size = Pt(18)
                p.space_after = Pt(10)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def invoke(method: str, args: dict) -> dict:
    # Tool methods MUST return the dispatcher contract envelope:
    #   {"success": True,  "data":  <payload-dict>}
    #   {"success": False, "error": "<reason>"}
    # Anything else surfaces to the iframe as `tool_failed`.
    if method == "ping":
        return {"success": True, "data": {"pong": True}}
    if method == "create_pptx":
        import pptx

        data = build_sample_pptx()
        uploaded = upload_to_app_files(
            data,
            path="pptx/stage1-smoke.pptx",
            content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        return {
            "success": True,
            "data": {
                "filename": "focus-flow-stage1.pptx",
                "content_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "python_pptx_version": pptx.__version__,
                "slide_count": 2,
                **uploaded,
            },
        }
    if method == "export_pptx":
        import pptx

        deck = sanitize_deck(args.get("deck"))
        data = build_deck_pptx(deck)
        safe_name = "".join(c for c in deck["title"] if c.isalnum() or c in " _-").strip() or "deck"
        uploaded = upload_to_app_files(data, path="pptx/deck.pptx", content_type=PPTX_MIME)
        return {
            "success": True,
            "data": {
                "filename": f"{safe_name[:60]}.pptx",
                "content_type": PPTX_MIME,
                "python_pptx_version": pptx.__version__,
                "slide_count": len(deck["slides"]) + 1,
                **uploaded,
            },
        }
    return {"success": False, "error": f"unknown method: {method}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            if req.get("method") == "describe":
                result = MANIFEST
            elif req.get("method") == "health":
                result = {"status": "ready"}
            elif req.get("method") == "invoke":
                result = invoke(req["params"]["tool"], req["params"].get("arguments", {}))
            else:
                raise ValueError(f"unknown rpc: {req.get('method')}")
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req.get("id"), "result": result}) + "\n")
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": req.get("id"),
                        "error": {"code": -32601, "message": str(e)},
                    }
                )
                + "\n"
            )
        sys.stdout.flush()


if __name__ == "__main__":
    main()
