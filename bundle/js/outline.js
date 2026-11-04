/**
 * AIppt — 大纲模块
 * 内容型大纲的 prompt 构建、校验规范化，以及大纲 -> SlideForge deck 的
 * 确定性转换（确认大纲后纯前端执行，零 AI 调用）。
 *
 * 数据结构：
 *   initialRequest = { topic, count, audience, tone, extra }
 *   outline        = { slides: [{ title, points: [1..6 strings] }], theme }
 *   deck(SlideForge) = { id, topic, slides: [{title, content[], notes}], theme, createdAt }
 */
if (typeof SlideForgeOutline === "undefined") {
var SlideForgeOutline = (function () {
  "use strict";

  var SYS = "你是专业的演示文稿策划。你只输出合法 JSON，不输出任何解释性文字。";

  function buildInitialPrompt(req) {
    var count = Math.max(3, Math.min(20, parseInt(req.count, 10) || 5));
    return [
      "请为演示文稿生成内容型大纲（不是简单目录，而是可以直接展示在 PPT 上的完整内容要点）。",
      "PPT 主题：" + req.topic,
      "页数：恰好 " + count + " 页",
      "目标受众：" + (req.audience || "通用受众"),
      "演讲语气：" + (req.tone || "专业"),
      req.extra ? "补充说明：" + req.extra : "",
      "",
      "严格输出一个 JSON 对象（不要 markdown 代码块）：",
      '{"slides":[{"title":"页面标题","points":["完整的内容要点句子，3~5 条","每条是有实际信息的完整句子，不是关键词"]}],"theme":{"name":"主题名","accent":"#RRGGBB","gradient":"linear-gradient(...)"}}',
      "要求：",
      "1. slides 必须恰好 " + count + " 页；第 1 页为封面（title=主标题，points[0]=副标题，points[1]=署名/日期，可省略）；最后一页为总结页（points 为总结要点）。",
      "2. 中间每页 points 为 3~5 条完整句子，信息具体、可直接上屏。",
      "3. theme 颜色贴合主题。",
    ].filter(Boolean).join("\n");
  }

  function buildUpdatePrompt(req, outline, feedback) {
    return [
      "请根据用户的新要求修改下面的演示文稿大纲。",
      "",
      "【用户的初始要求】",
      "PPT 主题：" + req.topic,
      "页数：" + req.count,
      "目标受众：" + (req.audience || "通用受众"),
      "演讲语气：" + (req.tone || "专业"),
      req.extra ? "补充说明：" + req.extra : "",
      "",
      "【当前大纲】（JSON，已包含用户的手动修改）",
      JSON.stringify({ slides: outline.slides }),
      "",
      "【本次修改要求】",
      feedback,
      "",
      "规则：",
      "1. 默认保留未被要求修改的页面内容、页面数量和顺序。",
      "2. 仅当用户明确要求添加/删除/重排页面时才改变结构。",
      "3. 用户手动修改过的内容视为最新版本，不得回退。",
      "4. 不要因为初始页数是 " + req.count + " 就把用户后来增加或减少的页面恢复回去。",
      "5. 输出完整的新大纲 JSON（含全部页面与 theme），不要输出解释。",
    ].join("\n");
  }

  /** 校验并规范化大纲；结构非法时抛错（调用方保留旧大纲）。 */
  function normalizeOutline(raw) {
    var obj = typeof raw === "string" ? SlideForgeAI.extractJSON(raw) : raw;
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.slides) || !obj.slides.length) {
      throw new Error("AI 输出格式异常：缺少 slides");
    }
    var t = function (v, limit) { return v == null ? "" : String(v).trim().slice(0, limit); };
    var slides = obj.slides.map(function (s, i) {
      if (!s || typeof s !== "object") throw new Error("第 " + (i + 1) + " 页格式异常");
      var points = Array.isArray(s.points) ? s.points : s.points == null ? [] : [s.points];
      return {
        title: t(s.title, 200) || ("第 " + (i + 1) + " 页"),
        points: points.map(function (p) { return t(p, 300); }).filter(Boolean).slice(0, 6),
      };
    });
    // 主题：缺省时由调用方沿用旧主题；此处仅做字段清洗
    var theme = null;
    if (obj.theme && typeof obj.theme === "object") {
      theme = {
        name: t(obj.theme.name, 80) || "默认主题",
        accent: /^#[0-9a-fA-F]{3,8}$/.test(obj.theme.accent || "") ? obj.theme.accent : null,
        gradient: /^linear-gradient/i.test(obj.theme.gradient || "") ? obj.theme.gradient : null,
        bg: t(obj.theme.bg, 20) || null,
        fg: t(obj.theme.fg, 20) || null,
        headingFont: t(obj.theme.headingFont, 80) || null,
        bodyFont: t(obj.theme.bodyFont, 80) || null,
      };
    }
    return { slides: slides, theme: theme };
  }

  /**
   * 确定性转换：大纲 -> SlideForge deck。零 AI 调用。
   * 页数/顺序/标题/要点严格一致；第 1 页与最后一页按现有封面/结尾版式映射。
   */
  function outlineToDeck(outline, req, fallbackTheme) {
    var base = fallbackTheme || (SlideForgeAI.FALLBACK_THEMES && SlideForgeAI.FALLBACK_THEMES[0]) || {};
    var ot = outline.theme || {};
    var theme = {
      name: ot.name || base.name || "默认主题",
      bg: ot.bg || base.bg || "#0f172a",
      fg: ot.fg || base.fg || "#e2e8f0",
      accent: ot.accent || base.accent || "#6366f1",
      gradient: ot.gradient || base.gradient || null,
      headingFont: ot.headingFont || base.headingFont || "system-ui, sans-serif",
      bodyFont: ot.bodyFont || base.bodyFont || "system-ui, sans-serif",
    };
    if (!theme.gradient) {
      theme.gradient = "linear-gradient(135deg," + theme.bg + " 0%," + theme.accent + " 100%)";
    }
    var n = outline.slides.length;
    var slides = outline.slides.map(function (s, i) {
      if (i === 0) {
        return { title: s.title, content: [s.points[0] || "", s.points[1] || ""].filter(Boolean), notes: "" };
      }
      if (i === n - 1) {
        return { title: s.title, content: s.points.slice(0, 2), notes: "" };
      }
      return { title: s.title, content: s.points.slice(0, 8), notes: "" };
    });
    return {
      id: "deck-" + Date.now(),
      topic: (req && req.topic) || "",
      slides: slides,
      theme: theme,
      createdAt: Date.now(),
    };
  }

  return {
    SYS: SYS,
    buildInitialPrompt: buildInitialPrompt,
    buildUpdatePrompt: buildUpdatePrompt,
    normalizeOutline: normalizeOutline,
    outlineToDeck: outlineToDeck,
  };
})();
}
