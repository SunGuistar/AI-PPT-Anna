// focus-flow stage 3: AI PPT — topic -> LLM deck JSON -> editable preview (1:1
// with the exported pages) -> PPTX export.
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import { CONTENT_SLIDES, buildPrompt, extractJson, normalizeDeck } from "./deck-utils.js";

// Resolved at publish time from bundle/anna-tool-ids.js (window global set by
// the auto-generated sidecar); the fallback is the local `anna-app dev` id.
const TOOL_ID =
  (typeof window !== "undefined" &&
    window.__ANNA_TOOL_IDS__ &&
    window.__ANNA_TOOL_IDS__["focus-flow"]) ||
  "tool-dev-focus-flow";

const statusEl = document.getElementById("status");
const topicEl = document.getElementById("topic");
const extraEl = document.getElementById("extra");
const genBtn = document.getElementById("gen-btn");
const exportBtn = document.getElementById("export-btn");
const previewEl = document.getElementById("preview");

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", isErr);
}

let anna = null;
let deck = null; // normalized deck {title, subtitle, slides:[{title, bullets:[]}]}

async function main() {
  try {
    anna = await AnnaAppRuntime.connect();
  } catch (e) {
    setStatus("Standalone preview (no host).", true);
    genBtn.disabled = true;
    return;
  }
  await anna.window.set_title({ title: "focus-flow" });
  setStatus("就绪：输入主题，点击“生成内容”。");
}

// ── LLM ──────────────────────────────────────────────────────

async function generateDeck(topic, extra) {
  const req = buildPrompt(topic, extra);
  const res = await anna.llm.complete(req);
  const text = res.content?.text ?? "";
  if (!text.trim()) throw new Error("模型返回了空内容");
  let raw;
  try {
    raw = extractJson(text);
  } catch (e) {
    // One repair attempt: ask the model to re-emit strict JSON.
    const repair = await anna.llm.complete({
      messages: [
        { role: "user", content: { type: "text", text: req.messages[0].content.text } },
        { role: "assistant", content: { type: "text", text } },
        {
          role: "user",
          content: {
            type: "text",
            text: "你上次没有输出合法 JSON。请重新输出，只输出 JSON 对象本身。",
          },
        },
      ],
      maxTokens: 2000,
      temperature: 0.3,
    });
    const text2 = repair.content?.text ?? "";
    if (!text2.trim()) throw new Error("模型修复重试返回了空内容");
    raw = extractJson(text2);
  }
  return normalizeDeck(raw);
}

// ── Preview / editing ────────────────────────────────────────

// One card per PPTX page: cover (title/subtitle) + content slides,
// so the preview matches the exported file 1:1.
function renderPreview() {
  previewEl.replaceChildren();

  const cover = document.createElement("div");
  cover.className = "slide-card";
  const coverNum = document.createElement("div");
  coverNum.className = "num";
  coverNum.textContent = "封面（第 1 页）";
  const coverTitle = document.createElement("input");
  coverTitle.type = "text";
  coverTitle.value = deck.title;
  coverTitle.addEventListener("input", () => (deck.title = coverTitle.value));
  const coverSub = document.createElement("textarea");
  coverSub.rows = 2;
  coverSub.value = deck.subtitle;
  coverSub.placeholder = "副标题（可选）";
  coverSub.addEventListener("input", () => (deck.subtitle = coverSub.value));
  cover.append(coverNum, coverTitle, coverSub);
  previewEl.appendChild(cover);

  const pageLabel = (i) =>
    i < CONTENT_SLIDES - 1 ? `正文（第 ${i + 2} 页）` : `总结（第 ${CONTENT_SLIDES + 1} 页）`;
  deck.slides.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "slide-card";
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = pageLabel(i);
    const title = document.createElement("input");
    title.type = "text";
    title.value = s.title;
    title.addEventListener("input", () => (s.title = title.value));
    const bullets = document.createElement("textarea");
    bullets.rows = Math.max(3, s.bullets.length + 1);
    bullets.value = s.bullets.join("\n");
    bullets.placeholder = "每行一个要点";
    bullets.addEventListener("input", () => {
      s.bullets = bullets.value.split("\n").map((x) => x.trim()).filter(Boolean);
    });
    card.append(num, title, bullets);
    previewEl.appendChild(card);
  });
}

// ── Actions ──────────────────────────────────────────────────

genBtn.addEventListener("click", async () => {
  const topic = topicEl.value.trim();
  if (!topic) {
    setStatus("请先输入 PPT 主题。", true);
    return;
  }
  genBtn.disabled = true;
  exportBtn.disabled = true;
  setStatus("正在调用 Anna LLM 生成内容…");
  try {
    deck = await generateDeck(topic, extraEl.value.trim());
    renderPreview();
    exportBtn.disabled = false;
    setStatus(`已生成“${deck.title}”（共 ${deck.slides.length + 1} 页：封面 + ${deck.slides.length} 内容页），可编辑后导出。`);
  } catch (e) {
    deck = null;
    previewEl.replaceChildren();
    setStatus("生成失败：" + (e.message || JSON.stringify(e)), true);
  } finally {
    genBtn.disabled = false;
  }
});

exportBtn.addEventListener("click", async () => {
  if (!deck) return;
  exportBtn.disabled = true;
  setStatus("正在导出 PPTX…");
  try {
    // The SDK resolves with the tool's `data` payload and rejects on failure.
    const out = await anna.tools.invoke({
      tool_id: TOOL_ID,
      method: "export_pptx",
      args: { deck },
    });
    await anna.files.download({ path: out.path, filename: out.filename });
    setStatus(`已导出 ${out.filename}（${out.size_bytes} 字节），浏览器将开始下载。`);
  } catch (e) {
    setStatus("导出失败：" + (e.message || JSON.stringify(e)), true);
  } finally {
    exportBtn.disabled = false;
  }
});

main();
