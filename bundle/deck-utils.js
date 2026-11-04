// Pure helpers for the AI PPT flow (no DOM, no SDK) — imported by app.js
// and unit-tested under Node with mock LLM output.

export const CONTENT_SLIDES = 4;
// Total PPTX pages = 1 cover + CONTENT_SLIDES content pages (3 body + 1 summary).

// Extract the first balanced {...} block and parse it; throws on failure.
export function extractJson(text) {
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
export function normalizeDeck(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("模型输出格式异常：不是 JSON 对象");
  }
  const t = (v, limit) => (v == null ? "" : String(v).trim().slice(0, limit));
  const title = t(raw.title, 120) || "未命名演示文稿";
  const subtitle = t(raw.subtitle, 200);
  let slides = Array.isArray(raw.slides) ? raw.slides : [];
  slides = slides.filter((s) => s && typeof s === "object");
  if (slides.length === 0) throw new Error("模型输出格式异常：缺少 slides");
  const norm = slides.slice(0, CONTENT_SLIDES).map((s, i) => {
    let bullets = Array.isArray(s.bullets) ? s.bullets : s.bullets == null ? [] : [s.bullets];
    return {
      title: t(s.title, 120) || `第 ${i + 1} 页`,
      bullets: bullets.map((b) => t(b, 200)).filter(Boolean).slice(0, 6),
    };
  });
  while (norm.length < CONTENT_SLIDES) {
    norm.push({ title: `第 ${norm.length + 1} 页`, bullets: [] });
  }
  return { title, subtitle, slides: norm };
}

// Build the generation prompt (also used by the E2E test so both stay in sync).
export function buildPrompt(topic, extra, contentSlides = CONTENT_SLIDES) {
  const user = [
    `请为演示文稿主题“${topic}”生成结构化内容。`,
    extra ? `补充要求：${extra}` : "",
    `严格输出一个 JSON 对象（不要输出任何其他文字、不要 markdown 代码块），格式：`,
    `{"title":"演示文稿标题","subtitle":"一句话副标题","slides":[{"title":"页面标题","bullets":["要点1","要点2","要点3"]}]}`,
    `要求：slides 必须恰好 ${contentSlides} 个，其中前 ${contentSlides - 1} 页为正文、第 ${contentSlides} 页为总结；每页 bullets 3-5 条，每条不超过 40 字；内容准确、简洁、适合演示。`,
  ].filter(Boolean).join("\n");
  return {
    systemPrompt:
      "你是专业的演示文稿策划。你只输出合法 JSON，不输出任何解释性文字。",
    messages: [{ role: "user", content: { type: "text", text: user } }],
    maxTokens: 2000,
    temperature: 0.7,
  };
}
