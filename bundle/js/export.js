/**
 * SlideForge — Export
 * 1) PDF: re-renders the full deck into a print view and invokes the
 *    browser's print dialog (styled with @page / print CSS).
 * 2) PPTX: hand-rolled OOXML generator (XML + ZIP) with zero libraries.
 */
var SlideForgeExport = (function () {
  "use strict";

  function escXml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  /* ---------- PDF (print) ---------- */
  function printPDF() {
    var deck = SlideForgeSlides.getDeck();
    if (!deck) return;
    var w = window.open("", "_blank", "width=1000,height=800");
    if (!w) { alert("请允许弹出窗口以下载 PDF。"); return; }
    var accent = deck.theme.accent, fg = deck.theme.fg, bg = deck.theme.bg;
    var hf = deck.theme.headingFont, bf = deck.theme.bodyFont;
    var slidesHtml = deck.slides.map(function (s) {
      return '<div class="p-slide">' +
        '<h1>' + escXml(s.title) + "</h1>" +
        (s.content.length ? '<ul>' + s.content.map(function (c) { return "<li>" + escXml(c) + "</li>"; }).join("") + "</ul>" : "") +
        (s.notes ? '<p class="p-notes">' + escXml(s.notes) + "</p>" : "") +
        "</div>";
    }).join("");
    w.document.write("<!DOCTYPE html><html><head><meta charset='utf-8'><title>" +
      escXml(deck.topic || deck.theme.name) + " — SlideForge</title>" +
      "<style>" +
      "@page{size:1280px 720px;margin:0;}" +
      "body{margin:0;font-family:" + bf + ";color:" + fg + ";background:" + bg + ";}" +
      ".p-slide{width:1280px;height:720px;page-break-after:always;display:flex;flex-direction:column;justify-content:center;padding:70px 90px;box-sizing:border-box;background:" + deck.theme.gradient + ";}" +
      ".p-slide:last-child{page-break-after:auto;}" +
      "h1{font-family:" + hf + ";font-size:54px;margin:0 0 28px;color:" + fg + ";}" +
      "ul{font-size:28px;line-height:1.6;margin:0;padding-left:44px;}" +
      "li{margin-bottom:16px;}" +
      ".p-notes{margin-top:auto;font-size:16px;opacity:.7;font-style:italic;}" +
      "@media print{.p-slide{break-after:page;}}" +
      "</style></head><body>" + slidesHtml +
      "<script>setTimeout(function(){window.print();},600);<\/script>" +
      "</body></html>");
    w.document.close();
  }

  /* ---------- PPTX (OOXML) ---------- */
  var PPTX_CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '%SLIDES%</Types>';

  var PPTX_PRESENTATION =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveUnderline="1">' +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:sldIdLst>%SLIDEIDS%</p:sldIdLst>' +
    '<p:sldSz cx="9144000" cy="5143500"/>' +
    "</p:presentation>";

  var PPTX_SLIDE =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld>%BG%<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    "%BODY%" +
    "</p:spTree></p:cSld></p:sld>";

  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  function rgbInt(hex) {
    var c = hexToRgb(hex);
    return (c.r << 16) | (c.g << 8) | c.b;
  }

  /* ---- theme mapping (preview -> OOXML) ---- */

  // "Georgia, serif" / '"Segoe UI", sans-serif' -> first font name
  function cssFontName(fontCss, fallback) {
    var name = (fontCss || "").split(",")[0].trim().replace(/^["']+|["']+$/g, "");
    return name || fallback || "Calibri";
  }

  function normalizeHex(hex) {
    var h = (hex || "").replace("#", "");
    if (h.length === 3 || h.length === 4) h = h.split("").map(function (c) { return c + c; }).join("");
    return h.slice(0, 6).toUpperCase();
  }

  // CSS linear-gradient -> OOXML gradFill. Angle verified against the OOXML
  // spec anchor: CSS 180deg (to bottom) == OOXML ang 5400000 (90 deg,
  // clockwise from 3 o'clock); hence ooxml_deg = (css_deg - 90) mod 360.
  function parseLinearGradient(css) {
    var m = /linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,([^)]+)\)/i.exec(css || "");
    if (!m) return null;
    var cssDeg = parseFloat(m[1]);
    var ooxmlDeg = (((cssDeg - 90) % 360) + 360) % 360;
    var stops = m[2].split(",").map(function (part) {
      var mm = /(#[0-9a-fA-F]{3,8})\s*(\d+(?:\.\d+)?)?/.exec(part.trim());
      return mm ? { color: normalizeHex(mm[1]), pos: mm[2] !== undefined ? parseFloat(mm[2]) : null } : null;
    }).filter(Boolean);
    if (!stops.length) return null;
    if (stops[0].pos === null) stops[0].pos = 0;
    if (stops[stops.length - 1].pos === null) stops[stops.length - 1].pos = 100;
    stops.forEach(function (s, idx) { if (s.pos === null) s.pos = stops[idx - 1].pos; });
    return { ang: String(Math.round(ooxmlDeg * 60000)), stops: stops };
  }

  // Per-slide background: theme.gradient (gradFill) or solid theme.bg.
  function slideBackgroundXml(theme) {
    var g = parseLinearGradient(theme.gradient);
    var fill;
    if (g) {
      var gs = g.stops.map(function (s) {
        var pos = Math.max(0, Math.min(100000, Math.round(s.pos * 1000)));
        return '<a:gs pos="' + pos + '"><a:srgbClr val="' + s.color + '"/></a:gs>';
      }).join("");
      fill = '<a:gradFill><a:gsLst>' + gs + '</a:gsLst><a:lin ang="' + g.ang + '" scaled="1"/></a:gradFill>';
    } else {
      fill = '<a:solidFill><a:srgbClr val="' + normalizeHex(theme.bg || "#FFFFFF") + '"/></a:solidFill>';
    }
    return '<p:bg><p:bgPr>' + fill + '</p:bgPr></p:bg>';
  }

  function textShape(id, x, y, cx, cy, text, sizePt, bold, color, align, fontFace) {
    var latin = '<a:latin typeface="' + escXml(fontFace || "Calibri") + '"/>';
    var lines = text.split("\n").map(function (l) {
      return '<a:p><a:pPr algn="' + align + '"/><a:r><a:rPr lang="en-US" sz="' + (sizePt * 100) +
        '" b="' + (bold ? "1" : "0") + '"><a:solidFill><a:srgbClr val="' + normalizeHex(color) +
        '"/></a:solidFill>' + latin + '</a:rPr><a:t>' + escXml(l) + "</a:t></a:r></a:p>";
    }).join("");
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name=""/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/>' + lines + "</p:txBody></p:sp>";
  }

  var SLIDE_H = 5143500;

  function buildSlideXml(slide, i, total, theme) {
    var fg = theme.fg || "#1F2937";
    var accentClr = normalizeHex(theme.accent || "#6366F1");
    var headingFont = cssFontName(theme.headingFont);
    var bodyFont = cssFontName(theme.bodyFont);
    var titleSize = (i === 0 || i === total - 1) ? 30 : 20;
    var body = "";
    var idc = 2;
    // title (fg color + heading font, matching the preview)
    body += textShape(idc++, 457200, 228600, 8229600, 914400, slide.title, titleSize, true, fg, "ctr", headingFont);
    if (i === 0 || i === total - 1) {
      if (slide.content[0]) body += textShape(idc++, 1371600, 2286000, 6400800, 914400, slide.content[0], 16, false, fg, "ctr", bodyFont);
      if (slide.content[1]) body += textShape(idc++, 1371600, 2971800, 6400800, 914400, slide.content[1], 12, false, fg, "ctr", bodyFont);
    } else {
      // bullets: dynamic vertical spacing so up to 8 items never overflow
      var n = Math.max(slide.content.length, 1);
      var startY = 1371600;
      var avail = SLIDE_H - startY - 457200; // leave a 0.5" bottom margin
      var step = Math.min(685800, Math.floor(avail / n));
      var boxH = Math.max(457200, Math.min(685800, step));
      var y = startY;
      slide.content.forEach(function (c) {
        body += textShape(idc++, 914400, y, 7315200, boxH, "\u2022  " + c, 14, false, fg, "l", bodyFont);
        y += step;
      });
    }
    return PPTX_SLIDE.replace("%BG%", slideBackgroundXml(theme)).replace("%BODY%", body);
  }

  /* ==================================================================
   * DOM 测量驱动导出（预览 -> PPTX 排版一致）
   * 在固定 960x540 px 的离屏舞台中渲染每一页，量取真实布局：
   * getBoundingClientRect（位置/尺寸）、getComputedStyle（字体、
   * 字号、粗细、颜色、对齐、行距），再按 1px = 9525 EMU、
   * 1px = 0.75pt 换算为 PPTX 坐标。无 DOM 环境自动回退到上面的
   * 数据驱动 buildSlideXml。
   * ================================================================== */

  var PX2EMU = 9525;   // 960x540 px 舞台 <-> 9144000x5143500 EMU 幻灯片
  var PX2PT = 0.75;

  // 从 CSS 字体列表选出浏览器实际可用字体（document.fonts.check）
  // 常见中文字体：PowerPoint/WPS 与中文系统普遍可用，作为英文主题字体的回退
  var CJK_FONTS = ["SimHei", "Microsoft YaHei", "PingFang SC", "DengXian", "SimSun", "KaiTi"];

  // 返回 { latin, ea }：拉丁字符用主题字体，东亚字符用中文字体，
  // 对应 OOXML 的 a:latin / a:ea，保证 PPT 中文与预览字体族一致。
  function pickFamily(cssFamily, doc) {
    var names = (cssFamily || "").split(",").map(function (s) {
      return s.trim().replace(/^["']+|["']+$/g, "");
    }).filter(Boolean);
    var latin = names[0] || "Calibri";
    for (var i = 0; i < names.length; i++) {
      try {
        if (doc.fonts && doc.fonts.check('16px "' + names[i] + '"')) { latin = names[i]; break; }
      } catch (e) { /* ignore */ }
    }
    var ea = null;
    for (var j = 0; j < CJK_FONTS.length; j++) {
      try {
        if (doc.fonts && doc.fonts.check('16px "' + CJK_FONTS[j] + '"')) { ea = CJK_FONTS[j]; break; }
      } catch (e) { /* ignore */ }
    }
    return { latin: latin, ea: ea };
  }

  // "rgb(226,232,240)" / "rgba(226,232,240,0.92)" -> {hex, alphaPct}
  function cssColorToHex(cssColor) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(cssColor || "");
    if (!m) return { hex: "1F2937", alpha: null };
    function h(n) { return ("0" + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2).toUpperCase(); }
    return {
      hex: h(+m[1]) + h(+m[2]) + h(+m[3]),
      alpha: m[4] !== undefined ? Math.max(0, Math.min(100, Math.round(parseFloat(m[4]) * 100))) : null,
    };
  }

  var ALIGN_MAP = { left: "l", center: "ctr", right: "r", start: "l", end: "r", justify: "l" };

  /**
   * 离屏测量整副 deck。返回 null 表示环境不支持（无 DOM/测量失败），
   * 调用方应回退到数据驱动导出。
   */
  async function measureDeck(deck) {
    if (typeof document === "undefined" || !document.body || !SlideForgeSlides.renderSlideDom) return null;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      SlideForgeSlides.applyTheme(deck.theme);

      var wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;left:-24000px;top:0;display:block;visibility:hidden;width:960px;height:540px;";
      var stage = document.createElement("div");
      stage.className = "sf-stage";
      stage.style.width = "960px";
      stage.style.height = "540px";
      wrap.appendChild(stage);
      document.body.appendChild(wrap);

      var ROLE_SEL = [
        [".sf-slide-title-text", "text", ""],
        [".sf-subtitle", "text", ""],
        [".sf-author", "text", ""],
        [".sf-closing-line", "text", ""],
        [".sf-takeaway", "text", ""],
        [".sf-bullet", "bullet", "\u2022  "],
      ];

      var slides = deck.slides.map(function (slide, i) {
        stage.innerHTML = "";
        var el = SlideForgeSlides.renderSlideDom(deck, i);
        stage.appendChild(el);
        var sRect = stage.getBoundingClientRect();
        var shapes = [];
        var idc = 2;
        ROLE_SEL.forEach(function (role) {
          var nodes = el.querySelectorAll(role[0]);
          Array.prototype.forEach.call(nodes, function (node) {
            var text = node.textContent;
            if (!text || !text.trim()) return;
            var r = node.getBoundingClientRect();
            var cs = getComputedStyle(node);
            var color = cssColorToHex(cs.color);
            var gutterPx = 0;
            if (role[1] === "bullet") {
              // li 的 rect 不含 ::marker，把列表左内边距并入文本框，使 "• " 前缀落在 marker 位置
              var list = node.parentElement ? getComputedStyle(node.parentElement) : null;
              if (list) gutterPx = parseFloat(list.paddingLeft) || 0;
            }
            var lhPx = parseFloat(cs.lineHeight);
            shapes.push({
              id: idc++,
              x: Math.round((r.left - sRect.left - gutterPx) * PX2EMU),
              y: Math.round((r.top - sRect.top) * PX2EMU),
              w: Math.round((r.width + gutterPx) * PX2EMU),
              h: Math.max(Math.round(r.height * PX2EMU), Math.round(parseFloat(cs.fontSize) * PX2EMU * 1.2)),
              prefix: role[2],
              text: text.trim(),
              fontPx: parseFloat(cs.fontSize),
              bold: (parseInt(cs.fontWeight, 10) || 400) >= 600,
              family: pickFamily(cs.fontFamily, document),
              color: color.hex,
              alpha: color.alpha,
              align: ALIGN_MAP[cs.textAlign] || "l",
              lnSpcPct: isFinite(lhPx) && lhPx > 0 ? Math.round((lhPx / parseFloat(cs.fontSize)) * 100000) : null,
            });
          });
        });
        return { shapes: shapes };
      });

      document.body.removeChild(wrap);
      return { slides: slides };
    } catch (e) {
      try { if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (_) {}
      return null;
    }
  }

  // 由测量数据构建单页 slide XML（背景仍由 theme 生成）
  function buildSlideFromMeasured(m) {
    var body = m.shapes.map(function (s) {
      var sz = Math.round(s.fontPx * PX2PT * 100);
      var fill = '<a:solidFill><a:srgbClr val="' + s.color + '"' +
        (s.alpha !== null ? '><a:alpha val="' + s.alpha * 1000 + '"/></a:srgbClr></a:solidFill>' : '/></a:solidFill>');
      var lnSpc = s.lnSpcPct ? '<a:lnSpc><a:spcPct val="' + s.lnSpcPct + '"/></a:lnSpc>' : "";
      var paras = (s.prefix + s.text).split("\n").map(function (l) {
        return '<a:p><a:pPr algn="' + s.align + '">' + lnSpc + '</a:pPr><a:r><a:rPr lang="zh-CN" sz="' + sz +
          '" b="' + (s.bold ? "1" : "0") + '" dirty="0">' + fill +
          '<a:latin typeface="' + escXml(s.family.latin) + '"/>' +
          (s.family.ea ? '<a:ea typeface="' + escXml(s.family.ea) + '"/>' : '') +
          '</a:rPr><a:t>' + escXml(l) + "</a:t></a:r></a:p>";
      }).join("");
      return '<p:sp><p:nvSpPr><p:cNvPr id="' + s.id + '" name=""/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="' + s.x + '" y="' + s.y + '"/><a:ext cx="' + s.w + '" cy="' + s.h + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        '<p:txBody><a:bodyPr wrap="square" anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>' + paras + "</p:txBody></p:sp>";
    }).join("");
    return PPTX_SLIDE.replace("%BG%", "%BG%").replace("%BODY%", body);
  }

  /* Minimal ZIP writer (store, no compression) with CRC-32. */
  function crc32(buf) {
    var table = crc32.table || (crc32.table = (function () {
      var t = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      return t;
    })());
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function strToBytes(str) {
    var enc = new TextEncoder();
    return enc.encode(str);
  }

  function buildZip(entries) {
    var parts = [];
    var central = [];
    var offset = 0;
    entries.forEach(function (e) {
      var nameBytes = strToBytes(e.name);
      var local = new Uint8Array(30 + nameBytes.length + e.data.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);            // version
      dv.setUint16(6, 0, true);             // flags
      dv.setUint16(8, 0, true);             // method = store
      dv.setUint16(10, 0, true);            // mod time
      dv.setUint16(12, 0, true);            // mod date
      dv.setUint32(14, e.crc, true);
      dv.setUint32(18, e.data.length, true);
      dv.setUint32(22, e.data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(e.data, 30 + nameBytes.length);
      parts.push(local);

      var ch = new Uint8Array(46 + nameBytes.length);
      var dv2 = new DataView(ch.buffer);
      // Central directory header layout (ZIP spec):
      //  0 sig(4) 4 verMade(2) 6 ver(2) 8 flags(2) 10 method(2) 12 mtime(2)
      // 14 mdate(2) 16 crc(4) 20 compSize(4) 24 uncompSize(4) 28 nameLen(2)
      // 30 extraLen(2) 32 commentLen(2) 34 diskStart(2) 36 intAttr(2)
      // 38 extAttr(4) 42 localOffset(4) 46 name
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0, true);
      dv2.setUint16(10, 0, true);
      dv2.setUint16(12, 0, true);
      dv2.setUint16(14, 0, true);
      dv2.setUint32(16, e.crc, true);
      dv2.setUint32(20, e.data.length, true);
      dv2.setUint32(24, e.data.length, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true);
      dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true);
      dv2.setUint16(36, 0, true);
      dv2.setUint32(38, 0, true);
      dv2.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);
      offset += local.length;
    });
    var centralLen = central.reduce(function (s, c) { return s + c.length; }, 0);
    var totalLen = offset + centralLen + 22;
    var out = new Uint8Array(totalLen);
    var pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    central.forEach(function (c) { out.set(c, pos); pos += c.length; });
    var dv = new DataView(out.buffer, pos);
    // End of central directory record (ZIP spec):
    //  0 sig(4) 4 diskNum(2) 6 cdDiskNum(2) 8 cdEntriesDisk(2) 10 cdEntries(2)
    // 12 cdSize(4) 16 cdOffset(4) 20 commentLen(2)
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(4, 0, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, entries.length, true);
    dv.setUint16(10, entries.length, true);
    dv.setUint32(12, centralLen, true);
    dv.setUint32(16, offset, true);
    dv.setUint16(20, 0, true);
    return out;
  }

  async function downloadPPTX() {
    var deck = SlideForgeSlides.getDeck();
    if (!deck) return;
    var entries = [];
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      "</Relationships>";
    entries.push({ name: "_rels/.rels", data: strToBytes(rels), crc: crc32(strToBytes(rels)) });

    var overrideTypes = deck.slides.map(function (_, i) {
      return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    }).join("");
    var ct = PPTX_CONTENT_TYPES.replace("%SLIDES%", overrideTypes);
    entries.push({ name: "[Content_Types].xml", data: strToBytes(ct), crc: crc32(strToBytes(ct)) });

    var theme = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SlideForge">' +
      '<a:themeElements><a:clrScheme name="SlideForge">' +
      '<a:dk1><a:srgbClr val="FFFFFF"/></a:dk1><a:lt1><a:srgbClr val="000000"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="' + deck.theme.accent.replace("#", "") + '"/></a:accent1>' +
      '<a:accent2><a:srgbClr val="4472C4"/></a:accent2><a:accent3><a:srgbClr val="ED7D31"/></a:accent3>' +
      '<a:accent4><a:srgbClr val="A5A5A5"/></a:accent4><a:accent5><a:srgbClr val="FFC000"/></a:accent5>' +
      '<a:accent6><a:srgbClr val="5B9BD5"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
      '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="SlideForge"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
      "</a:fmtScheme></a:themeElements></a:theme>";
    entries.push({ name: "ppt/theme/theme1.xml", data: strToBytes(theme), crc: crc32(strToBytes(theme)) });

    var slideRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
      "</Relationships>";
    // 优先使用浏览器实测布局；测量不可用时回退数据驱动排版
    var measured = null;
    try { measured = await measureDeck(deck); } catch (e) { measured = null; }
    if (measured && !measured.slides.some(function (s) { return s.shapes.length > 0; })) measured = null;

    var slideIds = "";
    deck.slides.forEach(function (s, i) {
      var xml = measured
        ? buildSlideFromMeasured(measured.slides[i]).replace("%BG%", slideBackgroundXml(deck.theme))
        : buildSlideXml(s, i, deck.slides.length, deck.theme);
      entries.push({ name: "ppt/slides/slide" + (i + 1) + ".xml", data: strToBytes(xml), crc: crc32(strToBytes(xml)) });
      entries.push({ name: "ppt/slides/_rels/slide" + (i + 1) + ".xml.rels", data: strToBytes(slideRels), crc: crc32(strToBytes(slideRels)) });
      slideIds += '<p:sldId id="' + (255 + i) + '" r:id="rId' + (i + 2) + '"/>';
    });

    var pres = PPTX_PRESENTATION.replace("%SLIDEIDS%", slideIds);
    var presRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
      deck.slides.map(function (_, i) {
        return '<Relationship Id="rId' + (i + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>';
      }).join("") +
      deck.slides.map(function (_, i) {
        return '<Relationship Id="rId' + (deck.slides.length + i + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="slideLayouts/slideLayout1.xml"/>';
      }).join("") +
      "</Relationships>";
    entries.push({ name: "ppt/presentation.xml", data: strToBytes(pres), crc: crc32(strToBytes(pres)) });
    entries.push({ name: "ppt/_rels/presentation.xml.rels", data: strToBytes(presRels), crc: crc32(strToBytes(presRels)) });

    var master = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      "</p:sldMaster>";
    entries.push({ name: "ppt/slideMasters/slideMaster1.xml", data: strToBytes(master), crc: crc32(strToBytes(master)) });

    var masterRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
      "</Relationships>";
    entries.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: strToBytes(masterRels), crc: crc32(strToBytes(masterRels)) });

    var layout = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">' +
      '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>' +
      "</p:sldLayout>";
    entries.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: strToBytes(layout), crc: crc32(strToBytes(layout)) });

    var zip = buildZip(entries);
    function safeName(t) {
      var n = (t || "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
      if (!n) n = "AIppt";
      return Array.from(n).slice(0, 60).join("");
    }
    var filename = safeName(deck.topic) + ".pptx";
    // --- Anna 适配（PoC）：宿主内走官方 APS 交付；独立打开时回退原生下载 ---
    if (window.AnnaBridge && AnnaBridge.connected()) {
      AnnaBridge.deliverPPTX(zip, filename).catch(function (e) {
        alert("导出失败: " + (e && e.message ? e.message : e));
      });
      return;
    }
    var blob = new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    printPDF: printPDF,
    downloadPPTX: downloadPPTX,
    // 测试钩子：无 DOM 环境下直接验证测量构建器的换算逻辑
    _buildFromMeasured: buildSlideFromMeasured,
    _cssColorToHex: cssColorToHex,
    _measureDeck: measureDeck,
  };
})();
