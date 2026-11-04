// 大纲流程回归测试（Node，mock AI，零 Anna 额度消耗）
// 运行：node tests/outline.test.mjs
import fs from "node:fs";
import vm from "node:vm";

let aiCalls = 0;
let aiResponder = null;
let lastPrompt = null;
const annaMock = {
  aiJson: async (userText) => { aiCalls++; lastPrompt = userText; return aiResponder(userText); },
  deliverPPTX: async () => true,
  connected: () => true,
};

function attachQuery(el) {
  el.querySelector = function (sel) {
    const cls = sel.replace(/^\./, "");
    const stack = [...el.children];
    while (stack.length) {
      const c = stack.shift();
      if (c.classList && c.classList.contains(cls)) return c;
      stack.push(...(c.children || []));
    }
    return null;
  };
  el.querySelectorAll = function (sel) {
    const cls = sel.replace(/^\./, "");
    const out = [];
    const stack = [...el.children];
    while (stack.length) {
      const c = stack.shift();
      if (c.classList && c.classList.contains(cls)) out.push(c);
      stack.push(...(c.children || []));
    }
    return out;
  };
  return el;
}
function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [], style: {}, dataset: {}, value: "", _text: "",
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); return this._s.has(c); }, contains(c) { return this._s.has(c); } },
    setAttribute() {}, addEventListener(t, f) { (el._l = el._l || {})[t] = (el._l[t] || []).concat(f); }, removeEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => el.children.push(c)); },
    insertAdjacentHTML() {}, scrollTo() {}, focus() {}, click() {}, closest() { return null; },
    set innerHTML(v) { el._html = v; el.children = []; }, get innerHTML() { return el._html || ""; },
    set className(v) { el._cls = v; el.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return el._cls || ""; },
    set textContent(v) { el._text = v; }, get textContent() { return el._text; },
  };
  return attachQuery(el);
}

const byId = {};
for (const id of ["sf-home", "sf-outline", "sf-editor", "sf-saved", "sf-status", "sf-stage", "sf-toolbar",
  "sf-form", "sf-topic", "sf-count", "sf-audience", "sf-tone", "sf-extra", "sf-generate-btn",
  "sf-outline-list", "sf-outline-meta", "sf-outline-feedback", "sf-outline-update", "sf-outline-confirm",
  "sf-outline-add", "sf-outline-back"]) {
  byId[id] = makeEl(id === "sf-form" ? "form" : id.includes("topic") || id.includes("count") || id.includes("audience") ? "input" : "div");
}

