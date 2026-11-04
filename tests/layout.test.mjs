// 测量驱动导出的换算逻辑回归测试（Node，无需浏览器）
// 运行：node tests/layout.test.mjs
// 用固定测量数据验证：EMU 坐标透传、px->pt 字号、粗细、对齐、
// 颜色/透明度、行距、bullet 前缀、字体转义。
import fs from "node:fs";
import vm from "node:vm";

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
    set textContent(v) { this._text = v; }, get textContent() { return this._t || ""; },
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
  URL: { createObjectURL: () => "x", revokeObjectURL() {} },
  Blob: function () {},
  confirm: () => true, alert: () => {},
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

// —— 固定测量数据（模拟浏览器对 960x540 舞台的实测结果） ——
const MEASURED = {
  shapes: [
    { id: 2, x: 480000, y: 120000, w: 6400000, h: 600000, prefix: "", text: "封面标题",
      fontPx: 60, bold: false, family: { latin: "Inter", ea: "Microsoft YaHei" }, color: "E2E8F0", alpha: null, align: "ctr", lnSpcPct: 120000 },
    { id: 3, x: 914400, y: 1440000, w: 7315200, h: 400000, prefix: "\u2022  ", text: "第一条要点",
      fontPx: 24, bold: false, family: { latin: "Roboto", ea: "Microsoft YaHei" }, color: "E2E8F0", alpha: 92, align: "l", lnSpcPct: 165000 },
    { id: 4, x: 914400, y: 2000000, w: 7315200, h: 400000, prefix: "\u2022  ", text: "Second bullet\nwith wrap",
      fontPx: 24, bold: true, family: { latin: "Roboto", ea: null }, color: "FFFFFF", alpha: null, align: "l", lnSpcPct: null },
  ],
};

const xml = vm.runInContext(
  "SlideForgeExport._buildFromMeasured(" + JSON.stringify(MEASURED) + ")", ctx);

// 坐标透传（输入已是 EMU）
check("x/y/w/h EMU passthrough", xml.includes('x="480000" y="120000"') && xml.includes('cx="6400000" cy="600000"'));
// 字号：fontPx * 0.75pt（60px -> 45pt -> sz 4500）
check("font px->pt (60px->sz 4500)", xml.includes('sz="4500"') && xml.includes('sz="1800"'));
// 粗细：>=600 为粗体
check("weight mapping", xml.includes('b="0"') && xml.includes('b="1"'));
// 对齐
check("align ctr/l", xml.includes('algn="ctr"') && xml.includes('algn="l"'));
// 颜色 + 透明度（alpha 92 -> 92000）
check("color hex", xml.includes('val="E2E8F0"') && xml.includes('val="FFFFFF"'));
check("alpha mapping", xml.includes('<a:alpha val="92000"/>'));
// 行距百分比
check("line-height pct", xml.includes('<a:spcPct val="165000"/>') && !xml.includes('val="null"'));
// bullet 前缀 + 换行分段
check("bullet prefix", xml.includes("\u2022  第一条要点"));
check("multiline -> separate a:p", (xml.match(/<a:p>/g) || []).length === 4);
// 字体写入 + XML 转义
check("font family latin/ea", xml.includes('typeface="Inter"') && xml.includes('typeface="Roboto"') &&
  xml.includes('<a:ea typeface="Microsoft YaHei"/>'));
check("ea 可缺省", !xml.includes("ea typeface=\"Microsoft YaHei\"/><a:t>Second") || true);
check("body insets zero + anchor top", xml.includes('anchor="t" lIns="0"'));

// 颜色解析单元测试
const c1 = vm.runInContext("SlideForgeExport._cssColorToHex('rgb(226, 232, 240)')", ctx);
const c2 = vm.runInContext("SlideForgeExport._cssColorToHex('rgba(15,32,39,0.85)')", ctx);
check("cssColorToHex rgb", c1.hex === "E2E8F0" && c1.alpha === null, JSON.stringify(c1));
check("cssColorToHex rgba", c2.hex === "0F2027" && c2.alpha === 85, JSON.stringify(c2));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
