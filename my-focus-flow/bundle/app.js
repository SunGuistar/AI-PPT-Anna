// focus-flow stage 2: AI PPT — topic -> LLM deck JSON -> editable preview -> PPTX export.
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const TOOL_ID = "tool-dev-focus-flow";
const SLIDE_COUNT = 5;

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

function buildPrompt(topic, extra) {
  const user = [
    `请为演示文稿主题“${topic}”生成结构化内容。`,
    extra ? `补充要求：${extra}` : "",
    `严格输出一个 JSON 对象（不要输出任何其他文字、不要 markdown 代码块），格式：`,
    `{"title":"演示文稿标题","subtitle":"一句话副标题","slides":[{"title":"页面标题","bullets":["要点1","要点2","要点3"]}]}`,
    `要求：slides 必须恰好 ${SLIDE_COUNT} 个；每页 bullets 3-5 条，每条不超过 40 字；内容准确、简洁、适合演示。`,
  ].filter(Boolean).join("\n");
  return {
    systemPrompt:
      "你是专业的演示文稿策划。你只输出合法 JSON，不输出任何解释性文字。",
    messages: [{ role: "user", content: { type: "text", text: user } }],
    maxTokens: 2000,
    temperature: 0.7,
  };
}

// Extract the first balanced {...} block and parse it; throws on failure.
function extractJson(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("模型输出中没有 JSON 对象");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (e) {
          throw new Error("JSON 解析失败：" + e.message);
        }
      }
    }
  }
  throw new Error("模型输出的 JSON 不完整");
}

// Normalize whatever the model returned into a well-formed deck;
// throws Error with a user-facing message when unrecoverable.
function normalizeDeck(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("模型输出格式异常：不是 JSON 对象");
  }
  const t = (v, limit) => (v == null ? "" : String(v).trim().slice(0, limit));
  const title = t(raw.title, 120) || "未命名演示文稿";
  const subtitle = t(raw.subtitle, 200);
  let slides = Array.isArray(raw.slides) ? raw.slides : [];
  slides = slides.filter((s) => s && typeof s === "object");
  if (slides.length === 0) throw new Error("模型输出格式异常：缺少 slides");
  const norm = slides.slice(0, SLIDE_COUNT).map((s, i) => {
    let bullets = Array.isArray(s.bullets) ? s.bullets : s.bullets == null ? [] : [s.bullets];
    return {
      title: t(s.title, 120) || `第 ${i + 1} 页`,
      bullets: bullets.map((b) => t(b, 200)).filter(Boolean).slice(0, 6),
    };
  });
  while (norm.length < SLIDE_COUNT) {
    norm.push({ title: `第 ${norm.length + 1} 页`, bullets: [] });
  }
  return { title, subtitle, slides: norm };
}

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

function renderPreview() {
  previewEl.replaceChildren();
  deck.slides.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "slide-card";
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = `第 ${i + 1} 页`;
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
    setStatus(`已生成“${deck.title}”（${deck.slides.length} 页），可编辑后导出。`);
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