const documentShim = {
  head: { appendChild() {} }, documentElement: { style: {} },
  body: makeEl("body"),
  querySelector: (s) => byId[s.replace(/^#/, "")] || null,
  querySelectorAll: (s) => {
    if (s === ".sf-outline-card") return byId["sf-outline-list"].querySelectorAll(".sf-outline-card");
    if (s === ".sf-example" || s === ".sf-example-prompt") return [];
    return [];
  },
  addEventListener(t, f) { documentShim._l = documentShim._l || {}; documentShim._l[t] = f; },
  createElement: (t) => makeEl(t),
  getElementById: (id) => byId[id] || null,
  activeElement: null,
};

const ctx = vm.createContext({
  console,
  TextEncoder: (await import("node:util")).TextEncoder,
  TextDecoder: (await import("node:util")).TextDecoder,
  setTimeout, clearTimeout,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  location: { hash: "", search: "", reload() {} },
  window: { addEventListener() {}, scrollTo() {}, open: () => null },
  URL: { createObjectURL: () => "x", revokeObjectURL() {} },
  Blob: function () {}, confirm: () => true, alert: () => {},
  document: documentShim,
  AnnaBridge: annaMock,
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
});
for (const f of ["config", "ai", "slides", "editor", "export", "outline", "app"]) {
  vm.runInContext(fs.readFileSync(new URL(`../bundle/js/${f}.js`, import.meta.url), "utf8"), ctx, { filename: f + ".js" });
}

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  console.log(cond ? "PASS" : "FAIL", name, extra);
  cond ? pass++ : fail++;
};

const FIXED_OUTLINE = {
  slides: [
    { title: "封面", points: ["副标题", "署名"] },
    { title: "第二页标题", points: ["要点A1", "要点A2", "要点A3"] },
    { title: "第三页标题", points: ["要点B1", "要点B2"] },
    { title: "总结", points: ["谢谢", "展望"] },
  ],
  theme: { name: "科技蓝", accent: "#00D4FF" },
};

/* ---------- 1) prompt 构建 ---------- */
const p1 = vm.runInContext(
  "SlideForgeOutline.buildInitialPrompt({topic:'人工智能在教育',count:5,audience:'大学生',tone:'professional',extra:'要有案例'})", ctx);
check("初始 prompt 含主题/页数/受众/语气/补充", ["人工智能在教育", "5 页", "大学生", "professional", "要有案例"].every((x) => p1.includes(x)));
check("初始 prompt 要求内容型大纲+JSON", p1.includes("完整") && p1.includes("JSON"));

const p2 = vm.runInContext(
  "SlideForgeOutline.buildUpdatePrompt({topic:'T',count:5,audience:'',tone:'',extra:''}," +
  JSON.stringify({ slides: FIXED_OUTLINE.slides }) + ",'删除第二页')", ctx);
check("更新 prompt 含初始要求+当前大纲+新要求",
  p2.includes("【用户的初始要求】") && p2.includes("【当前大纲】") && p2.includes("删除第二页") && p2.includes("第二页标题"));

/* ---------- 2) 规范化 ---------- */
const norm = vm.runInContext("SlideForgeOutline.normalizeOutline(" + JSON.stringify(JSON.stringify(FIXED_OUTLINE)) + ")", ctx);
check("normalizeOutline 页数/要点保留", norm.slides.length === 4 && norm.slides[1].points.length === 3);
let threw = false;
try { vm.runInContext("SlideForgeOutline.normalizeOutline('没有JSON的文本')", ctx); } catch (e) { threw = true; }
check("非法输出抛错（用于失败回滚）", threw);

/* ---------- 3) outlineToDeck 确定性转换（零 AI） ---------- */
const callsBefore = aiCalls;
const deck = vm.runInContext(
  "SlideForgeOutline.outlineToDeck(" + JSON.stringify(norm) + ",{topic:'人工智能在教育'},null)", ctx);
check("确认转换 0 次 AI 调用", aiCalls === callsBefore);
check("deck 页数/顺序/标题/要点严格一致",
  deck.slides.length === 4 && deck.slides[1].title === "第二页标题" && deck.slides[1].content.join("|") === "要点A1|要点A2|要点A3");
check("封面映射 content=[副标题,署名]", deck.slides[0].content.join("|") === "副标题|署名");
check("主题继承", deck.theme.accent === "#00D4FF");

/* ---------- 4) 手动加页后不被初始页数压缩 ---------- */
const norm7 = vm.runInContext("SlideForgeOutline.normalizeOutline(" + JSON.stringify(JSON.stringify({
  slides: FIXED_OUTLINE.slides.concat([{ title: "加页1", points: ["x"] }, { title: "加页2", points: ["y"] }, { title: "加页3", points: ["z"] }]),
})) + ")", ctx);
const deck7 = vm.runInContext("SlideForgeOutline.outlineToDeck(" + JSON.stringify(norm7) + ",{topic:'t',count:5},null)", ctx);
check("用户加页后仍为 7 页", deck7.slides.length === 7);

/* ---------- 5) 端到端：真实 app.js + mock AI 计数 ---------- */
aiCalls = 0;
aiResponder = () => JSON.stringify(FIXED_OUTLINE);
vm.runInContext("document._l['DOMContentLoaded']()", ctx); // init

byId["sf-topic"].value = "人工智能在教育";
byId["sf-count"].value = "4";
byId["sf-audience"].value = "大学生";
byId["sf-tone"].value = "professional";
byId["sf-extra"].value = "要有案例";

const submit = byId["sf-form"]._l["submit"][0];
await submit({ preventDefault() {} });
check("e2e: 初次生成大纲 = 1 次 AI 调用", aiCalls === 1, `(${aiCalls})`);
let st = vm.runInContext("SlideForgeApp._state()", ctx);
check("e2e: 进入大纲阶段且 4 页", st.phase === "outline" && st.outline.slides.length === 4);

// 手动编辑第二页标题
const cards = byId["sf-outline-list"].querySelectorAll(".sf-outline-card");
cards[1].querySelector(".sf-oc-title").value = "我手动改过的标题";

// 确认大纲：不得调用 AI
await byId["sf-outline-confirm"]._l["click"][0]();
check("e2e: 确认大纲后 AI 调用仍为 1（0 新增）", aiCalls === 1, `(${aiCalls})`);
const deckNow = vm.runInContext("SlideForgeSlides.getDeck()", ctx);
st = vm.runInContext("SlideForgeApp._state()", ctx);
check("e2e: PPT 与确认大纲一致（页数/手动修改生效）",
  st.phase === "slides" && deckNow.slides.length === 4 && deckNow.slides[1].title === "我手动改过的标题");

// 返回大纲 → 更新大纲（AI 一次）→ 更新失败回滚
vm.runInContext("SlideForgeApp.returnToOutline()", ctx);
byId["sf-outline-feedback"].value = "增加一页附录";
aiResponder = () => JSON.stringify({
  slides: FIXED_OUTLINE.slides.concat([{ title: "附录", points: ["补充资料"] }]),
  theme: { name: "科技蓝", accent: "#00D4FF" },
});
const upd = byId["sf-outline-confirm"] && byId["sf-outline-update"]._l["click"][0];
await upd();
check("e2e: 更新大纲 = 再 1 次 AI（共 2）", aiCalls === 2, `(${aiCalls})`);
st = vm.runInContext("SlideForgeApp._state()", ctx);
check("e2e: 更新后为 5 页（AI 按修改要求扩页）", st.outline.slides.length === 5);
check("e2e: 手动修改已进入更新请求（AI 据此保留）", lastPrompt.includes("我手动改过的标题"));
check("e2e: 更新成功后清空修改要求框", byId["sf-outline-feedback"].value === "");

aiResponder = () => { throw new Error("模拟 AI 失败"); };
byId["sf-outline-feedback"].value = "这次会失败";
const beforeSlides = JSON.stringify(vm.runInContext("SlideForgeApp._state().outline.slides", ctx));
await byId["sf-outline-update"]._l["click"][0]();
st = vm.runInContext("SlideForgeApp._state()", ctx);
check("e2e: 更新失败保留原大纲（仍 5 页，内容不变）",
  st.outline.slides.length === 5 && JSON.stringify(st.outline.slides) === beforeSlides);
check("e2e: AI 失败仍计 1 次尝试（共 3）", aiCalls === 3, `(${aiCalls})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
