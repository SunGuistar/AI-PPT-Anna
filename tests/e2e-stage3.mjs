// Stage-3 E2E: real Anna LLM -> deck-utils parse/normalize -> export_pptx
// -> files.download -> save. Run with the harness up (`anna-app dev --storage aps`).
// Usage: node tests/e2e-stage3.mjs [topic]
import { CONTENT_SLIDES, buildPrompt, extractJson, normalizeDeck } from "../bundle/deck-utils.js";
import fs from "node:fs";

const BASE = "http://127.0.0.1:5180";
const TOOL = "tool-dev-focus-flow";
const topic = process.argv[2] || "远程办公的最佳实践";

const sid = (await (await fetch(`${BASE}/api/session/create`, { method: "POST" })).json()).session_id;
async function call(ns, method, args) {
  const r = await fetch(`${BASE}/api/session/call`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sid, ns, method, args }),
  });
  return r.json();
}

// 1. real LLM generation (stage-3 prompt: 4 content slides = 3 body + 1 summary)
console.log("1) llm.complete (real) …");
const req = buildPrompt(topic, "");
const res = await call("llm", "complete", req);
if (!res.ok) { console.log("LLM FAILED:", JSON.stringify(res).slice(0, 300)); process.exit(1); }
const text = res.result.content?.text ?? "";
console.log("   model:", res.result.model, "| stopReason:", res.result.stopReason, "| text len:", text.length);

// 2. parse + normalize (same code path as the browser bundle)
const raw = extractJson(text);
const deck = normalizeDeck(raw);
console.log("2) deck:", deck.title, "| content slides:", deck.slides.length, "(expect", CONTENT_SLIDES + ")", "| bullets/slide:", deck.slides.map(s => s.bullets.length).join(","));

// 3. simulate user editing slide 2 title (proves edited content reaches the file)
deck.slides[1].title = deck.slides[1].title + "（已编辑）";

// 4. export via the executa
console.log("3) export_pptx …");
const out = await call("tools", "invoke", { tool_id: TOOL, method: "export_pptx", args: { deck } });
if (!out.ok) { console.log("EXPORT FAILED:", JSON.stringify(out).slice(0, 300)); process.exit(1); }
console.log("   export ok:", JSON.stringify(out.result).slice(0, 180));

// 5. download + save
const dl = await call("files", "download", { path: out.result.path, filename: out.result.filename });
if (!dl.ok) { console.log("DOWNLOAD FAILED:", JSON.stringify(dl).slice(0, 300)); process.exit(1); }
const buf = Buffer.from(await (await fetch(dl.result.get_url)).arrayBuffer());
fs.writeFileSync("C:/Users/23830/AppData/Local/Temp/stage3-e2e.pptx", buf);
console.log("4) downloaded:", buf.length, "bytes | zip magic:", buf.slice(0, 2).toString() === "PK");
fs.writeFileSync("C:/Users/23830/AppData/Local/Temp/stage3-deck.json", JSON.stringify(deck, null, 2));
console.log("DONE");
