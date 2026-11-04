/**
 * Anna Bridge — 适配层（PoC）
 * 将 SlideForge 的 AI 调用与文件交付路由到 Anna Host API，
 * 不修改 SlideForge 内部业务逻辑：
 *   - AI:   覆盖 SlideForgeAI.generateDeck → anna.llm.complete
 *   - 文件: 提供 AnnaBridge.deliverPPTX() → APS upload_init/PUT/finalize + files.download
 *   - 降级: 无 Anna 宿主时，AI 提示不可用、导出回退 SlideForge 原生 blob 下载
 */
(function () {
  "use strict";

  // —— 调试期全局错误显示：把运行时错误直接写到状态栏 ——
  function showErr(msg) {
    var box = document.getElementById("sf-status");
    if (!box) return;
    box.textContent = "JS错误: " + msg;
    box.className = "sf-status sf-status-error";
    box.style.display = "block";
    box.style.position = "static";
  }
  window.addEventListener("error", function (e) {
    showErr(e.message + " @" + String(e.filename || "").split("/").pop() + ":" + e.lineno);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    showErr("Promise: " + (r && r.message ? r.message : String(r)));
  });

  var anna = null;
  var ready = null;

  function connect() {
    if (ready) return ready;
    ready = (async function () {
      try {
        var mod = await import("/static/anna-apps/_sdk/latest/index.js");
        anna = await mod.AnnaAppRuntime.connect();
        try { await anna.window.set_title({ title: "AIppt" }); } catch (e) {}
        return true;
      } catch (e) {
        anna = null;
        return false;
      }
    })();
    return ready;
  }

  /* ---------------- AI: Anna llm.complete ---------------- */

  async function annaGenerateDeck(topic, options) {
    if (!anna) throw new Error("Anna runtime 未连接");
    // 复用 SlideForge 自带的 prompt 构建与 normalize（通过其公开 API 拿到 prompt 文本）
    var sys = "You are a presentation-design expert. Output ONLY valid JSON.";
    var user = [
      "Topic: " + topic,
      "Number of slides: " + Math.max(3, Math.min(20, (options && options.slideCount) || 8)),
      "Audience: " + ((options && options.audience) || "general audience"),
      "Tone: " + ((options && options.tone) || "professional"),
      (options && options.extra) ? "Additional requirements: " + options.extra : "",
      'JSON schema: {"slides":[{"title":string,"content":[3-6 short strings],"notes":string}],"theme":{"name":string,"accent":hex,"gradient":"linear-gradient(...)","headingFont":string,"bodyFont":string}}',
      "Slide 1 is the title slide (content[0]=subtitle, content[1]=author line); last slide is a closing slide. Match theme colors to the topic. No markdown fences."
    ].join("\n");
    var res = await anna.llm.complete({
      systemPrompt: sys,
      messages: [{ role: "user", content: { type: "text", text: user } }],
      maxTokens: 2000,
      temperature: 0.7,
    });
    var text = res.content && res.content.text ? res.content.text : "";
    if (!text.trim()) throw new Error("Anna AI 返回了空内容");
    var raw = SlideForgeAI.extractJSON(text);
    if (!raw) throw new Error("Anna AI 输出格式异常：未找到合法 JSON");
    var deck = SlideForgeAI.normalizeDeck(JSON.stringify(raw), (options || {}).slideCount);
    deck.topic = topic;
    return deck;
  }

  /* ---------------- 文件交付: APS + files.download ---------------- */

  async function deliverPPTX(uint8, filename) {
    if (!anna) return false;
    var path = "pptx/" + Date.now() + ".pptx";
    var mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    var init = await anna.files.upload_init({ path: path, content_type: mime, size: uint8.length });
    var putUrl = init.put_url || init.upload_url;
    var headers = init.headers || {};
    // 本机网络到对象存储偶发失败：直连 PUT 带重试
    var resp = null, lastErr = null;
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        resp = await fetch(putUrl, { method: "PUT", headers: headers, body: uint8 });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        break;
      } catch (e) {
        lastErr = e;
        resp = null;
        if (attempt < 3) await new Promise(function (r) { setTimeout(r, attempt * 1000); });
      }
    }
    if (!resp) throw new Error("上传 PPTX 失败（已重试 3 次）: " + (lastErr && lastErr.message ? lastErr.message : lastErr));
    var etag = resp.headers.get("ETag");
    if (!etag) throw new Error("上传 PPTX 失败: 无 ETag");
    await anna.files.upload_finalize({ path: path, etag: etag, size_bytes: uint8.length });
    await anna.files.download({ path: path, filename: filename });
    return true;
  }

  /* ---------------- 装配 ---------------- */

  window.AnnaBridge = { connect: connect, deliverPPTX: deliverPPTX, connected: function () { return !!anna; } };

  document.addEventListener("DOMContentLoaded", async function () {
    var ok = await connect();
    // 覆盖 AI 生成入口（SlideForge 的 normalize/extractJSON 继续复用）
    SlideForgeAI.generateDeck = function (topic, options) {
      if (!ok) {
        return Promise.reject(new Error("当前不在 Anna 宿主中，无法调用 Anna AI。"));
      }
      return annaGenerateDeck(topic, options).catch(function (e) {
        // 让错误在 UI 状态栏可见，而不是只停留在控制台
        var box = document.getElementById("sf-status");
        if (box) {
          box.textContent = "生成失败: " + (e && e.message ? e.message : e);
          box.className = "sf-status sf-status-error";
        }
        throw e;
      });
    };
    // 无第三方 key 提示在 Anna 内不再适用
    var hint = document.getElementById("sf-key-hint");
    if (hint) hint.style.display = "none";
  });
})();
