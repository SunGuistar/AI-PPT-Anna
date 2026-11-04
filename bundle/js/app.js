/**
 * AIppt — App wiring
 * 三阶段流程：input（输入要求）→ outline（AI 大纲 + 手动编辑 + AI 更新）
 * → slides（预览/编辑/导出 PPT）。确认大纲后纯前端转换，零 AI 调用。
 */
var SlideForgeApp = (function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  // ---- 流程状态 ----
  var phase = "input";            // input | outline | slides
  var busy = false;               // AI 请求进行中（防重复提交）
  var requestSeq = 0;             // AI 请求序号：过期响应不覆盖新状态
  var initialRequest = null;      // { topic, count, audience, tone, extra }
  var outline = null;             // { slides:[{title, points}], theme }
  var lastConfirmedOutline = null;// 返回大纲时恢复用
  var slidesDirty = false;        // PPT 编辑器中是否修改过内容

  function showStatus(msg, isError) {
    var box = $("#sf-status");
    if (!box) return;
    box.textContent = msg;
    box.className = "sf-status " + (isError ? "sf-status-error" : "sf-status-info");
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { box.className = "sf-status"; }, isError ? 8000 : 3000);
  }

  function setBusy(v, btn, busyText, idleText) {
    busy = v;
    if (btn) { btn.disabled = v; btn.textContent = v ? busyText : idleText; }
  }

  // 主题字段级合并：AI 未提供/无效的字段沿用旧主题，避免整体替换丢样式
  function mergeTheme(oldT, newT) {
    if (!newT) return oldT;
    var out = {};
    ["name", "accent", "gradient", "bg", "fg", "headingFont", "bodyFont"].forEach(function (k) {
      out[k] = newT[k] || (oldT && oldT[k]) || null;
    });
    return out;
  }

  function showView(name) {
    phase = name;
    $("#sf-home").style.display = name === "input" ? "" : "none";
    $("#sf-outline").style.display = name === "outline" ? "block" : "none";
    $("#sf-editor").style.display = name === "slides" ? "block" : "none";
  }

  /* ================= input 阶段 ================= */

  async function handleGenerate(e) {
    e.preventDefault();
    if (busy) return;
    var topic = ($("#sf-topic").value || "").trim();
    if (!topic) { $("#sf-topic").focus(); return; }
    initialRequest = {
      topic: topic,
      count: parseInt($("#sf-count").value, 10) || 5,
      audience: ($("#sf-audience").value || "").trim(),
      tone: ($("#sf-tone").value || ""),
      extra: ($("#sf-extra") && $("#sf-extra").value || "").trim(),
    };
    var btn = $("#sf-generate-btn");
    setBusy(true, btn, "正在生成大纲…", "生成大纲 ⚡");
    showStatus("正在调用 Anna AI 生成内容型大纲，请稍候…");
    var seq = ++requestSeq;
    try {
      var text = await AnnaBridge.aiJson(SlideForgeOutline.buildInitialPrompt(initialRequest));
      if (seq !== requestSeq) return; // 过期响应
      var next = SlideForgeOutline.normalizeOutline(text);
      outline = { slides: next.slides, theme: mergeTheme(outline && outline.theme, next.theme) };
      renderOutline();
      showView("outline");
      showStatus("大纲已生成，可直接修改，或输入补充要求后点「更新大纲」。");
    } catch (err) {
      if (seq === requestSeq) showStatus("生成大纲失败：" + err.message + "（可重试）", true);
    } finally {
      if (seq === requestSeq) setBusy(false, btn, "", "生成大纲 ⚡");
    }
  }

  /* ================= outline 阶段 ================= */

  // 从 DOM 卡片回读最新大纲（手动编辑结果），不改变顺序结构
  function readOutlineFromDom() {
    var cards = $$(".sf-outline-card");
    outline.slides = cards.map(function (card) {
      return {
        title: (card.querySelector(".sf-oc-title").value || "").trim() || "未命名",
        points: (card.querySelector(".sf-oc-points").value || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6),
      };
    });
  }

  function renderOutline() {
    var list = $("#sf-outline-list");
    list.innerHTML = "";
    outline.slides.forEach(function (s, i) {
      var card = document.createElement("div");
      card.className = "sf-outline-card";

      var head = document.createElement("div");
      head.className = "sf-oc-head";
      var num = document.createElement("span");
      num.className = "sf-oc-num";
      num.textContent = (i === 0) ? "封面" : (i === outline.slides.length - 1 ? "总结" : "第 " + (i + 1) + " 页");
      var title = document.createElement("input");
      title.className = "sf-oc-title";
      title.type = "text";
      title.value = s.title;
      var up = document.createElement("button");
      up.className = "sf-oc-move"; up.type = "button"; up.textContent = "↑";
      up.title = "上移";
      up.addEventListener("click", function () { moveOutlinePage(i, -1); });
      var down = document.createElement("button");
      down.className = "sf-oc-move"; down.type = "button"; down.textContent = "↓";
      down.title = "下移";
      down.addEventListener("click", function () { moveOutlinePage(i, 1); });
      var del = document.createElement("button");
      del.className = "sf-oc-del"; del.type = "button"; del.textContent = "删除";
      del.addEventListener("click", function () { deleteOutlinePage(i); });
      head.append(num, title, up, down, del);

      var points = document.createElement("textarea");
      points.className = "sf-oc-points";
      points.rows = Math.max(3, s.points.length + 1);
      points.value = s.points.join("\n");
      points.placeholder = "每行一条要点";

      card.append(head, points);
      list.appendChild(card);
    });
    $("#sf-outline-meta").textContent =
      "主题：" + (initialRequest ? initialRequest.topic : "") + " · 共 " + outline.slides.length + " 页";
  }

  function moveOutlinePage(i, delta) {
    readOutlineFromDom();
    var j = i + delta;
    if (j < 0 || j >= outline.slides.length) return;
    var tmp = outline.slides[i];
    outline.slides[i] = outline.slides[j];
    outline.slides[j] = tmp;
    renderOutline();
  }

  function deleteOutlinePage(i) {
    readOutlineFromDom();
    if (outline.slides.length <= 1) { showStatus("大纲至少保留 1 页。", true); return; }
    if (!confirm("删除第 " + (i + 1) + " 页？")) return;
    outline.slides.splice(i, 1);
    renderOutline();
  }

  async function handleOutlineUpdate() {
    if (busy) return;
    var feedback = ($("#sf-outline-feedback").value || "").trim();
    if (!feedback) { showStatus("请先输入补充修改要求。", true); return; }
    readOutlineFromDom();
    var snapshot = JSON.parse(JSON.stringify(outline)); // 失败回滚
    var btn = $("#sf-outline-update");
    setBusy(true, btn, "正在更新大纲…", "更新大纲");
    showStatus("正在调用 Anna AI 更新大纲…");
    var seq = ++requestSeq;
    try {
      var text = await AnnaBridge.aiJson(SlideForgeOutline.buildUpdatePrompt(initialRequest, outline, feedback));
      if (seq !== requestSeq) return;
      var next = SlideForgeOutline.normalizeOutline(text);
      outline = { slides: next.slides, theme: mergeTheme(outline.theme, next.theme) };
      renderOutline();
      $("#sf-outline-feedback").value = "";
      showStatus("大纲已更新（共 " + outline.slides.length + " 页）。");
    } catch (err) {
      if (seq === requestSeq) {
        outline = snapshot; // 更新失败：保留更新前的大纲
        renderOutline();
        showStatus("更新大纲失败：" + err.message + "（已保留原大纲，可重试）", true);
      }
    } finally {
      if (seq === requestSeq) setBusy(false, btn, "", "更新大纲");
    }
  }

  function handleOutlineConfirm() {
    if (busy) return;
    readOutlineFromDom();
    lastConfirmedOutline = JSON.parse(JSON.stringify(outline));
    var deck = SlideForgeOutline.outlineToDeck(outline, initialRequest, fallbackTheme());
    // 零 AI 调用：直接由前端转换
    SlideForgeEditor.save();
    SlideForgeSlides.loadDeck(deck);
    slidesDirty = false;
    showView("slides");
    location.hash = "#editor";
    SlideForgeSlides.render();
    showStatus("已根据大纲生成 PPT，可预览、编辑或点「下载 PPT」导出。");
  }

  function fallbackTheme() {
    var deck = SlideForgeSlides.getDeck();
    return (outline && outline.theme) || (deck && deck.theme) || null;
  }

  function handleOutlineBack() {
    if (busy) return;
    showView("input");
    location.hash = "#";
  }

  /* ================= slides 阶段 ================= */

  function returnToOutline() {
    if (busy) return;
    if (slidesDirty) {
      if (!confirm("返回大纲后再次生成将覆盖你在 PPT 编辑器中的修改，继续？")) return;
    }
    if (lastConfirmedOutline) outline = JSON.parse(JSON.stringify(lastConfirmedOutline));
    renderOutline();
    showView("outline");
    location.hash = "#";
    showStatus("已返回大纲，可继续手动编辑或输入补充要求更新。");
  }

  function renderHome() {
    showView("input");
    var box = $("#sf-saved");
    var decks = SlideForgeEditor.loadAll();
    box.innerHTML = "";
    if (decks.length) {
      var h = document.createElement("h3");
      h.textContent = "最近生成的文稿";
      box.appendChild(h);
      decks.forEach(function (d) {
        var b = document.createElement("button");
        b.className = "sf-saved-btn";
        b.textContent = d.topic || d.theme.name;
        b.title = (d.slides ? d.slides.length : 0) + " 页 · " + d.theme.name;
        b.addEventListener("click", function () {
          SlideForgeSlides.loadDeck(d);
          showView("slides");
          location.hash = "#editor";
        });
        box.appendChild(b);
      });
    }
  }

  function renderEditor() {
    if (!SlideForgeSlides.getDeck()) { renderHome(); return; }
    showView("slides");
    SlideForgeSlides.render();
  }

  function goHome() {
    SlideForgeSlides.loadDeck(null);
    location.hash = "#";
    renderHome();
  }

  function onRoute() {
    if (location.hash === "#editor") renderEditor();
    else if (phase === "outline") showView("outline");
    else renderHome();
  }

  function onKeyDown(e) {
    if (phase !== "slides" || !SlideForgeSlides.getDeck()) return;
    var focused = document.activeElement;
    var inEditor = focused && (focused.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].indexOf(focused.tagName) > -1);
    if (inEditor) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); SlideForgeSlides.navigate(1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); SlideForgeSlides.navigate(-1); }
    if (e.key === "Escape") SlideForgeEditor.toggleEdit();
  }

  function init() {
    var form = $("#sf-form");
    if (form) form.addEventListener("submit", handleGenerate);

    $$(".sf-example").forEach(function (chip) {
      chip.addEventListener("click", function () {
        $("#sf-topic").value = chip.dataset.topic;
        $("#sf-topic").focus();
      });
    });

    // outline 区按钮
    var updBtn = $("#sf-outline-update");
    if (updBtn) updBtn.addEventListener("click", handleOutlineUpdate);
    var cfmBtn = $("#sf-outline-confirm");
    if (cfmBtn) cfmBtn.addEventListener("click", handleOutlineConfirm);
    var backBtn = $("#sf-outline-back");
    if (backBtn) backBtn.addEventListener("click", handleOutlineBack);

    // PPT 编辑器中的修改标记（返回大纲时提示覆盖）
    document.addEventListener("input", function (e) {
      if (phase === "slides" && e.target && e.target.closest && e.target.closest("#sf-stage, #sf-toolbar")) {
        slidesDirty = true;
      }
    });

    // toolbar delegation for extra editor buttons
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-sf-action]");
      if (!t) return;
      if (phase === "slides") slidesDirty = true;
      var act = t.dataset.sfAction;
      if (act === "prev") SlideForgeSlides.navigate(-1);
      if (act === "next") SlideForgeSlides.navigate(1);
      if (act === "dup") SlideForgeEditor.duplicateSlide();
      if (act === "del") SlideForgeEditor.deleteSlide();
      if (act === "up") SlideForgeEditor.moveSlide(-1);
      if (act === "down") SlideForgeEditor.moveSlide(1);
      if (act === "backOutline") { slidesDirty = false; returnToOutline(); }
    });

    window.addEventListener("hashchange", onRoute);
    document.addEventListener("keydown", onKeyDown);
    onRoute();

    // ?sample=1 — 固定 PPT 样例（免 AI，排版验收）；?sample=outline — 固定大纲样例（免 AI，大纲流程验收）
    if (/[?&]sample=1/.test(location.search)) {
      fetch("js/sample-deck.json").then(function (r) { return r.json(); }).then(function (d) {
        var deck = SlideForgeAI.normalizeDeck(JSON.stringify(d), d.slides.length);
        deck.topic = "固定样例（排版验收）";
        SlideForgeEditor.save();
        SlideForgeSlides.loadDeck(deck);
        renderEditor();
        showStatus("样例已加载，点击「下载 PPT」导出验收文件。");
      }).catch(function (e) { showStatus("样例加载失败: " + e.message, true); });
    } else if (/[?&]sample=outline/.test(location.search)) {
      fetch("js/sample-outline.json").then(function (r) { return r.json(); }).then(function (d) {
        initialRequest = { topic: d.topic || "固定大纲样例", count: d.slides.length, audience: "", tone: "professional", extra: "" };
        var next = SlideForgeOutline.normalizeOutline({ slides: d.slides, theme: d.theme });
        outline = { slides: next.slides, theme: next.theme };
        renderOutline();
        showView("outline");
        showStatus("大纲样例已加载（免 AI），可编辑后点「确认大纲，生成 PPT」。");
      }).catch(function (e) { showStatus("大纲样例加载失败: " + e.message, true); });
    }

    if (!SlideForgeConfig.GEMINI_API_KEY && !SlideForgeConfig.OPENAI_API_KEY) {
      var hint = $("#sf-key-hint");
      if (hint) hint.style.display = "none";
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    goHome: goHome,
    showStatus: showStatus,
    returnToOutline: returnToOutline,
    // 测试钩子
    _state: function () { return { phase: phase, busy: busy, outline: outline, initialRequest: initialRequest }; },
    _confirm: handleOutlineConfirm,
  };
})();
