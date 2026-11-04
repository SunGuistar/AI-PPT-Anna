// 生成浏览器预览对照页 samples/preview.html（与 app 内预览同一 CSS/同一 markup 结构）
// 运行：node tests/make-preview.mjs
import fs from "node:fs";

const deck = JSON.parse(fs.readFileSync(new URL("../bundle/js/sample-deck.json", import.meta.url), "utf8"));
const t = deck.theme;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function slideHtml(s, i, total) {
  const cls = i === 0 ? "sf-slide sf-slide-title" : i === total - 1 ? "sf-slide sf-slide-closing" : "sf-slide sf-slide-content";
  let inner;
  if (i === 0) {
    inner = `<h1 class="sf-slide-title-text">${esc(s.title)}</h1>` +
      (s.content[0] ? `<p class="sf-subtitle">${esc(s.content[0])}</p>` : "") +
      (s.content[1] ? `<p class="sf-author">${esc(s.content[1])}</p>` : "");
  } else if (i === total - 1) {
    inner = `<h1 class="sf-slide-title-text">${esc(s.title)}</h1>` +
      (s.content[0] ? `<p class="sf-closing-line">${esc(s.content[0])}</p>` : "") +
      (s.content[1] ? `<p class="sf-takeaway">${esc(s.content[1])}</p>` : "");
  } else {
    inner = `<h2 class="sf-slide-title-text">${esc(s.title)}</h2>` +
      `<ul class="sf-bullets">` + s.content.map((c) => `<li class="sf-bullet">${esc(c)}</li>`).join("") + `</ul>`;
  }
  return `<div class="sf-stage-wrap"><div class="sf-stage"><article class="${cls}"><div class="sf-inner">${inner}</div></article></div></div>`;
}

const slides = deck.slides.map((s, i) => slideHtml(s, i, deck.slides.length)).join("\n");
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>preview — 排版对照（与 app 预览同 CSS/markup，舞台 960x540）</title>
<link rel="stylesheet" href="../bundle/css/style.css">
<style>
  :root {
    --sf-accent: ${t.accent}; --sf-bg: ${t.bg}; --sf-fg: ${t.fg};
    --sf-heading-font: ${t.headingFont}; --sf-body-font: ${t.bodyFont};
  }
  body { background: #070b16; margin: 0; padding: 24px; }
  .sf-stage-wrap { min-height: 0; padding: 12px; }
  .sf-stage { width: 960px; height: 540px; margin: 0 auto; }
  .sf-slide { background: ${t.gradient}; }
  h3.cap { color: #94a3b8; font: 13px system-ui; max-width: 960px; margin: 18px auto 4px; }
</style>
</head>
<body>
<h3 class="cap">以下每页与 Anna App 内预览使用完全相同的 CSS 与 markup（舞台固定 960×540，即导出的 1px=9525EMU 基准）。请与导出的 PPTX 逐页对照。</h3>
${slides}
</body>
</html>
`;
fs.writeFileSync(new URL("../samples/preview.html", import.meta.url), html);
console.log("samples/preview.html written,", deck.slides.length, "slides");
