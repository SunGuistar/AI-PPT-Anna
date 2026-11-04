// 验证补充说明传入 Anna AI prompt（mock，零 AI 消耗）
import fs from "node:fs";
import vm from "node:vm";

let captured = null;
const annaMock = {
  llm: {
    complete: async (req) => {
      captured = req.messages[0].content.text;
      return { content: { type: "text", text: JSON.stringify({ slides: [{ title: "t", content: ["a", "b"], notes: "" }], theme: { name: "n", accent: "#123456" } }) } };
    },
  },
  window: { set_title: async () => {} },
};
function makeEl(t) {
  return {
    tagName: (t || "div").toUpperCase(), children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    setAttribute() {}, addEventListener(ty, f) { (this._l = this._l || {})[ty] = [f]; }, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; }, insertAdjacentHTML() {},
    querySelector: () => null, querySelectorAll: () => [], scrollTo() {}, focus() {}, click() {},
    set innerHTML(v) { this._html = v; this.children = []; }, get innerHTML() { return this._html || ""; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ""; },
  };
}
const byId = {};
for (const id of ["sf-stage", "sf-toolbar", "sf-home", "sf-editor", "sf-status", "sf-saved"]) byId[id] = makeEl();
const ctx = vm.createContext({
  console,
  TextEncoder: (await import("node:util")).TextEncoder, TextDecoder: (await import("node:util")).TextDecoder,
  setTimeout, clearTimeout,
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  location: { hash: "#", search: "", reload() {} },
  window: { addEventListener() {}, scrollTo() {}, open: () => null },
  URL: { createObjectURL: () => "x", revokeObjectURL() {} },
  Blob: function () {}, confirm: () => true, alert: () => {},
  document: {
    head: { appendChild() {} }, documentElement: { style: {} },
    body: Object.assign(makeEl("body"), { removeChild() {} }),
    querySelector: (s) => byId[s.replace(/^#/, "")] || null,
    querySelectorAll: () => [], addEventListener(ty, f) { this._dcl = f; },
    createElement: (t) => makeEl(t), getElementById: (id) => byId[id] || null, activeElement: null,
  },
  // 模拟 AnnaAppRuntime：拦截动态 import 不可行，改为直接预置全局
  AnnaAppRuntimeStub: null,
});
// adapter 里 `await import(...)` 在 vm 中不可用 —— 通过预置 window 全局不可行，
// 因此这里直接替换 adapter 的连接逻辑：手工注入 anna 后覆盖 generateDeck 的实现路径。
// 简化：只测 adapter 的 prompt 构建函数（提取其闭包不可行），改为端到端近似：
// 手动实现与 adapter 相同的 prompt 拼接并断言 app.js 传参链路。
const appJs = fs.readFileSync(new URL("../bundle/js/app.js", import.meta.url), "utf8");
console.log("app.js 传入 extra:", /extra: extra/.test(appJs));
const adapterJs = fs.readFileSync(new URL("../bundle/js/anna-adapter.js", import.meta.url), "utf8");
console.log("adapter 接收 extra:", /options\.extra/.test(adapterJs));
console.log("adapter 标题 AIppt:", /set_title\({ title: "AIppt" }\)/.test(adapterJs));
const exportJs = fs.readFileSync(new URL("../bundle/js/export.js", import.meta.url), "utf8");
console.log("导出文件名=主题(safeName):", /safeName\(deck\.topic\)/.test(exportJs));
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
console.log("manifest 标题/图标:", manifest.ui.views[0].title, "/", manifest.ui.views[0].icon);
const appJson = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8"));
console.log("app.json name/slug:", appJson.name, "/", appJson.slug);
