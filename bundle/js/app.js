/**
 * SlideForge — App wiring
 * Routing (#editor), generation flow, keyboard nav, saved decks, events.
 */
var SlideForgeApp = (function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function showStatus(msg, isError) {
    var box = $("#sf-status");
    if (!box) return;
    box.textContent = msg;
    box.className = "sf-status " + (isError ? "sf-status-error" : "sf-status-info");
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { box.className = "sf-status"; }, isError ? 8000 : 3000);
  }

  async function handleGenerate(e) {
    e.preventDefault();
    var topic = ($("#sf-topic").value || "").trim();
    if (!topic) { $("#sf-topic").focus(); return; }
    var count = parseInt($("#sf-count").value, 10) || 8;
    var audience = ($("#sf-audience").value || "").trim();
    var tone = ($("#sf-tone").value || "");
    var extra = ($("#sf-extra") && $("#sf-extra").value || "").trim();

    var btn = $("#sf-generate-btn");
    btn.disabled = true;
    btn.textContent = "正在生成 PPT…";
    showStatus("正在调用 Anna AI 生成内容，请稍候…");

    try {
      var deck = await SlideForgeAI.generateDeck(topic, { slideCount: count, audience: audience, tone: tone, extra: extra });
      SlideForgeEditor.save();
      SlideForgeSlides.loadDeck(deck);
      location.hash = "#editor";
      renderEditor();
      showStatus("生成完成！可翻页预览、点「编辑」修改文字，或点「下载 PPT」导出。");
    } catch (err) {
      showStatus("出错：" + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "生成 PPT ⚡";
    }
  }

  function renderHome() {
    $("#sf-home").style.display = "";
    $("#sf-editor").style.display = "none";
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
        b.title = (d.slides ? d.slides.length : 0) + " slides \u00B7 " + d.theme.name;
        b.addEventListener("click", function () {
          SlideForgeSlides.loadDeck(d);
          location.hash = "#editor";
        });
        box.appendChild(b);
      });
    }
  }

  function renderEditor() {
    $("#sf-home").style.display = "none";
    $("#sf-editor").style.display = "block";
    if (!SlideForgeSlides.getDeck()) { location.hash = "#"; renderHome(); return; }
    SlideForgeSlides.render();
  }

  function goHome() {
    SlideForgeSlides.loadDeck(null);
    location.hash = "#";
    renderHome();
  }

  function onRoute() {
    if (location.hash === "#editor") renderEditor(); else renderHome();
  }

  function onKeyDown(e) {
    if (location.hash !== "#editor" || !SlideForgeSlides.getDeck()) return;
    var focused = document.activeElement;
    var inEditor = focused && (focused.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName));
    if (inEditor) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); SlideForgeSlides.navigate(1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); SlideForgeSlides.navigate(-1); }
    if (e.key === "Escape") SlideForgeEditor.toggleEdit();
  }

  function init() {
    var form = $("#sf-form");
    if (form) form.addEventListener("submit", handleGenerate);

    // example chips
    $$(".sf-example").forEach(function (chip) {
      chip.addEventListener("click", function () {
        $("#sf-topic").value = chip.dataset.topic;
        $("#sf-topic").focus();
      });
    });

    // example prompt prefill
    $$(".sf-example-prompt").forEach(function (el) {
      el.addEventListener("click", function () {
        $("#sf-topic").value = el.dataset.topic;
        $("#sf-audience").value = el.dataset.audience || "";
        $("#sf-count").value = el.dataset.count || 8;
        $("#sf-form").requestSubmit && $("#sf-form").requestSubmit();
      });
    });

    // toolbar delegation for extra editor buttons
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-sf-action]");
      if (!t) return;
      var act = t.dataset.sfAction;
      if (act === "prev") SlideForgeSlides.navigate(-1);
      if (act === "next") SlideForgeSlides.navigate(1);
      if (act === "dup") SlideForgeEditor.duplicateSlide();
      if (act === "del") SlideForgeEditor.deleteSlide();
      if (act === "up") SlideForgeEditor.moveSlide(-1);
      if (act === "down") SlideForgeEditor.moveSlide(1);
    });

    window.addEventListener("hashchange", onRoute);
    document.addEventListener("keydown", onKeyDown);
    onRoute();


  // ?sample=1 — 加载固定样例 deck（免 AI 调用，用于导出效果验收）
  if (/[?&]sample=1/.test(location.search)) {
    fetch("js/sample-deck.json").then(function (r) { return r.json(); }).then(function (d) {
      var deck = SlideForgeAI.normalizeDeck(JSON.stringify(d), d.slides.length);
      deck.topic = "固定样例（排版验收）";
      SlideForgeEditor.save();
      SlideForgeSlides.loadDeck(deck);
      renderEditor();
      showStatus("样例已加载，点击 ⭳ PPTX 导出验收文件。");
    }).catch(function (e) { showStatus("样例加载失败: " + e.message, true); });
  }

    // warn if no key configured and user tries to generate
    if (!SlideForgeConfig.GEMINI_API_KEY && !SlideForgeConfig.OPENAI_API_KEY) {
      var hint = $("#sf-key-hint");
      if (hint) hint.style.display = "";
    }
  }


  document.addEventListener("DOMContentLoaded", init);

  return { goHome: goHome, showStatus: showStatus };
})();
