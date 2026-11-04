// 纯前端 PPTX 导出回归测试（Node，无需浏览器/网络）
// 运行：node tests/export.test.mjs
// 校验 bundle/js/export.js 生成的 PPTX 包：ZIP 结构、内容类型、
// 页数、关系 id、slide XML 合法性，以及主题映射
// （渐变背景/角度换算、字体、前景色）与多要点不溢出。
import fs from "node:fs";
import vm from "node:vm";

let zipBytes = null;
function makeEl(tag) {
  return {
    tagName: (tag || "div").toUpperCase(),
    children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    setAttribute() {}, addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    insertAdjacentHTML() {}, querySelector: () => null, querySelectorAll: () => [],
    scrollTo() {}, focus() {}, click() {},
    set innerHTML(v) { this._html = v; this.children = []; }, get innerHTML() { return this._html || ""; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ""; },
  };
}
const byId = {};
for (const id of ["sf-stage", "sf-toolbar", "sf-home", "sf-editor", "sf-status", "sf-saved"]) byId[id] = makeEl();

const ctx = vm.createContext({
  console,
  TextEncoder: (await import("node:util")).TextEncoder,
  TextDecoder: (await import("node:util")).TextDecoder,
  setTimeout, clearTimeout,
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  location: { hash: "#", reload() {} },
  window: { addEventListener() {}, scrollTo() {}, open: () => null },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
  Blob: function (parts) { zipBytes = Buffer.concat(parts.map((p) => Buffer.from(p))); },
  confirm: () => true, alert: (m) => console.log("ALERT:", m),
  document: {
    head: { appendChild() {} }, documentElement: { style: {} },
    body: Object.assign(makeEl("body"), { removeChild() {} }),
    querySelector: (s) => byId[s.replace(/^#/, "")] || null,
    querySelectorAll: () => [], addEventListener() {},
    createElement: (t) => makeEl(t), getElementById: (id) => byId[id] || null, activeElement: null,
  },
});
for (const f of ["config", "ai", "slides", "editor", "export"]) {
  vm.runInContext(fs.readFileSync(new URL(`../bundle/js/${f}.js`, import.meta.url), "utf8"), ctx, { filename: f + ".js" });
}

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  console.log(cond ? "PASS" : "FAIL", name, extra);
  cond ? pass++ : fail++;
};

async function exportDeck(spec) {
  zipBytes = null;
  await vm.runInContext(
    "SlideForgeSlides.loadDeck(SlideForgeAI.normalizeDeck(" + JSON.stringify(JSON.stringify(spec)) + "));" +
    "SlideForgeExport.downloadPPTX();",
    ctx
  );
  await new Promise((r) => setTimeout(r, 50));
  return zipBytes;
}

const THEME = {
  name: "T", accent: "#00D4FF", bg: "#0F2027", fg: "#E2E8F0",
  gradient: "linear-gradient(135deg,#0F2027 0%,#203A43 50%,#2C5364 100%)",
  headingFont: "Inter", bodyFont: "Roboto",
};
const DECK_A = {
  slides: [
    { title: "封面标题", content: ["副标题", "作者"], notes: "" },
    { title: "正文页", content: ["一", "二", "三", "四", "五", "六", "七", "八"], notes: "" },
    { title: "结尾", content: ["谢谢", "takeaway"], notes: "" },
  ],
  theme: THEME,
};

const zipA = await exportDeck(DECK_A);
check("A: PPTX bytes produced", zipA && zipA.length > 3000, `(${zipA ? zipA.length : 0}B)`);
check("A: ZIP magic PK", zipA.slice(0, 2).toString() === "PK");
fs.writeFileSync(new URL("./out-a.pptx", import.meta.url), zipA);

// 角度换算第二锚点：CSS 180deg(to bottom) == OOXML 5400000
const zipB = await exportDeck({
  slides: [{ title: "t", content: ["s"], notes: "" }],
  theme: { ...THEME, gradient: "linear-gradient(180deg,#111111 0%,#EEEEEE 100%)" },
});
fs.writeFileSync(new URL("./out-b.pptx", import.meta.url), zipB);

const pyScript = [
  "import zipfile, re, xml.dom.minidom",
  "def slide(z, n): return z.read('ppt/slides/slide%d.xml' % n).decode()",
  "",
  "zA = zipfile.ZipFile('tests/out-a.pptx')",
  "names = zA.namelist()",
  "assert '[Content_Types].xml' in names and '_rels/.rels' in names",
  "ct = zA.read('[Content_Types].xml').decode()",
  "assert 'presentationml.presentation.main+xml' in ct",
  "pres = zA.read('ppt/presentation.xml').decode()",
  "rels = zA.read('ppt/_rels/presentation.xml.rels').decode()",
  "sldids = re.findall(r'sldId id=\"\\d+\" r:id=\"(rId\\d+)\"', pres)",
  "assert all(r in rels for r in sldids)",
  "slides = [n for n in names if re.match(r'ppt/slides/slide\\d+\\.xml$', n)]",
  "assert len(slides) == 3, 'slide count %d' % len(slides)",
  "for s in slides: xml.dom.minidom.parseString(zA.read(s))",
  "",
  "s1 = slide(zA, 1)",
  "# 主题映射：背景渐变（CSS 135deg -> OOXML ang 2700000）与颜色",
  "assert '<p:bg>' in s1 and 'gradFill' in s1, 'bg/gradFill missing'",
  "assert 'ang=\"2700000\"' in s1, '135deg->2700000 conversion wrong'",
  "assert 'pos=\"0\"><a:srgbClr val=\"0F2027\"' in s1, 'grad start color wrong'",
  "assert 'pos=\"50000\"><a:srgbClr val=\"203A43\"' in s1, 'grad mid color wrong'",
  "assert 'pos=\"100000\"><a:srgbClr val=\"2C5364\"' in s1, 'grad end color wrong'",
  "# 字体与前景色",
  "assert 'typeface=\"Inter\"' in s1, 'heading font missing'",
  "assert 'typeface=\"Roboto\"' in s1, 'body font missing'",
  "assert 'val=\"E2E8F0\"' in s1, 'fg color missing'",
  "",
  "# 溢出：8 条要点的正文页，所有形状须在幻灯片高度内",
  "s2 = slide(zA, 2)",
  "ys = [int(m) for m in re.findall(r'<a:off x=\"\\d+\" y=\"(\\d+)\"/>', s2)]",
  "hs = [int(m) for m in re.findall(r'<a:ext cx=\"\\d+\" cy=\"(\\d+)\"/>', s2)]",
  "assert max(y + h for y, h in zip(ys, hs)) <= 5143500, 'shape overflows slide'",
  "",
  "# 角度第二锚点：CSS 180deg == OOXML 5400000",
  "zB = zipfile.ZipFile('tests/out-b.pptx')",
  "sB = slide(zB, 1)",
  "assert 'ang=\"5400000\"' in sB, '180deg->5400000 conversion wrong'",
  "",
  "print('python-theme-check OK | slides:', len(slides))",
].join("\n");
const { execFileSync } = await import("node:child_process");
const py = execFileSync("python", ["-c", pyScript], { cwd: "E:/anna/my-focus-flow" }).toString().trim();
console.log(py);
check("structure + theme mapping", py.includes("OK"));

fs.rmSync(new URL("./out-a.pptx", import.meta.url));
fs.rmSync(new URL("./out-b.pptx", import.meta.url));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
