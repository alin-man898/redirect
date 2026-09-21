/* word-export.js —— 纯 JS 生成带封面的完整 Word 标书(.docx)，无外部依赖
   采用 OOXML + Store 模式 ZIP（含 CRC32），微软雅黑(eastAsia)字体。 */
(function (global) {
  "use strict";
  var SYD = global.SYD;
  var enc = (typeof TextEncoder !== "undefined") ? new TextEncoder() : null;

  function utf8(str) {
    if (enc) return enc.encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return new Uint8Array(out);
  }

  // ---------- CRC32 ----------
  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); } t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  // ---------- 极简 ZIP（store 模式） ----------
  function makeZip(files) {
    var out = [];
    function u16(v) { out.push(v & 0xff, (v >>> 8) & 0xff); }
    function u32(v) { out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
    function pushBytes(b) { for (var i = 0; i < b.length; i++) out.push(b[i]); }
    var offset = 0, central = [];
    files.forEach(function (f) {
      var data = f.bytes, nameBytes = utf8(f.name), crc = crc32(data);
      var lh = [];
      (function () { function a(v) { lh.push(v & 0xff, (v >>> 8) & 0xff); } function b(v) { lh.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
        b(0x04034b50); a(20); a(0x0800); a(0); a(0); a(0); b(crc); b(data.length); b(data.length); a(nameBytes.length); a(0);
        for (var i = 0; i < f.name.length; i++) lh.push(f.name.charCodeAt(i) & 0xff);
        for (var j = 0; j < data.length; j++) lh.push(data[j]);
      })();
      pushBytes(Uint8Array.from(lh));
      var ch = [];
      (function () { function a(v) { ch.push(v & 0xff, (v >>> 8) & 0xff); } function b(v) { ch.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
        b(0x02014b50); a(20); a(20); a(0x0800); a(0); a(0); a(0); b(crc); b(data.length); b(data.length); a(nameBytes.length); a(0); a(0); a(0); a(0); b(0); b(offset);
        for (var i = 0; i < f.name.length; i++) ch.push(f.name.charCodeAt(i) & 0xff);
      })();
      central.push(Uint8Array.from(ch));
      offset += lh.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) { pushBytes(c); cdSize += c.length; });
    u32(0x06054b50); u16(0); u16(0); u16(files.length); u16(files.length); u32(cdSize); u32(cdStart); u16(0);
    return new Blob([Uint8Array.from(out)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // ---------- OOXML 片段构建 ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function run(t, o) { o = o || {}; var r = "<w:r>" + (o.bold ? "<w:rPr><w:b/></w:rPr>" : ""); return r + "<w:t xml:space=\"preserve\">" + esc(t) + "</w:t></w:r>"; }
  function para(inner, style, opts) {
    opts = opts || {}; var pp = "<w:pPr>";
    if (style) pp += "<w:pStyle w:val=\"" + style + "\"/>";
    if (opts.jc) pp += "<w:jc w:val=\"" + opts.jc + "\"/>";
    if (opts.before) pp += "<w:spacing w:before=\"" + opts.before + "\"/>";
    pp += "</w:pPr>";
    return "<w:p>" + (style || opts.jc || opts.before ? pp : "") + inner + "</w:p>";
  }
  function heading(text, lvl) { return para(run(text), lvl === 2 ? "Heading2" : "Heading1"); }
  function pageBreak() { return "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>"; }
  function tocField() {
    return "<w:p><w:pPr><w:spacing w:before=\"120\"/></w:pPr>" +
      "<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>" +
      "<w:r><w:instrText xml:space=\"preserve\"> TOC \\o \"1-2\" \\h \\z \\u </w:instrText></w:r>" +
      "<w:r><w:fldChar w:fldCharType=\"separate\"/></w:r>" +
      "<w:r><w:t xml:space=\"preserve\">（在 Word 中右键“更新域”即可生成正式目录）</w:t></w:r>" +
      "<w:r><w:fldChar w:fldCharType=\"end\"/></w:r></w:p>";
  }
  function table(rows, header) {
    var ncol = rows[0].length, colw = Math.floor(9000 / ncol);
    var borders = "<w:tblBorders>" +
      "<w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BBBBBB\"/>" +
      "<w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BBBBBB\"/>" +
      "<w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BBBBBB\"/>" +
      "<w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BBBBBB\"/>" +
      "<w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"DDDDDD\"/>" +
      "<w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"DDDDDD\"/>" +
      "</w:tblBorders>";
    var grid = "<w:tblGrid>"; for (var i = 0; i < ncol; i++) grid += "<w:gridCol w:w=\"" + colw + "\"/>"; grid += "</w:tblGrid>";
    var body = "";
    rows.forEach(function (r, ri) {
      var cells = "";
      r.forEach(function (c) {
        var isH = header && ri === 0;
        var rpr = isH ? "<w:rPr><w:b/><w:color w:val=\"FFFFFF\"/></w:rPr>" : "";
        var shd = isH ? "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"2F6BFF\"/>" : "";
        cells += "<w:tc><w:tcPr><w:tcW w:w=\"" + colw + "\" w:type=\"dxa\"/>" + shd + "</w:tcPr><w:p><w:r>" + rpr + "<w:t xml:space=\"preserve\">" + esc(c) + "</w:t></w:r></w:p></w:tc>";
      });
      body += "<w:tr>" + cells + "</w:tr>";
    });
    return "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>" + borders + "</w:tblPr>" + grid + body + "</w:tbl>";
  }
  function multiLine(text) { return (text || "").split("\n").map(function (l) { return run(l); }).join("<w:br/>"); }

  // ---------- 样式 ----------
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:cs="Microsoft YaHei"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:b/><w:color w:val="1B4FF0"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="170" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:b/><w:color w:val="2F6BFF"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="140"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:b/><w:color w:val="14213A"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:color w:val="45506A"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
    '</w:styles>';

  // ---------- 主体构建 ----------
  function buildParts(project) {
    var m = SYD.store.get().materials, company = m.company || {}, b = project.basics || {}, D = SYD.domain;
    var today = SYD.util.fmtDate();
    var chs = (project.chapters && project.chapters.length) ? project.chapters : D.planChapters.map(function (c) { return { name: c.name, content: "" }; });

    var body = "";
    var dark = !!project.darkLabel;
    if (dark) {
      body += para(run("【暗标】本响应文件已按招标文件要求隐去投标人身份信息"), null, { jc: "center" });
    }
    // 封面
    body += para(run(project.name), "Title");
    body += para(run("投标响应文件"), "Subtitle");
    body += para("", null);
    if (!dark) body += para(run("投标人：" + (company.name || "（待填）")), null, { jc: "center" });
    else body += para(run("投标人：（按招标文件要求不予披露）"), null, { jc: "center" });
    body += para(run("招标方：" + (b.buyer || project.buyer || "（待填）")), null, { jc: "center" });
    body += para(run("编制日期：" + today), null, { jc: "center" });
    if (!dark) body += para(run("本文件由「智能投标工作平台」生成"), null, { jc: "center" });
    body += pageBreak();
    // 目录
    body += heading("目录", 1);
    body += tocField();
    body += pageBreak();
    // 技术方案
    chs.forEach(function (c, i) {
      body += heading((i + 1) + ". " + c.name, 1);
      body += para(multiLine(c.content && c.content.trim() ? c.content : "（本章内容尚未生成，请在“AI 方案”模块批量生成后重新导出）"));
    });
    // 商务标
    body += heading("商务标响应", 1);
    var bidderName = dark ? "（暗标，按招标文件要求不予披露）" : (company.name || "（待填）");
    var bizRows = [["投标要素", "填写值"]].concat(D.bidFillTemplate.map(function (t) { return [t.f, t.k === "name" ? bidderName : (company[t.k] || "（待填）")]; }));
    body += table(bizRows, true);
    // 报价
    if (project.quote && project.quote.decided) {
      body += heading("报价部分", 1);
      body += para(run("审定报价（人民币）：" + project.quote.decided + " 元"), null);
      var qrows = [["成本 / 项目", "金额(元)"]];
      (project.quote.breakdown || []).forEach(function (bd) { qrows.push([bd.name, String(bd.amount)]); });
      qrows.push(["审定报价合计", String(project.quote.decided)]);
      body += table(qrows, true);
      if (project.quote.note) body += para(run(project.quote.note));
    }
    // 附表
    body += heading("附表", 1);
    body += para(run("一、工期安排"), null);
    body += table([["序号", "阶段", "起始", "周期"], ["1", "方案设计", "合同签订后", "5 个工作日"], ["2", "设备生产与集成", "设计确认后", "30 个日历日"], ["3", "厂内联调与检测", "生产完成后", "7 个日历日"], ["4", "发货与现场安装", "通知发货后", "10 个日历日"], ["5", "验收与培训", "安装完成后", "3 个日历日"]], true);
    body += para(run("二、技术偏离表"), null);
    body += table([["序号", "招标文件要求", "投标响应", "偏离"], ["1", "（粘贴招标参数）", "（填写投标参数）", "无偏离"]], true);
    body += para(run("三、培训计划"), null);
    body += table([["对象", "内容", "时长"], ["操作工", "设备操作与日常维护", "1 天"], ["技术员", "原理与故障处理", "0.5 天"]], true);

    var sectPr = "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/></w:sectPr>";
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
      body + sectPr + '</w:body></w:document>';

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(project.name) + '</dc:title><dc:creator>' + esc(dark ? "（暗标未署名）" : (company.name || "智能投标工作平台")) + '</dc:creator>' +
      '<cp:lastModifiedBy>智能投标工作平台</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + today + 'T00:00:00Z</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + today + 'T00:00:00Z</dcterms:modified></cp:coreProperties>';

    var appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>智能投标工作平台</Application></Properties>';

    return [
      { name: "[Content_Types].xml", bytes: utf8(contentTypes) },
      { name: "_rels/.rels", bytes: utf8(rootRels) },
      { name: "word/document.xml", bytes: utf8(documentXml) },
      { name: "word/styles.xml", bytes: utf8(STYLES) },
      { name: "word/_rels/document.xml.rels", bytes: utf8(docRels) },
      { name: "docProps/core.xml", bytes: utf8(coreXml) },
      { name: "docProps/app.xml", bytes: utf8(appXml) }
    ];
  }

  function buildBidDocx(project) { return makeZip(buildParts(project)); }

  function exportBid(project) {
    try {
      var blob = buildBidDocx(project);
      var name = (project.name || "投标响应文件") + "_完整标书.docx";
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
      SYD.util.toast("已导出完整 Word 标书（含封面）：" + name);
    } catch (e) { SYD.util.toast("导出失败：" + e.message); }
  }

  global.SYD = global.SYD || {};
  global.SYD.word = { buildParts: buildParts, buildBidDocx: buildBidDocx, exportBid: exportBid };
})(window);
