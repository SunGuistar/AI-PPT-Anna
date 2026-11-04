// Mock-data unit tests for bundle/deck-utils.js — no LLM quota consumed.
// Run: node tests/deck-utils.test.mjs
import { CONTENT_SLIDES, buildPrompt, extractJson, normalizeDeck } from "../bundle/deck-utils.js";

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "—", e.message);
  }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`);
}

const GOOD_JSON = JSON.stringify({
  title: "人工智能在教育中的应用",
  subtitle: "科技赋能学习",
  slides: [
    { title: "引言", bullets: ["a", "b", "c"] },
    { title: "正文一", bullets: ["d", "e"] },
    { title: "正文二", bullets: ["f"] },
    { title: "总结", bullets: ["g", "h"] },
  ],
});

// ── extractJson ──────────────────────────────────────────────
check("extractJson: pure JSON", () => eq(extractJson(GOOD_JSON).title, "人工智能在教育中的应用", "title"));
check("extractJson: JSON wrapped in prose", () => {
  const r = extractJson('这是结果：\n```json\n' + GOOD_JSON + "\n```\n以上。");
  eq(r.slides.length, 4, "slides");
});
check("extractJson: braces and escaped quotes inside strings", () => {
  const r = extractJson('{"title":"包含{大括号}和\\"引号\\"","slides":[{"title":"x","bullets":["{}"]}]}');
  eq(r.title, '包含{大括号}和"引号"', "title");
});
check("extractJson: trailing garbage ignored", () => {
  const r = extractJson(GOOD_JSON + "\n(truncated prose after)");
  eq(r.subtitle, "科技赋能学习", "subtitle");
});
check("extractJson: no JSON -> throws", () => {
  let threw = false;
  try { extractJson("抱歉，我无法生成。"); } catch { threw = true; }
  if (!threw) throw new Error("expected throw");
});
check("extractJson: unbalanced -> throws", () => {
  let threw = false;
  try { extractJson('{"title":"x","slides":[{"title":"a"'); } catch { threw = true; }
  if (!threw) throw new Error("expected throw");
});

// ── normalizeDeck ────────────────────────────────────────────
check("normalizeDeck: good deck passes through (4 slides)", () => {
  const d = normalizeDeck(JSON.parse(GOOD_JSON));
  eq(d.slides.length, CONTENT_SLIDES, "slide count");
});
check("normalizeDeck: extra slides truncated to 4", () => {
  const raw = JSON.parse(GOOD_JSON);
  raw.slides.push({ title: "多出来的", bullets: ["x"] });
  eq(normalizeDeck(raw).slides.length, 4, "slide count");
});
check("normalizeDeck: missing slides padded to 4", () => {
  const raw = JSON.parse(GOOD_JSON);
  raw.slides = raw.slides.slice(0, 2);
  const d = normalizeDeck(raw);
  eq(d.slides.length, 4, "slide count");
  eq(d.slides[3].title, "第 4 页", "padded title");
});
check("normalizeDeck: string bullets coerced to array", () => {
  const d = normalizeDeck({ title: "t", slides: [{ title: "a", bullets: "单条要点" }] });
  eq(d.slides[0].bullets, ["单条要点"], "bullets");
});
check("normalizeDeck: non-string values coerced + trimmed", () => {
  const d = normalizeDeck({ title: 123, slides: [{ title: "  a  ", bullets: [42, "  ", null] }] });
  eq(d.title, "123", "title");
  eq(d.slides[0].title, "a", "slide title");
  eq(d.slides[0].bullets, ["42"], "bullets");
});
check("normalizeDeck: empty title falls back", () => {
  const d = normalizeDeck({ slides: [{ bullets: ["a"] }] });
  eq(d.title, "未命名演示文稿", "title");
  eq(d.slides[0].title, "第 1 页", "slide title");
});
check("normalizeDeck: >6 bullets capped, empties dropped", () => {
  const d = normalizeDeck({ title: "t", slides: [{ title: "a", bullets: ["1", "2", "3", "4", "5", "6", "7", ""] }] });
  eq(d.slides[0].bullets.length, 6, "bullet count");
});
check("normalizeDeck: not an object -> throws", () => {
  let threw = false;
  try { normalizeDeck([1, 2, 3]); } catch { threw = true; }
  if (!threw) throw new Error("expected throw");
});
check("normalizeDeck: no slides at all -> throws", () => {
  let threw = false;
  try { normalizeDeck({ title: "t", slides: [] }); } catch { threw = true; }
  if (!threw) throw new Error("expected throw");
});

// ── buildPrompt ──────────────────────────────────────────────
check("buildPrompt: asks for exactly 4 content slides (3 body + 1 summary)", () => {
  const p = buildPrompt("主题X", "要求Y");
  const text = p.messages[0].content.text;
  if (!text.includes("恰好 4 个")) throw new Error("missing slide-count requirement");
  if (!text.includes("前 3 页为正文、第 4 页为总结")) throw new Error("missing body/summary split");
  if (!text.includes("主题X") || !text.includes("要求Y")) throw new Error("missing topic/extra");
  eq(p.maxTokens, 2000, "maxTokens");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
