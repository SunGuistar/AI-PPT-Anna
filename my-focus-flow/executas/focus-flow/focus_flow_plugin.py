"""Stdio plugin for the focus-flow Anna App (stage 1: PPTX pipeline)."""

import io
import json
import sys
import urllib.request

MANIFEST = {
    "name": "tool-dev-focus-flow",
    "version": "0.1.0",
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
        {"path": path, "content_type": content_type, "size_bytes": len(data)},
    )
    put_url = init.get("put_url") or init.get("upload_url")
    if not put_url:
        raise RuntimeError(f"files/upload_begin returned no put_url: {sorted(init)}")
    req = urllib.request.Request(
        put_url,
        data=data,
        headers={str(k): str(v) for k, v in (init.get("headers") or {}).items()},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        etag = resp.headers.get("ETag")
    if not etag:
        raise RuntimeError("PUT to presigned upload URL returned no ETag")
    done = host_call(
        "files/upload_complete",
        {"path": path, "etag": etag, "size_bytes": len(data)},
    )
    return {"path": done.get("path", path), "size_bytes": len(data)}


def build_sample_pptx() -> bytes:
    """Fixed two-slide deck (stage 1 placeholder content)."""
    from pptx import Presentation
    from pptx.util import Inches, Pt

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

    # Keep font sizes reasonable on the default template.
    for s in prs.slides:
        if s.shapes.title is not None:
            s.shapes.title.text_frame.paragraphs[0].runs[0].font.size = Pt(40)

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
