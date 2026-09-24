/* ui.js —— 各模块渲染与交互 */
(function () {
  "use strict";
  var SYD = window.SYD, S = SYD.store, U = SYD.util, D = SYD.domain;
  var view = document.getElementById("view");
  var cur = { pid: null };

  function setView(t) { document.getElementById("view-title").textContent = t; }
  function save() { S.save(); }
  function projects() { return S.get().projects; }
  function curProject() { return projects().filter(function (p) { return p.id === cur.pid; })[0]; }
  function on(sel, ev, fn) { var e = view.querySelector(sel); if (e) e.addEventListener(ev, fn); }
  function onAll(sel, ev, fn) { view.querySelectorAll(sel).forEach(function (e) { e.addEventListener(ev, fn); }); }
  function esc(s) { return U.escapeHtml(s); }

  // ---------- 文档上传通用：放开常用办公/图文/音视频格式，并按类型真实提取正文 ----------
  // 覆盖：PDF、Word(docx)、WPS、文本、表格、演示、常用图片、常用音视频
  var ACCEPT_DOCS = ".pdf,.doc,.docx,.wps,.dot,.rtf,.txt,.md,.csv,.log,.xlsx,.xls,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.bmp,.webp,.svg,.mp4,.mov,.avi,.mkv,.mp3,.wav,.m4a";
  // 读取所选文件 → { text:正文, msg:提示 }；无法自动提取时 reject({ noExtract:true, message:指引文案 })
  function extractDocText(file) {
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    function readText() {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res({ text: String(r.result), msg: "已读取 " + file.name }); };
        r.onerror = function () { rej(new Error("文件读取失败")); };
        r.readAsText(file);
      });
    }
    if (ext === "pdf") {
      if (!SYD.pdf || !SYD.pdf.available()) return Promise.reject(new Error("PDF 引擎未加载，请改用 .docx/.txt 或直接粘贴正文"));
      U.toast("PDF 解析中…");
      return SYD.pdf.parseFile(file).then(function (t) {
        if (!t) throw new Error("PDF 中未提取到文字（可能为扫描件，请粘贴正文）");
        return { text: t, msg: "PDF 解析完成，共 " + t.length + " 字" };
      });
    }
    if (ext === "docx") {
      if (typeof window.DecompressionStream === "undefined") {
        return Promise.reject({ noExtract: true, message: "当前浏览器版本过低，无法自动提取 .docx 正文：请将文件另存为 PDF 后上传，或直接粘贴正文" });
      }
      U.toast("Word 文档解析中…");
      return SYD.docx.extractFile(file).then(function (t) {
        if (!t) throw new Error(".docx 中未提取到正文");
        return { text: t, msg: "Word(docx) 提取完成，共 " + t.length + " 字" };
      });
    }
    if (["txt", "md", "csv", "log", "rtf"].indexOf(ext) >= 0) return readText();
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"].indexOf(ext) >= 0) {
      return Promise.reject({ noExtract: true, message: "图片请到「私人图库」上传（支持 AI 视觉理解）；知识库/方案提取仅收文字内容" });
    }
    if (["mp4", "mov", "avi", "mkv", "mp3", "wav", "m4a"].indexOf(ext) >= 0) {
      return Promise.reject({ noExtract: true, message: "知识库/方案提取是文字检索库，音视频不入库；如有讲稿、字幕文本可直接粘贴到正文框" });
    }
    // doc / wps / xls / ppt 等二进制办公格式：给出明确转换指引，不静默塞乱码
    return Promise.reject({ noExtract: true, message: "." + ext + " 格式暂不支持自动提取正文：请另存为 PDF（可全文自动提取）或 .docx，也可直接粘贴正文" });
  }

  // ---------- 文件名智能识别：解析标题/类型/日期/编号/附件信息 ----------
  // 用于全站附件上传：一次性多选后，自动按文件名识别命名、补全标题与附件信息。
  // 纯启发式，不依赖 AI，未配置大模型也能用。
  var DOC_TYPE_WORDS = [
    "招标公告", "中标通知书", "中标", "招标文件", "投标文件", "投标", "合同", "框架协议", "协议",
    "资质证书", "资质", "资格", "证书", "体系认证", "认证", "检测报告", "检测", "检验报告", "质检",
    "图纸", "图册", "图集", "总图", "平面图", "使用说明书", "操作手册", "技术手册",
    "技术规范", "技术规格", "技术要求", "技术方案", "报价单", "报价清单", "报价", "清单", "预算",
    "业绩证明", "业绩", "授权书", "授权", "代理", "代理商", "承诺函", "承诺", "偏离表", "偏离",
    "响应文件", "响应", "标准", "规范", "澄清", "答疑纪要", "答疑", "补充", "附件",
    "产品样本", "样本", "样册", "公司介绍", "介绍", "证明", "声明函", "声明", "意向书",
    "投标保函", "履约保函", "保函", "正本", "副本"
  ];
  function analyzeFileName(rawName) {
    var name = (rawName || "").replace(/\.[^.]+$/, ""); // 去扩展名
    var info = { title: "", type: "", date: "", code: "", info: "" };
    // 1) 日期：2026-03-04 / 2026_03_04 / 20260304 / 2026.3.4
    var dM = name.match(/(20\d{2}|19\d{2})(?:[-_.]?(\d{1,2})(?:[-_.]?(\d{1,2}))?)?/);
    if (dM) {
      if (dM[2] && dM[3]) {
        var mo = dM[2], da = dM[3];
        info.date = dM[1] + "-" + (mo.length === 1 ? "0" + mo : mo) + "-" + (da.length === 1 ? "0" + da : da);
      } else {
        info.date = dM[1];
      }
    }
    var dateDigits = dM ? dM[0].replace(/\D/g, "") : "";
    var dateParts = dM ? [dM[1], dM[2], dM[3]].filter(Boolean).map(String) : [];
    var exclude = {}; exclude[dateDigits] = 1; dateParts.forEach(function (pp) { exclude[pp] = 1; });
    // 2) 编号：取较长数字串（排除日期数字串及其年/月/日成分，避免年份被误判为编号）
    var nums = name.match(/\d{3,}/g) || [];
    for (var i = 0; i < nums.length; i++) {
      if (!exclude[nums[i]]) { info.code = nums[i]; break; }
    }
    // 3) 类型词（按长度降序，优先匹配更长更具体的词，避免“方案”误伤）
    var sorted = DOC_TYPE_WORDS.slice().sort(function (a, b) { return b.length - a.length; });
    var tw = "";
    for (var j = 0; j < sorted.length; j++) {
      if (name.indexOf(sorted[j]) >= 0) { tw = sorted[j]; break; }
    }
    info.type = tw;
    // 4) 标题：剔除日期串、类型词、长数字串、分隔符后的剩余
    var t = name;
    if (dM) t = t.split(dM[0]).join(" ");
    if (tw) t = t.split(tw).join(" ");
    // 保留“字母+数字”型号/标准号（如 ISO9001、GB4000），仅剔除孤立长数字串（编号）
    var prot = [];
    t = t.replace(/[A-Za-z]+\d{2,}/g, function (m) { prot.push(m); return " P" + (prot.length - 1) + " "; });
    t = t.replace(/\d{3,}/g, " ");
    t = t.replace(/ P(\d+) /g, function (_, i) { return prot[+i]; });
    t = t.replace(/[_\-—–·\s]+/g, " ").replace(/[〔〕\[\]（）()、，。：:；;]/g, " ").trim();
    info.title = t || (rawName ? rawName.replace(/\.[^.]+$/, "") : "未命名文档");
    // 5) 附件信息串
    var parts = [];
    if (info.type) parts.push("类型：" + info.type);
    if (info.date) parts.push("日期：" + info.date);
    if (info.code) parts.push("编号：" + info.code);
    info.info = parts.join(" ｜ ");
    return info;
  }
  // 由“文件名 + 已提取正文”批量组装知识库条目（标题/附件信息自动识别）
  function buildKBEntries(metas) {
    return (metas || []).map(function (it) {
      var a = analyzeFileName(it.name);
      return {
        id: U.uid(),
        title: a.title,
        text: it.text || "",
        meta: { name: it.name, type: a.type, date: a.date, code: a.code, info: a.info, size: it.size || 0 }
      };
    });
  }

  // ---------- 原件/不可编辑类型判定（体系/证书/资质等） ----------
  // 上传时按文件名识别的类型命中以下关键词，即视为“原件”，自动锁定为只读（原样保留，仅可预览/打印/下载），
  // 满足“体系、证书、资质不可编辑”的要求；同时每条支持手动「解锁」转为可编辑。
  var LOCK_TYPE_KEYWORDS = [
    "资质证书", "资质", "资格", "体系认证", "体系", "认证", "检测报告", "检测", "检验报告",
    "质检", "专利证书", "软件著作权", "软著", "信用等级", "3C认证", "CE认证", "型式批准",
    "行政许可", "登记证", "许可证", "认定证书", "注册证", "批准证书"
  ];
  function isOriginalType(type) {
    if (!type) return false;
    for (var i = 0; i < LOCK_TYPE_KEYWORDS.length; i++) {
      if (type.indexOf(LOCK_TYPE_KEYWORDS[i]) >= 0) return true;
    }
    // 以“证书/认证/资质/体系”结尾的也视为原件
    if (/(证书|认证|资质|体系)$/.test(type)) return true;
    return false;
  }

  // ---------- 附件查看器：预览 / 打印 / 自动识别再编辑（全站通用） ----------
  // 统一支撑：知识库文档、私人图库图片、方案招标文件原文。
  // 设计原则（原基础+局部提升）：不改动已有存储结构，仅叠加“查看/打印/再编辑”能力；
  // 正文/描述在查看器内可改，点“保存并关闭”经 onSave 回写，满足“自动识别再编辑”。
  // opts: { kind:'doc'|'image', title, text, src?, meta?, onSave(newTitle,newText) }
  function attachmentPrintHTML(o) {
    o = o || {};
    var title = esc(o.title || "未命名附件");
    var meta = o.meta || {};
    var metaParts = [meta.type && ("类型：" + meta.type), meta.date && ("日期：" + meta.date), meta.code && ("编号：" + meta.code), meta.name && ("文件名：" + meta.name)].filter(Boolean);
    var metaLine = metaParts.length ? "<div class='meta'>" + esc(metaParts.join(" ｜ ")) + "</div>" : "";
    var head = "<!doctype html><html lang='zh'><head><meta charset='utf-8'><title>打印 - " + title + "</title>" +
      "<style>body{font-family:'Microsoft YaHei',sans-serif;padding:24px;color:#222;max-width:900px;margin:0 auto}" +
      "h2{font-size:20px;margin:0 0 6px}.meta{color:#666;font-size:13px}hr{border:none;border-top:1px solid #eee;margin:10px 0}" +
      "img{max-width:100%;border:1px solid #ccc;margin:12px 0}.txt{white-space:pre-wrap;line-height:1.8;margin-top:8px;font-size:14px}" +
      "@media print{button{display:none}}</style></head><body>";
    var foot = "</body></html>";
    if (o.kind === "image" && o.src) {
      return head + "<h2>" + title + "</h2>" + metaLine + "<hr/><img src='" + o.src + "'/><div class='txt'>" + esc(o.text || "") + "</div>" + foot;
    }
    return head + "<h2>" + title + "</h2>" + metaLine + "<hr/><div class='txt'>" + esc(o.text || "") + "</div>" + foot;
  }
  function printAttachment(o) {
    var w = window.open("", "_blank");
    if (!w) { U.toast("打印被浏览器拦截，请允许弹出窗口后重试"); return; }
    w.document.open(); w.document.write(attachmentPrintHTML(o)); w.document.close();
    try { w.focus(); } catch (e) {}
  }
  function openAttachmentViewer(o) {
    o = o || {};
    var ov = document.getElementById("att-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "att-overlay";
      ov.className = "modal-overlay att-overlay";
      document.body.appendChild(ov);
    }
    var isImg = o.kind === "image";
    var readonly = !!o.readonly;
    var meta = o.meta || {};
    var metaParts = [meta.type, meta.date, meta.code].filter(Boolean);
    var metaLine = metaParts.length ? ("自动识别：" + esc(metaParts.join(" ｜ ")) + (meta.name ? " ｜ 文件：" + esc(meta.name) : "")) : "";
    var lockNote = readonly ? "<div class='att-readonly-note'>🔒 原件只读：标题与内容已原样锁定，不可修改（如需编辑请在列表中点击「解锁」）。仅可预览与打印。</div>" : "";
    var editHint = readonly ? "，已锁定" : "，可改";
    var previewArea = isImg
      ? "<div class='att-preview'><img src='" + (o.src || "") + "' alt='预览'/></div><div class='att-label'>描述（自动识别" + editHint + "）</div><textarea id='att-text' class='att-text'" + (readonly ? " readonly" : "") + ">" + esc(o.text || "") + "</textarea>"
      : "<div class='att-label'>正文（自动识别" + editHint + "）</div><textarea id='att-text' class='att-text'" + (readonly ? " readonly" : "") + ">" + esc(o.text || "") + "</textarea>";
    var actions = readonly
      ? "<div class='att-actions'><button class='btn-primary btn-sm' id='att-print'>打印</button><button class='btn-ghost btn-sm' id='att-close'>关闭</button></div>"
      : "<div class='att-actions'><button class='btn-primary btn-sm' id='att-print'>打印</button><button class='btn-ghost btn-sm' id='att-save'>保存并关闭</button><button class='btn-ghost btn-sm' id='att-close'>关闭</button></div>";
    ov.innerHTML =
      "<div class='att-box'>" +
      "<div class='att-head'><b>" + (isImg ? (readonly ? "图片预览 / 打印（只读）" : "图片预览 / 打印 / 编辑") : (readonly ? "文档预览 / 打印（只读）" : "文档预览 / 打印 / 编辑")) + "</b><button class='att-x' id='att-x' aria-label='关闭'>×</button></div>" +
      "<div class='att-row'><label>标题（自动识别" + editHint + "）</label><input id='att-title' value='" + esc(o.title || "") + "'" + (readonly ? " disabled" : "") + "/></div>" +
      (metaLine ? "<div class='att-meta'>" + metaLine + "</div>" : "") +
      lockNote +
      previewArea +
      actions +
      "</div>";
    ov.classList.add("show");
    function close() { ov.classList.remove("show"); ov.innerHTML = ""; }
    document.getElementById("att-x").onclick = close;
    document.getElementById("att-close").onclick = close;
    ov.onclick = function (e) { if (e.target === ov) close(); };
    document.getElementById("att-print").onclick = function () {
      printAttachment({ kind: o.kind, title: document.getElementById("att-title").value, text: document.getElementById("att-text").value, src: o.src, meta: o.meta });
    };
    var saveBtn = document.getElementById("att-save");
    if (saveBtn) saveBtn.onclick = function () {
      var nt = document.getElementById("att-title").value;
      var ntx = document.getElementById("att-text").value;
      if (o.onSave) o.onSave(nt, ntx);
      U.toast("已保存修改");
      close();
    };
  }

  // ---------- 通用弹窗（替代原生 prompt/confirm，兼容预览环境） ----------
  function modal(opts) {
    opts = opts || {};
    var ov = document.getElementById("modal-overlay");
    if (!ov) return;
    document.getElementById("modal-title").textContent = opts.title || "";
    document.getElementById("modal-sub").textContent = opts.sub || "";
    var input = document.getElementById("modal-input");
    var okBtn = document.getElementById("modal-ok");
    var cancelBtn = document.getElementById("modal-cancel");
    if (opts.input === false) { input.classList.add("hidden"); }
    else { input.classList.remove("hidden"); input.value = opts.value != null ? opts.value : ""; }
    okBtn.textContent = opts.okText || "确定";
    cancelBtn.textContent = opts.cancelText || "取消";
    ov.classList.add("show");
    function close() { ov.classList.remove("show"); }
    okBtn.onclick = function () { var v = input.value; close(); if (opts.onOk) opts.onOk(v); };
    cancelBtn.onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    setTimeout(function () { try { input.focus(); if (opts.input !== false) input.select(); } catch (e) {} }, 30);
  }
  function confirmModal(opts) {
    modal({ title: opts.title, sub: opts.sub, input: false, okText: opts.okText || "确认", cancelText: "取消", onOk: opts.onOk, onCancel: opts.onCancel });
  }

  // 图库视觉理解结果 → 文本上下文（用于融入技术标）
  function imageContextText() {
    var imgs = (S.get().materials.images) || [];
    var understood = imgs.filter(function (im) { return im.desc && im.desc.trim(); });
    if (!understood.length) return "";
    return "【参考图库素材（已视觉理解）】\n" + understood.map(function (im) {
      return "· " + (im.desc || im.name) + (im.tags && im.tags.length ? "（标签：" + im.tags.join("、") + "）" : "");
    }).join("\n");
  }

  function newProject(name) {
    return {
      id: U.uid(), name: name || "未命名投标项目", buyer: "", projectDesc: "", deadline: "", budget: "", scoreRule: "",
      rawText: "", basics: null, mode: "quick", chapters: [], length: "中", generated: false,
      qc: { items: [], versions: [] }, quote: null, status: "草稿", updated: U.fmtDate(),
      darkLabel: !!(S.get().settings && S.get().settings.defaultDarkLabel), feedImg: true
    };
  }
  function ensureChapters(p) {
    if (!p.chapters || !p.chapters.length) {
      p.chapters = D.planChapters.map(function (c) { return { name: c.name, tip: c.tip, length: p.length || "中", content: "" }; });
    }
    return p.chapters;
  }

  // ---------- 离线方案生成（工业产品类模板） ----------
  function offlineChapter(p, ch, imgCtx) {
    var b = p.basics || {};
    var kb = S.get().materials.knowledge || [];
    var buyer = b.buyer || p.buyer || "招标方";
    var proj = b.project || p.projectDesc || "本次采购项目";
    var kbhit = kb.filter(function (d) { return (d.text + d.title).indexOf(ch.name.slice(0, 4)) >= 0; }).slice(0, 1);
    var lead = "";
    if (kbhit.length) lead = "结合企业知识库《" + kbhit[0].title + "》的要点，";
    var len = ch.length || "中";
    var para = {
      "项目理解与需求分析": "针对" + buyer + "《" + proj + "》的需求，我方深入理解了项目工况、产能目标与核心技术痛点。本项目属于冶金焦化行业工业产品类采购，需重点关注设备稳定性、检测精度与交付周期。",
      "产品总体技术方案": lead + "本方案提供成套工业设备与技术路线：以模块化设计为基础，集成自动控温、数据采集与安全防护，确保长期连续运行可靠。核心部件选用成熟工业级器件，满足焦化现场高温、粉尘环境要求。",
      "关键技术参数与响应表": "下表逐条响应招标文件技术要求。凡优于招标要求的指标标注“正偏离”，等同标注“无偏离”，并附检测依据。具体参数见“技术偏离表”附表。",
      "执行标准与质量保障": "设备研制与验收严格依据国家标准：" + D.standards.slice(0, 4).join("；") + " 等。出厂前进行空载与负载联调，附第三方或厂内检测报告，质量追溯至每台设备。",
      "供货范围与进度计划": "供货范围涵盖主机、辅机、控制软件及备品备件。合同签订后按“设计—采购—生产—调试—验收”节点排产，详见“工期安排”附表，确保按期交货。",
      "安装调试与验收方案": "到货后由厂家工程师现场指导安装与管线对接，完成单机与联动调试，依据技术协议进行性能验收，签署验收单并移交全套技术资料。",
      "操作培训与技术交底": "验收前为招标方操作与维护人员提供系统培训，内容包括原理、操作、日常维护与常见故障处理，并提交培训签到与教材。",
      "售后服务与质保体系": "提供质保期内的免费维修与终身技术支持，承诺接到报修后快速响应。建立专属客户档案，定期回访，保障备品备件长期供应。"
    };
    var base = para[ch.name] || (lead + "围绕《" + ch.name + "》，我方结合项目实际与同类业绩，提供完整、可落地的方案内容，确保充分响应评分要求。");
    if (ch.name === "产品总体技术方案" && imgCtx) {
      base += "\n\n（已结合企业图库视觉理解素材呼应设备外观与结构：" + imgCtx.replace(/\n+/g, "；") + "）";
    }
    var more = len === "长" ? "\n\n补充：进一步细化实施细节、风险预案与典型案例，增强方案厚度与技术说服力。" :
      len === "短" ? "" : "\n\n补充：给出关键实施步骤与责任界面，便于招标方评估可执行性。";
    return base + more;
  }

  async function generatePlan(p, useAI) {
    ensureChapters(p);
    var imgCtx = (p.feedImg !== false) ? imageContextText() : "";
    for (var i = 0; i < p.chapters.length; i++) {
      var ch = p.chapters[i];
      if (useAI && SYD.ai.ready()) {
        try {
          var sys = "你是冶金焦化行业工业设备投标专家，擅长写技术标。只输出该章节正文，不重复章节标题。";
          var usr = "投标项目：" + (p.basics ? p.basics.project : p.projectDesc) + "；招标方：" + (p.basics ? p.basics.buyer : p.buyer) +
            "；请撰写方案章节《" + ch.name + "》，篇幅：" + (ch.length || "中") + "。结合工业产品类设备特点。" +
            (imgCtx ? "\n\n参考图库视觉理解素材（用于呼应设备外观/结构，可恰当引用）：\n" + imgCtx : "");
          ch.content = await SYD.ai.chat(sys, usr, { temperature: 0.7 });
        } catch (e) { ch.content = offlineChapter(p, ch, imgCtx) + "\n\n（AI 调用失败，已用离线模板：" + e.message + "）"; }
      } else {
        ch.content = offlineChapter(p, ch, imgCtx);
      }
    }
    p.generated = true; p.updated = U.fmtDate(); save();
  }

  function chaptersToDoc(p) {
    var html = "<h1 style='text-align:center'>" + esc(p.name) + " · 技术方案</h1>";
    ensureChapters(p).forEach(function (c, i) {
      html += "<h2>" + (i + 1) + ". " + esc(c.name) + "</h2><p>" + esc(c.content || "（未生成）") + "</p>";
    });
    return html;
  }

  // ================= 工作台 =================
  function renderDashboard() {
    setView("工作中心");
    var ps = projects();
    var mats = S.get().materials;
    var pendingQC = ps.filter(function (p) { return p.qc && p.qc.items && p.qc.items.length && p.qc.items.some(function (i) { return !i.status; }); }).length;
    var gen = ps.filter(function (p) { return p.generated; }).length;
    var quoted = ps.filter(function (p) { return p.quote && p.quote.decided; }).length;
    var html = "";
    // 封面 Hero（首页专属感）
    html += "<div class='cover'>" +
      "<div class='cover-glow'></div>" +
      "<div class='cover-brand'>梵音未改 · 出品</div>" +
      "<h1 class='cover-title'>智能投标工作平台</h1>" +
      "<div class='cover-sub'>孟凡林 的专属投标工作台 · 冶金焦化 B2B 投标响应系统</div>" +
      "<div class='cover-tags'>" +
        "<span class='cover-tag'>离线可用</span>" +
        "<span class='cover-tag'>数据本地保存</span>" +
        "<span class='cover-tag'>纯前端 · 无后台</span>" +
      "</div>" +
      "<button class='btn-primary cover-cta' id='cover-new'>+ 新建投标项目</button>" +
    "</div>";

    html += "<div class='grid grid-4'>";
    html += stat(ps.length, "投标项目");
    html += stat(gen, "已生成方案");
    html += stat(quoted, "已审定报价");
    html += stat(pendingQC, "待完成质检");
    html += "</div>";

    html += "<div class='card'><div class='section-title'>最近投标项目</div><div class='section-sub'>点击进入 智能方案模块继续编辑</div>";
    if (!ps.length) html += "<div class='empty'>暂无项目，点击右上角“新建投标项目”开始</div>";
    else {
      html += "<div class='list'>";
      ps.slice().reverse().forEach(function (p) {
        html += "<div class='item' data-open='" + p.id + "'><div><div style='font-weight:600'>" + esc(p.name) + "</div><div class='muted' style='font-size:12px'>" +
          (p.basics && p.basics.buyer ? "招标方：" + esc(p.basics.buyer) + " · " : "") + "更新 " + esc(p.updated) + " · " + (p.generated ? "已生成" : "草稿") + "</div></div>" +
          "<span class='tag " + (p.generated ? "ok" : "gray") + "'>进入</span></div>";
      });
      html += "</div>";
    }
    html += "</div>";

    // 模块导航（玻璃卡）
    html += "<div class='card'><div class='section-title'>平台能力总览</div><div class='section-sub'>借鉴“小晓AI标书”全部核心能力，面向冶金焦化 B2B 投标重构 · 点击卡片直达模块</div>";
    html += "<div class='module-grid'>";
    var mods = [
      ["✎", "智能方案", "三种模式（快速/快捷评分/定制）+ 工业产品类项目规划 + 目录生成 + 批量成稿", "plan"],
      ["▣", "智能标书", "招标解读 / 技术标创作 / 商务标一键填空（结合企业资料库）", "bid"],
      ["¥", "智能报价", "成本测算 → AI 建议报价 → 用户审定填入 → 贯通商务标与导出", "quote"],
      ["✔", "智能质检", "招标文件解析→质检项抽取→多版本对比→自定义配置，可视化报告", "qc"],
      ["⊞", "方案查重", "文本语义相似度比对，规避串标风险", "dup"],
      ["▤", "企业素材", "知识库(RAG) / 私人图库(视觉理解) / 企业资料库（填空底座）", "lib"]
    ];
    mods.forEach(function (m) { html += "<div class='mod-card' data-go='" + m[3] + "'><div class='mod-ico'>" + m[0] + "</div><div class='mod-title'>" + m[1] + "</div><div class='mod-desc'>" + m[2] + "</div></div>"; });
    html += "</div></div>";
    view.innerHTML = html;
    onAll("[data-open]", "click", function (e) { cur.pid = e.currentTarget.getAttribute("data-open"); SYD.ui.render("plan"); });
    onAll("[data-go]", "click", function (e) { var v = e.currentTarget.getAttribute("data-go"); document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-view") === v); }); SYD.ui.render(v); });
    var cn = view.querySelector("#cover-new"); if (cn) cn.addEventListener("click", function () { var b = document.getElementById("btn-new-project"); if (b) b.click(); });
  }
  function stat(n, l) { return "<div class='stat'><div class='num'>" + n + "</div><div class='lab'>" + l + "</div></div>"; }

  // ================= 智能方案 =================
  function renderPlan() {
    setView("智能方案");
    var ps = projects();
    if (!ps.length) { renderModuleEmpty("✎", "智能方案", "三种模式（快速/快捷评分/定制）+ 工业产品类项目规划 + 目录生成 + 批量成稿，一键导出 Word", ["新建项目", "上传招标文件", "选择模式", "智能提取信息", "生成项目规划", "生成目录", "批量生成", "导出 Word"]); return; }
    var p = curProject() || ps[0]; cur.pid = p.id;

    var steps = ["新建项目", "上传招标文件", "选择模式", "智能提取信息", "生成项目规划", "生成目录", "目录预览", "选择篇幅", "批量生成", "导出"];
    var html = "<div class='grid' style='grid-template-columns:240px 1fr'>";
    // 左：项目列表
    html += "<div><div class='card' style='margin-bottom:12px'><div class='section-title' style='font-size:13px'>项目</div>";
    ps.forEach(function (x) {
      html += "<div class='item' data-pick='" + x.id + "' style='" + (x.id === p.id ? "border-color:var(--primary)" : "") + "'><div style='font-size:13px'>" + esc(x.name) + "</div>" +
        "<span class='tag " + (x.generated ? "ok" : "gray") + "'>" + (x.generated ? "已生成" : "草稿") + "</span></div>";
    });
    html += "</div></div>";

    // 右：工作流
    html += "<div>";
    html += "<div class='steps'>";
    steps.forEach(function (s, i) {
      var cls = "step";
      if (i === 0) cls += " done";
      if (p.rawText && i === 1) cls += " done";
      if (p.basics && i === 3) cls += " done";
      if (p.generated && (i === 5 || i === 8)) cls += " done";
      html += "<div class='" + cls + "'><span class='snum'>" + (i + 1) + "</span>" + s + "</div>";
    });
    html += "</div>";

    html += "<div class='card'>";
    html += "<div class='section-title'>① 项目与招标文件</div>";
    html += "<label>项目名称</label><input id='f-name' value='" + esc(p.name) + "'/>";
    html += "<label>招标文件原文（粘贴，或上传 .pdf / .txt / .md）</label>";
    html += "<textarea id='f-raw' rows='7' placeholder='将招标文件全文粘贴此处，或上传 PDF 由本地 pdf.js 真实解析，用于智能提取招标方、项目、预算、资质、标准、评分办法…'>" + esc(p.rawText) + "</textarea>";
    html += "<div class='toolbar'><input type='file' id='f-file' multiple accept='" + ACCEPT_DOCS + "' style='width:auto'/><button class='btn-ghost btn-sm' id='b-extract'>智能提取基础信息</button><button class='btn-ghost btn-sm' id='b-fraw-view'>预览/打印</button><span class='muted' id='extract-tip' style='font-size:12px'></span></div>";

    html += "<label>撰写模式</label><div class='row wrap'>";
    [["quick", "快速编写"], ["score", "快捷评分"], ["custom", "定制评分"]].forEach(function (m) {
      html += "<label class='pill'><input type='radio' name='mode' value='" + m[0] + "' " + (p.mode === m[0] ? "checked" : "") + " style='width:auto'/> " + m[1] + "</label>";
    });
    html += "</div>";
    if (p.mode === "score") html += "<div class='muted' style='font-size:12px;margin-top:6px'>将依据统一评分标准约束目录与内容方向（见设置可维护评分维度）。</div>";
    if (p.mode === "custom") html += "<div class='muted' style='font-size:12px;margin-top:6px'>将按您在目录中自定义的章节与说明生成更准确方案。</div>";
    html += "</div>";

    // 基础信息卡片
    if (p.basics) {
      html += "<div class='card'><div class='section-title'>④ 提取的基础信息（可编辑）</div><div class='grid grid-2'>";
      html += fld("招标方", "b-buyer", p.basics.buyer);
      html += fld("项目名称", "b-proj", p.basics.project);
      html += fld("预算/限价", "b-budget", p.basics.budget);
      html += fld("截止日期", "b-deadline", p.basics.deadline);
      html += fld("评分办法", "b-score", p.basics.scoreRule);
      html += fld("识别资质", "b-certs", (p.basics.certs || []).join("、"));
      html += "</div></div>";
    }

    // 暗标 + 图库联动
    var imgs0 = S.get().materials.images || [];
    var visN0 = imgs0.filter(function (im) { return im.desc; }).length;
    html += "<div class='card'><div class='section-title'>⑤ 版式与素材联动</div><div class='section-sub'>暗标隐去投标人身份；图库视觉理解自动融入技术标</div>";
    html += "<label class='pill' style='margin:6px 0'><input type='checkbox' id='p-dark' " + (p.darkLabel ? "checked" : "") + " style='width:auto'/> 暗标模式（导出时隐去投标人名称与署名，符合无标识投标要求）</label>";
    html += "<label class='pill' style='margin:6px 0'><input type='checkbox' id='p-feed' " + (p.feedImg !== false ? "checked" : "") + " style='width:auto'/> 将图库理解结果融入技术标（已理解 " + visN0 + " 张）</label>";
    if (visN0) {
      html += "<div class='img-chips'>";
      imgs0.filter(function (im) { return im.desc; }).slice(0, 10).forEach(function (im) {
        html += "<span class='img-chip' title='" + esc(im.desc) + "'>" + (im.tags && im.tags.length ? esc(im.tags[0]) : esc(im.name)) + "</span>";
      });
      html += "</div>";
    }
    html += "</div>";

    // 目录编辑
    html += "<div class='card'><div class='section-title'>⑥⑦ 方案目录（工业产品类 · 可增删/改篇幅）</div>";
    html += "<div id='chap-list'>";
    ensureChapters(p).forEach(function (c, i) {
      html += "<div class='checkrow' data-ci='" + i + "'><div class='ctext'><b>" + (i + 1) + ". " + esc(c.name) + "</b> <span class='muted' style='font-size:11px'>" + esc(c.tip || "") + "</span>" +
        "<div style='margin-top:4px'><input class='c-name' value='" + esc(c.name) + "' style='max-width:60%'/> " +
        "<select class='c-len' style='width:90px'><option value='短'" + (c.length === "短" ? " selected" : "") + ">短</option><option value='中'" + (c.length === "中" ? " selected" : "") + ">中</option><option value='长'" + (c.length === "长" ? " selected" : "") + ">长</option></select></div></div>" +
        "<button class='btn-danger btn-sm c-del'>删</button></div>";
    });
    html += "</div>";
    html += "<div class='toolbar'><button class='btn-ghost btn-sm' id='b-add-chap'>+ 添加章节</button><button class='btn-primary btn-sm' id='b-gen'>⑨ 批量生成方案内容</button>";
    html += "<span class='muted' id='gen-tip' style='font-size:12px'></span></div></div>";

    // 预览/导出
    html += "<div class='card'><div class='section-title'>⑧⑩ 方案预览 / 导出</div>";
    if (p.generated) {
      html += "<div class='editor-out' id='preview'>" + esc(chaptersToText(p)) + "</div>";
      html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-export-docx'>导出完整 Word 标书(.docx)</button><button class='btn-ghost btn-sm' id='b-export-md'>导出 Markdown</button><button class='btn-ghost btn-sm' id='b-export-txt'>导出 TXT</button><button class='btn-ghost btn-sm' id='b-export-doc'>导出 Word(.doc)</button></div>";
    } else {
      html += "<div class='empty'>点击“批量生成方案内容”后在此预览</div>";
    }
    html += "</div>";

    // 方案附表
    html += "<div class='card'><div class='section-title'>方案附表（工期安排 / 常用附表）</div><div class='section-sub'>工业产品类投标常附：设备清单、技术偏离表、培训计划</div>";
    html += "<div class='toolbar'><button class='btn-ghost btn-sm' id='b-appendix'>生成附表</button></div>";
    html += "<div id='appendix-out'></div></div>";

    html += "</div></div>";
    view.innerHTML = html;

    // 事件
    on("#f-name", "input", function (e) { p.name = e.target.value; save(); });
    on("#f-raw", "input", function (e) { p.rawText = e.target.value; save(); });
    on("#f-file", "change", function (e) {
      var files = e.target.files; if (!files || !files.length) return;
      e.target.value = ""; // 允许重复选择同一文件
      var arr = Array.prototype.slice.call(files), done = 0, parts = [], names = [];
      function finalize() {
        if (done !== arr.length) return;
        var merged = parts.join("\n\n");
        if (merged.trim()) { p.rawText = (p.rawText && p.rawText.trim() ? p.rawText.trim() + "\n\n" : "") + merged; }
        var rawEl = document.getElementById("f-raw"); if (rawEl) rawEl.value = p.rawText || "";
        save();
        document.getElementById("extract-tip").textContent = "已载入 " + arr.length + " 个文件：" + names.join("、") + "（已自动提取正文，可继续编辑）";
      }
      arr.forEach(function (f) {
        names.push(f.name);
        extractDocText(f).then(function (res) {
          parts.push("【" + f.name + "】\n" + res.text);
          done++; finalize();
        }).catch(function (err) {
          parts.push("【" + f.name + "】\n（" + (err && err.noExtract ? err.message : "提取失败") + "）");
          done++; finalize();
        });
      });
    });
    on("#b-extract", "click", function () {
      p.basics = SYD.ai.extractBasics(p.rawText);
      if (!p.basics.buyer && !p.basics.project) { document.getElementById("extract-tip").textContent = "未识别到关键字段，可手动补全"; }
      else document.getElementById("extract-tip").textContent = "已提取：" + [p.basics.buyer, p.basics.project, p.basics.budget].filter(Boolean).join(" / ");
      save(); renderPlan();
    });
    on("#b-fraw-view", "click", function () {
      openAttachmentViewer({
        kind: "doc", title: p.name, text: p.rawText, meta: null,
        onSave: function (nt, ntx) {
          p.rawText = ntx;
          var el = document.getElementById("f-raw"); if (el) el.value = ntx;
          save(); U.toast("已保存到招标文件原文");
        }
      });
    });
    onAll("input[name=mode]", "change", function (e) { p.mode = e.target.value; save(); renderPlan(); });
    if (p.basics) {
      ["buyer", "proj", "budget", "deadline", "score", "certs"].forEach(function (k) {
        on("#b-" + k, "input", function (e) { p.basics[k === "proj" ? "project" : k === "score" ? "scoreRule" : k] = e.target.value; save(); });
      });
    }
    on("#p-dark", "change", function (e) { p.darkLabel = e.target.checked; save(); U.toast("已" + (p.darkLabel ? "启用" : "关闭") + "暗标模式"); });
    on("#p-feed", "change", function (e) { p.feedImg = e.target.checked; save(); });
    onAll(".c-del", "click", function (e) { var i = +e.target.closest("[data-ci]").getAttribute("data-ci"); p.chapters.splice(i, 1); save(); renderPlan(); });
    onAll(".c-name", "input", function (e) { var i = +e.target.closest("[data-ci]").getAttribute("data-ci"); p.chapters[i].name = e.target.value; save(); });
    onAll(".c-len", "change", function (e) { var i = +e.target.closest("[data-ci]").getAttribute("data-ci"); p.chapters[i].length = e.target.value; save(); });
    on("#b-add-chap", "click", function () { ensureChapters(p); p.chapters.push({ name: "新章节", tip: "", length: "中", content: "" }); save(); renderPlan(); });
    on("#b-gen", "click", async function () {
      var tip = document.getElementById("gen-tip"); tip.textContent = "生成中…";
      await generatePlan(p, SYD.ai.ready());
      tip.textContent = SYD.ai.ready() ? "已用 AI 生成" : "已用离线模板生成（未配置AI）";
      renderPlan();
    });
    if (p.generated) {
      on("#b-export-md", "click", function () { U.download(p.name + "_技术方案.md", "# " + p.name + " 技术方案\n\n" + chaptersToText(p)); U.toast("已导出 Markdown"); });
      on("#b-export-txt", "click", function () { U.download(p.name + "_技术方案.txt", p.name + " 技术方案\n\n" + chaptersToText(p)); U.toast("已导出 TXT"); });
      on("#b-export-doc", "click", function () { U.downloadDoc(p.name + "_技术方案.doc", chaptersToDoc(p)); U.toast("已导出 Word"); });
      on("#b-export-docx", "click", function () { SYD.word.exportBid(p); });
    }
    on("#b-appendix", "click", function () { document.getElementById("appendix-out").innerHTML = appendixHTML(p); });
    onAll("[data-pick]", "click", function (e) { cur.pid = e.currentTarget.getAttribute("data-pick"); renderPlan(); });
  }
  function fld(label, id, val) { return "<div><label>" + label + "</label><input id='" + id + "' value='" + esc(val || "") + "'/></div>"; }
  function chaptersToText(p) {
    return ensureChapters(p).map(function (c, i) { return (i + 1) + ". " + c.name + "\n" + (c.content || "（未生成）") + "\n"; }).join("\n");
  }
  function appendixHTML(p) {
    var b = p.basics || {};
    var rows = [
      ["1", "方案设计", "合同签订后", "5 个工作日"],
      ["2", "设备生产与集成", "设计确认后", "30 个日历日"],
      ["3", "厂内联调与检测", "生产完成后", "7 个日历日"],
      ["4", "发货与现场安装", "通知发货后", "10 个日历日"],
      ["5", "验收与培训", "安装完成后", "3 个日历日"]
    ];
    var h = "<h4 style='margin:6px 0'>工期安排</h4><table class='tbl'><tr><th>序号</th><th>阶段</th><th>起始</th><th>周期</th></tr>";
    rows.forEach(function (r) { h += "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td><td>" + r[2] + "</td><td>" + r[3] + "</td></tr>"; });
    h += "</table>";
    h += "<h4 style='margin:12px 0 6px'>技术偏离表（模板）</h4><table class='tbl'><tr><th>序号</th><th>招标文件要求</th><th>投标响应</th><th>偏离</th></tr>";
    h += "<tr><td>1</td><td>（粘贴招标参数）</td><td>（填写投标参数）</td><td>无偏离</td></tr></table>";
    h += "<h4 style='margin:12px 0 6px'>培训计划</h4><table class='tbl'><tr><th>对象</th><th>内容</th><th>时长</th></tr><tr><td>操作工</td><td>设备操作与日常维护</td><td>1 天</td></tr><tr><td>技术员</td><td>原理与故障处理</td><td>0.5 天</td></tr></table>";
    h += "<div class='toolbar'><button class='btn-ghost btn-sm' id='b-apx-doc'>导出附表 Word</button></div>";
    setTimeout(function () { var btn = document.getElementById("b-apx-doc"); if (btn) btn.onclick = function () { U.downloadDoc(p.name + "_附表.doc", h); U.toast("已导出附表"); }; }, 0);
    return h;
  }

  // ================= 智能标书 =================
  function renderBid() {
    setView("智能标书");
    var ps = projects();
    if (!ps.length) { renderModuleEmpty("▣", "智能标书", "招标解读 / 技术标创作 / 商务标一键填空（结合企业资料库），与智能方案数据贯通", ["新建项目", "智能提取招标信息", "项目解读", "技术标创作", "商务标一键填空", "导出标书"]); return; }
    var p = curProject() || ps[0]; cur.pid = p.id;
    var b = p.basics || {};
    var html = "<div class='grid grid-2'>";
    // 项目解读
    html += "<div class='card'><div class='section-title'>项目信息解读</div><div class='section-sub'>大纲式 + 关键点</div>";
    html += "<div class='editor-out'>" + esc(
      "一、项目概况\n招标方：" + (b.buyer || p.buyer || "—") + "\n项目：" + (b.project || p.projectDesc || "—") +
      "\n预算/限价：" + (b.budget || "—") + "\n截止：" + (b.deadline || "—") + "\n评分办法：" + (b.scoreRule || "—") +
      "\n\n二、关键点\n· 资质门槛：" + (b.certs && b.certs.length ? b.certs.join("、") : "待补充") +
      "\n· 执行标准：" + (b.standards && b.standards.length ? b.standards.join("；") : D.standards.slice(0, 3).join("；")) +
      "\n· 商务要点：交货期、质保期、售后响应、培训"
    ) + "</div></div>";
    // 技术标
    html += "<div class='card'><div class='section-title'>技术标创作</div><div class='section-sub'>复用 智能方案引擎</div>";
    var imgsB = S.get().materials.images || [];
    var visNB = imgsB.filter(function (im) { return im.desc; }).length;
    html += "<div class='muted' style='font-size:12px'>已生成章节：" + ensureChapters(p).length + " 章" + (visNB ? " · 已融入图库理解 " + visNB + " 张" : "") + (p.darkLabel ? " · 暗标模式" : "") + "</div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-tech'>前往生成/编辑技术标</button><button class='btn-ghost btn-sm' id='b-bid-docx'>导出完整 Word 标书</button></div></div>";
    html += "</div>";

    html += "<div class='grid grid-2'>";
    // 商务标
    html += "<div class='card'><div class='section-title'>商业标智能填写</div><div class='section-sub'>结合企业资料库一键填空</div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-biz'>打开商务标填空</button></div></div>";
    // 报价
    html += "<div class='card'><div class='section-title'>智能报价</div><div class='section-sub'>成本测算 → 建议报价 → 审定填入</div>";
    html += "<div class='muted' style='font-size:12px'>" + (p.quote && p.quote.decided ? "已审定报价：" + p.quote.decided + " 元" : "尚未审定报价") + "</div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-quote'>打开报价模块</button></div></div>";
    html += "</div>";
    view.innerHTML = html;

    on("#b-tech", "click", function () { SYD.ui.render("plan"); });
    on("#b-biz", "click", function () { renderBizFill(p); });
    on("#b-quote", "click", function () { document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-view") === "quote"); }); SYD.ui.render("quote"); });
    on("#b-bid-docx", "click", function () { SYD.word.exportBid(p); });
  }

  function renderBizFill(p) {
    var c = S.get().materials.company || {};
    var html = "<div class='card'><div class='section-title'>商业标一键填空</div><div class='section-sub'>数据来自“企业素材-企业资料库”，未填处请先在设置/素材库补全</div>";
    html += "<table class='tbl'><tr><th>投标要素</th><th>填写值</th><th>来源</th></tr>";
    D.bidFillTemplate.forEach(function (t) {
      var v = c[t.k] || "";
      html += "<tr><td>" + t.f + "</td><td><input data-k='" + t.k + "' value='" + esc(v) + "'/></td><td>" + (v ? "资料库" : "缺") + "</td></tr>";
    });
    html += "</table>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-biz-save'>保存并回填资料库</button><button class='btn-ghost btn-sm' id='b-biz-doc'>导出商务标 Word</button></div>";
    html += "<div class='editor-out' id='biz-preview' style='margin-top:10px'></div></div>";
    view.innerHTML = html;
    onAll("[data-k]", "input", function (e) { if (!S.get().materials.company) S.get().materials.company = {}; S.get().materials.company[e.target.getAttribute("data-k")] = e.target.value; save(); });
    on("#b-biz-save", "click", function () { save(); U.toast("已回填企业资料库"); renderBizFill(p); });
    on("#b-biz-doc", "click", function () {
      var rows = D.bidFillTemplate.map(function (t) { var v = (S.get().materials.company || {})[t.k] || "（待填）"; return "<tr><td>" + t.f + "</td><td>" + esc(v) + "</td></tr>"; }).join("");
      var doc = "<h2 style='text-align:center'>" + esc(p.name) + " 商务标投标函附表</h2><table border='1' cellpadding='6'><tr><th>投标要素</th><th>填写值</th></tr>" + rows + "</table>";
      U.downloadDoc(p.name + "_商务标.doc", doc); U.toast("已导出商务标");
    });
    // 预览
    var prev = D.bidFillTemplate.map(function (t) { var v = (S.get().materials.company || {})[t.k] || "（待填）"; return t.f + "：" + v; }).join("\n");
    var pe = document.getElementById("biz-preview"); if (pe) pe.textContent = prev;
  }

  // ================= 智能报价 =================
  function ensureQuote(p) {
    if (!p.quote) {
      var def = {}; D.quoteCostCats.forEach(function (c) { def[c.k] = c.def; });
      var limit = "";
      if (p.basics && p.basics.budget) { var mm = p.basics.budget.match(/[0-9]+(?:\.[0-9]+)?/); if (mm) limit = mm[0]; }
      p.quote = { cost: def, margin: D.quoteMarginDefault, limit: limit, suggested: null, breakdown: [], decided: null, note: "", status: "" };
    }
    return p.quote;
  }

  function renderQuote() {
    setView("智能报价");
    var ps = projects();
    if (!ps.length) { renderModuleEmpty("¥", "智能报价", "成本测算 → AI 建议报价 → 你审定后填入 → 贯通商务标与导出（AI 只建议，定价权在你）", ["新建项目", "录入成本构成", "AI 建议报价", "审定并填入", "贯通商务标", "导出报价单"]); return; }
    var p = curProject() || ps[0]; cur.pid = p.id;
    var q = ensureQuote(p);
    var b = p.basics || {};

    var html = "<div class='grid' style='grid-template-columns:1fr 1fr'>";
    // 左：成本录入
    html += "<div class='card'><div class='section-title'>① 成本构成录入</div><div class='section-sub'>单位：人民币元（工业产品类投标）</div>";
    html += "<div class='grid grid-2'>";
    D.quoteCostCats.forEach(function (c) {
      html += "<div><label>" + c.label + "</label><input type='number' min='0' id='qc-" + c.k + "' value='" + (q.cost[c.k] != null ? q.cost[c.k] : c.def) + "'/></div>";
    });
    html += "</div>";
    html += "<div class='grid grid-2' style='margin-top:6px'>";
    html += "<div><label>期望毛利率(%)</label><input type='number' min='0' max='100' id='qc-margin' value='" + q.margin + "'/></div>";
    html += "<div><label>招标限价(元)</label><input type='number' min='0' id='qc-limit' value='" + (q.limit != null ? q.limit : "") + "' placeholder='无可留空'/></div>";
    html += "</div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-q-ai'>AI 建议报价</button><button class='btn-ghost btn-sm' id='b-q-off'>离线测算</button><span class='muted' id='q-tip' style='font-size:12px'></span></div>";
    html += "</div>";

    // 右：建议与审定
    html += "<div class='card'><div class='section-title'>② 建议报价与审定</div>";
    if (q.suggested != null) {
      html += "<div class='quote-hero'><div><div class='muted' style='font-size:12px'>建议报价</div><div class='big'>" + q.suggested + " <small>元</small></div></div>" +
        "<div class='muted' style='text-align:right'>" + (q.status === "ai" ? "来源：AI 大模型" : "来源：离线成本测算") + (q.capped ? " · 已按限价封顶" : "") + "</div></div>";
      html += "<ul class='breakdown'>";
      (q.breakdown || []).forEach(function (bd) { html += "<li><span>" + esc(bd.name) + "</span><span>" + bd.amount + " 元</span></li>"; });
      html += "</ul>";
      if (q.note) html += "<div class='muted' style='font-size:12px;margin-top:8px'>" + esc(q.note) + "</div>";
    } else {
      html += "<div class='empty'>点击左侧“AI 建议报价”或“离线测算”生成建议</div>";
    }
    html += "<hr class='sep'/>";
    html += "<label>审定报价（人民币元）</label><input type='number' min='0' id='qc-decided' value='" + (q.decided != null ? q.decided : (q.suggested != null ? q.suggested : "")) + "'/>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-q-save'>审定并保存</button><button class='btn-ghost btn-sm' id='b-q-docx'>导出含报价 Word 标书</button></div>";
    html += "</div>";
    html += "</div>";

    // 说明
    html += "<div class='card'><div class='section-title'>报价流程说明</div><div class='section-sub'>AI 先出建议价 → 用户结合商务策略审定 → 回填项目，自动进入商务标与完整标书导出</div>";
    html += "<div class='muted' style='font-size:12.5px;line-height:1.8'>· 招标方：" + (b.buyer || p.buyer || "—") + "；预算/限价：" + (b.budget || "—") + "<br/>· AI 建议价由成本+毛利率测算，并结合招标限价给出封顶提示；审定后不可在标书中随意改动，需留痕。<br/>· 审定值将出现在“智能标书 → 商务标”与“导出完整 Word 标书”的报价章节。</div></div>";
    view.innerHTML = html;

    // 事件
    D.quoteCostCats.forEach(function (c) { on("#qc-" + c.k, "input", function (e) { q.cost[c.k] = +e.target.value || 0; save(); }); });
    on("#qc-margin", "input", function (e) { q.margin = +e.target.value || 0; save(); });
    on("#qc-limit", "input", function (e) { q.limit = e.target.value; save(); });
    on("#b-q-off", "click", function () {
      var r = SYD.ai.quoteComputeOffline(q.cost, q.margin, q.limit);
      q.suggested = r.suggested; q.breakdown = r.breakdown; q.note = r.note; q.capped = r.capped; q.status = "offline"; q.decided = q.decided != null ? q.decided : r.decided;
      save(); document.getElementById("q-tip").textContent = "已离线测算"; renderQuote();
    });
    on("#b-q-ai", "click", async function () {
      var tip = document.getElementById("q-tip"); tip.textContent = "AI 计算中…";
      var ctx = "招标方：" + (b.buyer || p.buyer || "无") + "；项目：" + (b.project || p.projectDesc || "无") +
        "；成本构成(元)：设备材料 " + q.cost.material + "、人工 " + q.cost.labor + "、制造 " + q.cost.mfg + "、运费 " + q.cost.freight + "、管理税费 " + q.cost.mgmt +
        "；期望毛利率 " + q.margin + "%；招标限价 " + (q.limit || "无") + "。";
      var sys = "你是资深工业设备投标报价专家，熟悉冶金焦化行业商务策略。只输出 JSON：{\"suggested\":建议总价(数字),\"breakdown\":[{\"name\":\"项\",\"amount\":金额}],\"note\":\"一句话理由\"}。不要解释。";
      try {
        var r = await SYD.ai.chat(sys, "请基于以下信息给出建议报价：" + ctx);
        var m = (r || "").match(/\{[\s\S]*\}/);
        if (m) {
          var j = JSON.parse(m[0]);
          q.suggested = +j.suggested || 0; q.breakdown = j.breakdown || []; q.note = j.note || ""; q.status = "ai";
          if (q.limit && +q.limit > 0 && q.suggested > +q.limit) { q.capped = true; q.note += "（超出限价 " + q.limit + " 元，建议封顶）"; }
          q.decided = q.decided != null ? q.decided : q.suggested;
        } else throw new Error("未返回可解析 JSON");
      } catch (e) {
        var off = SYD.ai.quoteComputeOffline(q.cost, q.margin, q.limit);
        q.suggested = off.suggested; q.breakdown = off.breakdown; q.note = off.note + "（AI 解析失败，已用离线兜底：" + e.message + "）"; q.capped = off.capped; q.status = "offline";
        q.decided = q.decided != null ? q.decided : off.decided;
      }
      save(); tip.textContent = q.status === "ai" ? "AI 已给出建议" : "离线兜底完成"; renderQuote();
    });
    on("#b-q-save", "click", function () {
      var d = +document.getElementById("qc-decided").value || 0;
      if (!d) { U.toast("请填写审定报价"); return; }
      q.decided = d; save(); U.toast("已审定报价：" + d + " 元，已进入标书与导出"); renderQuote();
    });
    on("#b-q-docx", "click", function () { SYD.word.exportBid(p); });
  }

  // ================= 智能质检 =================
  function renderQC() {
    setView("智能质检");
    var ps = projects();
    if (!ps.length) { renderModuleEmpty("✔", "智能质检", "招标文件解析 → 质检项抽取 → 多版本对比 → 自定义配置，可视化报告", ["新建项目", "解析招标文件", "抽取质检项", "逐项核查", "多版本对比", "可视化报告"]); return; }
    var p = curProject() || ps[0]; cur.pid = p.id;
    if (!p.qc) p.qc = { items: [], versions: [] };

    var html = "<div class='card'><div class='section-title'>① 招标文件解析 → 质检项抽取</div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-parse'>解析当前招标文件并生成质检项</button><span class='muted' id='qc-tip' style='font-size:12px'></span></div>";
    html += "<div id='qc-items'>";
    if (p.qc.items.length) html += qcItemsHTML(p); else html += "<div class='empty'>尚未生成质检项</div>";
    html += "</div></div>";

    html += "<div class='card'><div class='section-title'>② 投标文件质检与报告</div>";
    html += "<label>上传/粘贴投标文件正文</label><textarea id='qc-text' rows='5' placeholder='粘贴已撰写的投标正文，系统比对质检项并标记缺漏/偏差'></textarea>";
    html += "<div class='toolbar'><button class='btn-ghost btn-sm' id='b-check'>执行质检</button><button class='btn-ghost btn-sm' id='b-savever'>保存本版本质检快照</button><button class='btn-ghost btn-sm' id='b-report'>导出质检报告</button></div>";
    html += "<div id='qc-result'></div></div>";

    html += "<div class='card'><div class='section-title'>③ 多版本对比追踪</div><div id='qc-versions'></div></div>";

    html += "<div class='card'><div class='section-title'>④ 自定义质检项</div>";
    html += "<div class='row'><input id='qc-new' placeholder='新增质检项描述'/><button class='btn-ghost btn-sm' id='b-addqc'>添加</button></div></div>";
    view.innerHTML = html;

    on("#b-parse", "click", function () {
      if (!p.rawText) { U.toast("请先在 智能方案上传招标文件原文"); return; }
      var items = [];
      D.qcKeywords.forEach(function (q) {
        if (p.rawText.indexOf(q.kw) >= 0) items.push({ id: U.uid(), label: q.label, cat: q.cat, status: "", note: "" });
      });
      // 自定义模板
      S.get().qcTemplates.forEach(function (t) { items.push({ id: U.uid(), label: t, cat: "自定义", status: "", note: "" }); });
      if (!items.length) items.push({ id: U.uid(), label: "通用完整性检查", cat: "合规", status: "", note: "" });
      p.qc.items = items; save();
      document.getElementById("qc-tip").textContent = "已生成 " + items.length + " 项";
      document.getElementById("qc-items").innerHTML = qcItemsHTML(p); bindQCItems(p);
    });
    on("#b-addqc", "click", function () {
      var v = document.getElementById("qc-new").value.trim(); if (!v) return;
      p.qc.items.push({ id: U.uid(), label: v, cat: "自定义", status: "", note: "" }); save();
      document.getElementById("qc-items").innerHTML = qcItemsHTML(p); bindQCItems(p); document.getElementById("qc-new").value = "";
    });
    on("#b-check", "click", function () {
      var txt = document.getElementById("qc-text").value || "";
      var done = 0, miss = 0;
      p.qc.items.forEach(function (it) {
        if (it.status === "ok") done++; else if (it.status === "miss") miss++;
      });
      // 自动初判：未标记项按正文是否包含关键词粗判
      var auto = 0;
      p.qc.items.forEach(function (it) {
        if (!it.status) {
          var hit = txt.indexOf(it.label) >= 0 || (it.note && txt.indexOf(it.note) >= 0);
          if (hit) { it._auto = "疑似覆盖"; auto++; } else { it._auto = "未检出"; }
        }
      });
      var total = p.qc.items.length;
      var rate = total ? Math.round((done / total) * 100) : 0;
      var cls = rate >= 90 ? "ok" : rate >= 70 ? "warn" : "bad";
      var h = "<div class='row spread' style='margin:10px 0'><div>合格率（已确认）：<b style='color:var(--ok)'>" + rate + "%</b></div><div class='bar " + cls + "' style='flex:1;margin-left:12px'><i style='width:" + rate + "%'></i></div></div>";
      h += "<div class='muted' style='font-size:12px'>自动初判：覆盖 " + auto + " 项，未检出 " + (total - done - auto) + " 项；请逐条确认状态。</div>";
      document.getElementById("qc-result").innerHTML = h;
      U.toast("质检完成，请确认各项状态");
    });
    on("#b-savever", "click", function () {
      var snap = { date: U.fmtDate(), items: p.qc.items.map(function (i) { return { label: i.label, status: i.status, note: i.note }; }) };
      p.qc.versions.push(snap); save();
      renderQC(); U.toast("已保存版本快照");
    });
    on("#b-report", "click", function () {
      var rows = p.qc.items.map(function (i, n) { return "<tr><td>" + (n + 1) + "</td><td>" + esc(i.label) + "</td><td>" + (i.status === "ok" ? "符合" : i.status === "miss" ? "缺漏/偏差" : "待确认") + "</td><td>" + esc(i.note || "") + "</td></tr>"; }).join("");
      var doc = "<h2 style='text-align:center'>" + esc(p.name) + " 投标质检报告</h2><table border='1' cellpadding='6'><tr><th>序号</th><th>质检项</th><th>结论</th><th>说明</th></tr>" + rows + "</table>";
      U.downloadDoc(p.name + "_质检报告.doc", doc); U.toast("已导出质检报告");
    });
    bindQCItems(p);
    renderVersions(p);
  }
  function qcItemsHTML(p) {
    var h = "";
    p.qc.items.forEach(function (it) {
      h += "<div class='checkrow' data-qid='" + it.id + "'><div class='ctext'><b>" + esc(it.label) + "</b> <span class='tag gray'>" + esc(it.cat) + "</span>" +
        (it._auto ? " <span class='muted' style='font-size:11px'>[" + it._auto + "]</span>" : "") +
        "<div style='margin-top:4px'><input class='q-note' placeholder='偏差说明/备注' value='" + esc(it.note || "") + "' style='max-width:70%'/></div></div>" +
        "<div class='row'><label class='pill'><input type='radio' name='st_" + it.id + "' value='ok' " + (it.status === "ok" ? "checked" : "") + " style='width:auto'/>符合</label>" +
        "<label class='pill'><input type='radio' name='st_" + it.id + "' value='miss' " + (it.status === "miss" ? "checked" : "") + " style='width:auto'/>缺漏</label></div></div>";
    });
    return h;
  }
  function bindQCItems(p) {
    onAll("[data-qid] input.q-note", "input", function (e) {
      var id = e.target.closest("[data-qid]").getAttribute("data-qid");
      var it = p.qc.items.filter(function (x) { return x.id === id; })[0]; if (it) it.note = e.target.value; save();
    });
    onAll("[data-qid] input[type=radio]", "change", function (e) {
      var id = e.target.closest("[data-qid]").getAttribute("data-qid");
      var it = p.qc.items.filter(function (x) { return x.id === id; })[0]; if (it) { it.status = e.target.value; it._auto = ""; save(); }
    });
  }
  function renderVersions(p) {
    var box = document.getElementById("qc-versions"); if (!box) return;
    if (!p.qc.versions.length) { box.innerHTML = "<div class='empty'>暂无版本快照</div>"; return; }
    var h = "<div class='list'>";
    p.qc.versions.forEach(function (v, i) {
      var ok = v.items.filter(function (x) { return x.status === "ok"; }).length;
      h += "<div class='item'><div>版本 " + (i + 1) + " · " + esc(v.date) + " · 符合 " + ok + "/" + v.items.length + "</div><span class='tag gray'>历史</span></div>";
    });
    h += "</div>"; box.innerHTML = h;
  }

  // ================= 方案查重 =================
  function renderDup() {
    setView("方案查重");
    var html = "<div class='card'><div class='section-title'>文本相似度比对（规避串标风险）</div><div class='section-sub'>基于字符二元组余弦 + 3-gram Jaccard；结果仅供参考，语义级需接 AI</div>";
    html += "<div class='grid grid-2'><div><label>方案 A</label><textarea id='d-a' rows='10' placeholder='粘贴第一份方案/标书正文'></textarea></div>";
    html += "<div><label>方案 B</label><textarea id='d-b' rows='10' placeholder='粘贴第二份方案/标书正文（或企业知识库文档）'></textarea></div></div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-dup'>开始比对</button><span id='dup-tip' class='muted' style='font-size:12px'></span></div>";
    html += "<div id='dup-out'></div></div>";
    view.innerHTML = html;
    on("#b-dup", "click", function () {
      var a = document.getElementById("d-a").value, b = document.getElementById("d-b").value;
      if (!a || !b) { U.toast("请粘贴两份文本"); return; }
      var r = similarity(a, b);
      var cls = r.cosine >= 0.6 ? "bad" : r.cosine >= 0.3 ? "warn" : "ok";
      var h = "<div class='row spread' style='margin:10px 0'><div>相似度：<b style='color:var(--" + (cls === "bad" ? "bad" : cls === "warn" ? "warn" : "ok") + ")'>" + Math.round(r.cosine * 100) + "%</b> （Jaccard " + Math.round(r.jac * 100) + "%）</div>";
      h += "<div class='bar " + cls + "' style='flex:1;margin-left:12px'><i style='width:" + Math.round(r.cosine * 100) + "%'></i></div></div>";
      h += "<div class='muted' style='font-size:12px'>高频共现片段（疑似雷同）：</div><div class='editor-out' style='max-height:200px'>" + (r.common.length ? esc(r.common.join("\n")) : "未检出明显共现片段") + "</div>";
      document.getElementById("dup-out").innerHTML = h;
    });
  }
  function tokens(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function bigrams(s) { s = tokens(s); var g = {}; for (var i = 0; i < s.length - 1; i++) { var k = s.slice(i, i + 2); g[k] = (g[k] || 0) + 1; } return g; }
  function cosine(a, b) { var ga = bigrams(a), gb = bigrams(b), dot = 0, na = 0, nb = 0; for (var k in ga) na += ga[k] * ga[k]; for (var k in gb) nb += gb[k] * gb[k]; for (var k in ga) if (gb[k]) dot += ga[k] * gb[k]; if (!na || !nb) return 0; return dot / (Math.sqrt(na) * Math.sqrt(nb)); }
  function shingles(s, k) { s = tokens(s); var set = {}; for (var i = 0; i + k <= s.length; i++) set[s.slice(i, i + k)] = 1; return set; }
  function jaccard(a, b) { var sa = shingles(a, 6), sb = shingles(b, 6), inter = 0, uni = 0; for (var k in sa) { uni++; if (sb[k]) inter++; } for (var k in sb) if (!sa[k]) uni++; return uni ? inter / uni : 0; }
  function commonPhrases(a, b) { var sa = shingles(a, 8), sb = shingles(b, 8), out = []; for (var k in sa) if (sb[k]) out.push(k); return out.slice(0, 30); }
  function similarity(a, b) { return { cosine: cosine(a, b), jac: jaccard(a, b), common: commonPhrases(a, b) }; }

  // ================= 企业素材 =================
  function renderLib() {
    setView("企业素材");
    var m = S.get().materials;
    var pendingKBFile = null; // 记录“单文件自动识别后待用户确认添加”的文件引用
    var pendingKBDone = true;  // 单文件正文提取是否已完成
    var pendingKBErr = null;   // 单文件正文提取失败原因（用于提示，但不阻塞入库）
    var IMG_EXT = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "mp4", "mov", "avi", "mkv", "mp3", "wav", "m4a"];
    function metaOf(f, a) { return { name: f.name, type: a.type, date: a.date, code: a.code, info: a.info, size: f.size || 0 }; }
    // 多选批量入库：文字类自动提取正文+自动命名+自动附件信息；图片/音视频提示去图库
    function batchAddKB(files, cb) {
      var arr = Array.prototype.slice.call(files);
      var pending = arr.length, ok = 0, skipped = [];
      if (!pending) { cb(0, 0); return; }
      arr.forEach(function (f) {
        var ext = (f.name.split(".").pop() || "").toLowerCase();
        if (IMG_EXT.indexOf(ext) >= 0) { skipped.push(f.name); pending--; if (!pending) cb(ok, skipped.length); return; }
        extractDocText(f).then(function (res) {
          var a = analyzeFileName(f.name);
          m.knowledge.push({ id: U.uid(), title: a.title, text: res.text, meta: metaOf(f, a), locked: isOriginalType(a.type) });
        }).catch(function () {
          var a = analyzeFileName(f.name);
          m.knowledge.push({ id: U.uid(), title: a.title, text: "", meta: metaOf(f, a), locked: isOriginalType(a.type) });
        }).then(function () {
          ok++; pending--; if (!pending) { save(); cb(ok, skipped.length); }
        });
      });
    }
    var html = "<div class='grid grid-3'>";
    // 知识库
    html += "<div class='card'><div class='section-title'>知识库（RAG 私有素材）</div><div class='section-sub'>上传高质量资料，方案生成时智能检索引用</div>";
    html += "<div class='row'><input id='kb-title' placeholder='文档标题（选文件后自动识别命名，可修改）'/><input id='kb-file' type='file' multiple accept='" + ACCEPT_DOCS + "' style='width:auto'/></div>";
    html += "<textarea id='kb-text' rows='4' placeholder='粘贴正文，或选文件自动提取（均可修改）'></textarea>";
    html += "<div class='muted' id='kb-auto' style='font-size:12px;min-height:16px'></div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-kb-add'>添加到知识库</button><input id='kb-search' placeholder='检索' style='max-width:140px'/><button class='btn-ghost btn-sm' id='b-kb-search'>检索</button></div>";
    html += "<div id='kb-list'></div></div>";
    // 私人图库
    html += "<div class='card'><div class='section-title'>私人图库（视觉理解）</div><div class='section-sub'>上传产品图/现场图；启用 AI 后可一键视觉理解，自动标注描述与标签</div>";
    html += "<div class='toolbar'><input type='file' id='img-file' multiple accept='image/*' style='width:auto'/><button class='btn-primary btn-sm' id='b-img-add'>上传</button><button class='btn-ghost btn-sm' id='b-img-vis'>AI 视觉理解（全部）</button><span class='muted' id='img-vis-tip' style='font-size:12px'></span></div>";
    html += "<div class='img-grid' id='img-list'></div></div>";
    // 企业资料库
    html += "<div class='card'><div class='section-title'>企业资料库（商务标填空底座）</div>";
    var c = m.company || {};
    ["name:投标人名称", "credit:统一社会信用代码", "legal:法定代表人", "addr:注册地址", "phone:联系电话", "bank:开户银行", "account:银行账号", "product:主营投标产品", "lead:交货期", "warranty:质保期"].forEach(function (pair) {
      var kv = pair.split(":"); html += fld(kv[1], "co-" + kv[0], c[kv[0]] || "");
    });
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-co-save'>保存企业资料</button></div></div>";
    // 标书取用包（资质即取即用）
    html += "<div class='card'><div class='section-title'>标书取用包（资质即取即用）</div><div class='section-sub'>勾选本次投标需提交的资质/证书/资料，一键生成取用清单，投标时按清单逐项调取原件</div>";
    html += "<div id='pick-list' class='list'></div>";
    html += "<div class='toolbar'><button class='btn-ghost btn-sm' id='pick-all'>全选原件</button><button class='btn-primary btn-sm' id='pick-gen'>生成取用包清单</button></div>";
    html += "<div id='pick-result' class='editor-out' style='white-space:pre-wrap;min-height:60px;font-size:13px;margin-top:8px'>生成后此处显示取用清单（含类型分组、日期、编号、原件只读标记）。</div>";
    html += "<div class='toolbar' id='pick-actions' style='display:none'><button class='btn-ghost btn-sm' id='pick-print'>打印</button><button class='btn-ghost btn-sm' id='pick-doc'>导出Word</button></div></div>";
    html += "</div>";
    view.innerHTML = html;

    function renderKB(list) {
      list = list || m.knowledge;
      var h = "<div class='list'>";
      list.forEach(function (d) {
        var info = (d.meta && d.meta.info) ? esc(d.meta.info) : "";
        var lockBadge = d.locked ? "<span class='kb-lock-badge'>🔒 原件只读</span>" : "";
        var actions = d.locked
          ? "<div class='item-actions'><button class='btn-ghost btn-sm kb-view' data-id='" + d.id + "'>预览</button><button class='btn-ghost btn-sm kb-print' data-id='" + d.id + "'>打印</button><button class='btn-ghost btn-sm kb-unlock' data-id='" + d.id + "'>解锁</button><button class='btn-danger btn-sm kb-del' data-id='" + d.id + "'>删</button></div>"
          : "<div class='item-actions'><button class='btn-ghost btn-sm kb-view' data-id='" + d.id + "'>预览/编辑</button><button class='btn-ghost btn-sm kb-print' data-id='" + d.id + "'>打印</button><button class='btn-danger btn-sm kb-del' data-id='" + d.id + "'>删</button></div>";
        h += "<div class='item'><div style='font-size:13px'><b>" + esc(d.title) + "</b> " + lockBadge + "<div class='muted' style='font-size:11px'>" + (info ? info + " · " : "") + esc(d.text.slice(0, 40)) + (d.text.length > 40 ? "…" : "") + "</div></div>" + actions + "</div>";
      });
      h += "</div>"; if (!list.length) h = "<div class='empty'>暂无文档</div>";
      document.getElementById("kb-list").innerHTML = h;
      onAll(".kb-del", "click", function (e) { m.knowledge = m.knowledge.filter(function (x) { return x.id !== e.target.getAttribute("data-id"); }); save(); renderKB(); });
      onAll(".kb-view", "click", function (e) {
        var d = m.knowledge.filter(function (x) { return x.id === e.target.getAttribute("data-id"); })[0]; if (!d) return;
        openAttachmentViewer({ kind: "doc", title: d.title, text: d.text, meta: d.meta, readonly: !!d.locked, onSave: function (nt, ntx) { d.title = nt; d.text = ntx; save(); renderKB(); } });
      });
      onAll(".kb-print", "click", function (e) {
        var d = m.knowledge.filter(function (x) { return x.id === e.target.getAttribute("data-id"); })[0]; if (!d) return;
        printAttachment({ kind: "doc", title: d.title, text: d.text, meta: d.meta });
      });
      onAll(".kb-unlock", "click", function (e) {
        var d = m.knowledge.filter(function (x) { return x.id === e.target.getAttribute("data-id"); })[0]; if (!d) return;
        d.locked = false; save(); renderKB();
        U.toast("已解锁，可编辑（再次点「预览/编辑」即可修改）");
      });
    }
    renderKB();
    on("#kb-file", "change", function (e) {
      var files = e.target.files;
      if (!files || !files.length) return;
      if (files.length > 1) {
        batchAddKB(files, function (n, sk) {
          renderKB();
          U.toast("已批量添加 " + n + " 个文档（标题/附件信息已自动识别）" + (sk ? "；" + sk + " 个图片/音视频已跳过（请到私人图库）" : ""));
          document.getElementById("kb-file").value = "";
          document.getElementById("kb-auto").textContent = "";
        });
        return;
      }
      // 单文件：自动识别命名+正文填入文本框，供用户修改后点添加
      var f = files[0]; pendingKBFile = f; pendingKBDone = false; pendingKBErr = null;
      var a = analyzeFileName(f.name);
      var titleEl = document.getElementById("kb-title"), textEl = document.getElementById("kb-text");
      if (!titleEl.value.trim()) titleEl.value = a.title;
      var tip = document.getElementById("kb-auto");
      extractDocText(f).then(function (res) {
        pendingKBDone = true;
        if (!textEl.value.trim()) textEl.value = res.text || "";
        tip.textContent = "已自动识别：" + (a.info || a.title) + "（可修改后点「添加到知识库」）";
      }).catch(function (err) {
        pendingKBDone = true; pendingKBErr = err;
        tip.textContent = "已自动识别标题：" + a.title + (err && err.noExtract ? "；该格式暂不能自动提取正文，可手工粘贴，或直接点「添加到知识库」保存标题与附件信息" : "（可手工粘贴正文）");
      });
    });
    on("#b-kb-add", "click", function () {
      var title = document.getElementById("kb-title").value.trim();
      var text = document.getElementById("kb-text").value.trim();
      var f = document.getElementById("kb-file").files[0];
      function done(t, meta, extraMsg) {
        m.knowledge.push({ id: U.uid(), title: title || (f ? f.name : "未命名文档"), text: t, meta: meta || null, locked: !!(meta && isOriginalType(meta.type)) });
        save(); renderKB();
        document.getElementById("kb-title").value = "";
        document.getElementById("kb-text").value = "";
        document.getElementById("kb-file").value = "";
        document.getElementById("kb-auto").textContent = "";
        pendingKBFile = null;
        U.toast("已添加" + (extraMsg ? "（" + extraMsg + "）" : ""));
      }
      if (f && pendingKBFile === f) {
        var a = analyzeFileName(f.name);
        if (!text && !pendingKBDone) {
          // 正文提取尚未完成，稍候再决定（避免漏掉已抽出的正文）
          U.toast("正在识别正文，请稍候…");
          extractDocText(f).then(function (res) { done(res.text || "", metaOf(f, a), res.text ? "" : "（正文为空，可手工补）"); })
            .catch(function () { done("", metaOf(f, a), "（该格式无法自动提取正文，已保存标题与附件信息）"); });
          return;
        }
        // 提取完成（成功或失败都照常入库：失败则保存标题+附件信息，正文留空可手填）
        done(text, metaOf(f, a), pendingKBErr ? "（该格式无法自动提取正文，已保存标题与附件信息，可手工补正文）" : "");
        return;
      }
      if (!title || !text) { U.toast("请填写标题与正文，或选择文件自动识别"); return; }
      done(text, null);
    });
    on("#b-kb-search", "click", function () { var q = document.getElementById("kb-search").value.trim(); if (!q) return renderKB(); renderKB(m.knowledge.filter(function (d) { return (d.title + d.text).indexOf(q) >= 0; })); });
    on("#b-img-add", "click", function () {
      var files = document.getElementById("img-file").files;
      if (!files || !files.length) return;
      var arr = Array.prototype.slice.call(files), done = 0, ok = 0;
      function finalize() {
        if (done === arr.length) {
          renderImgs();
          U.toast("已上传 " + ok + " 张（文件名已自动识别为描述，可手动修改）");
          document.getElementById("img-file").value = "";
        }
      }
      arr.forEach(function (f) {
        if (f.size > 1.5 * 1024 * 1024) { U.toast("图片过大（>1.5MB）已跳过：" + f.name); done++; finalize(); return; }
        var r = new FileReader();
        r.onload = function () {
          var a = analyzeFileName(f.name);
          var im = { id: U.uid(), src: r.result, name: f.name, desc: a.title, tags: [], locked: isOriginalType(a.type) };
          m.images.push(im); save();
          if (SYD.ai.readyVision()) visionOne(im);
          ok++; done++; finalize();
        };
        r.onerror = function () { done++; finalize(); };
        r.readAsDataURL(f);
      });
    });
    async function visionOne(im) {
      try {
        var r = await SYD.ai.vision("你是工业设备投标素材标注专家，服务于冶金焦化行业。",
          "请用中文描述这张图片中的设备外观、结构或场景，并在末尾另起一行以『标签：』开头列出 3-5 个中文标签，用顿号分隔。", im.src);
        var desc = (r || "").trim();
        var mt = desc.match(/标签[：:]\s*(.+)$/m);
        var tags = [];
        if (mt) { tags = mt[1].split(/[、,，\s]+/).filter(Boolean).slice(0, 6); desc = desc.replace(/标签[：:].*$/m, "").trim(); }
        im.desc = desc; im.tags = tags; save();
      } catch (e) { im.desc = "（理解失败：" + e.message + "）"; save(); }
    }
    on("#b-img-vis", "click", async function () {
      if (!SYD.ai.readyVision()) { U.toast("请先在设置启用 AI（视觉理解需多模态模型）"); return; }
      var tip = document.getElementById("img-vis-tip");
      if (!m.images.length) { U.toast("请先上传图片"); return; }
      tip.textContent = "视觉理解中…(" + m.images.length + " 张)";
      for (var i = 0; i < m.images.length; i++) { await visionOne(m.images[i]); }
      tip.textContent = "已完成视觉理解"; renderImgs(); U.toast("视觉理解完成");
    });
    function renderImgs() {
      var box = document.getElementById("img-list"); var h = "";
      m.images.forEach(function (im) {
        h += "<div class='img-tile' data-id='" + im.id + "'>";
        if (im.desc) h += "<span class='vis-badge'>已理解</span>";
        if (im.locked) h += "<span class='kb-lock-badge'>🔒 原件只读</span>";
        h += "<img src='" + im.src + "'/>";
        h += "<input class='img-desc-edit' value='" + esc(im.desc || im.name) + "' data-id='" + im.id + "' style='width:100%;font-size:12px;margin-top:4px' placeholder='图片描述（可修改）'/>";
        if (im.tags && im.tags.length) h += "<div class='img-tags'>" + im.tags.map(function (t) { return "<span class='img-tag'>" + esc(t) + "</span>"; }).join("") + "</div>";
        if (im.locked) {
          h += "<div class='img-actions'><button class='btn-ghost btn-sm img-view' data-id='" + im.id + "'>预览</button><button class='btn-ghost btn-sm img-print' data-id='" + im.id + "'>打印</button><button class='btn-ghost btn-sm img-unlock' data-id='" + im.id + "'>解锁</button><button class='btn-danger btn-sm img-del' data-id='" + im.id + "'>删除</button></div></div>";
        } else {
          h += "<div class='img-actions'><button class='btn-ghost btn-sm img-view' data-id='" + im.id + "'>预览</button><button class='btn-ghost btn-sm img-print' data-id='" + im.id + "'>打印</button><button class='btn-danger btn-sm img-del' data-id='" + im.id + "'>删除</button></div></div>";
        }
      });
      box.innerHTML = h || "<span class='muted'>暂无图片</span>";
      onAll(".img-del", "click", function (e) { m.images = m.images.filter(function (x) { return x.id !== e.target.getAttribute("data-id"); }); save(); renderImgs(); });
      onAll(".img-view", "click", function (e) {
        var im = m.images.filter(function (x) { return x.id === e.target.getAttribute("data-id"); })[0]; if (!im) return;
        openAttachmentViewer({ kind: "image", title: im.name, text: im.desc, src: im.src, meta: { name: im.name }, readonly: !!im.locked, onSave: function (nt, nd) { im.name = nt; im.desc = nd; save(); renderImgs(); } });
      });
      onAll(".img-unlock", "click", function (e) {
        var im = m.images.filter(function (x) { return x.id === e.target.getAttribute("data-id"); })[0]; if (!im) return;
        im.locked = false; save(); renderImgs();
        U.toast("已解锁，可编辑");
      });
      onAll(".img-print", "click", function (e) {
        var im = m.images.filter(function (x) { return x.id === e.target.getAttribute("data-id"); })[0]; if (!im) return;
        printAttachment({ kind: "image", title: im.name, text: im.desc, src: im.src, meta: { name: im.name } });
      });
      onAll(".img-desc-edit", "input", function (e) {
        var id = e.target.getAttribute("data-id");
        var im = m.images.filter(function (x) { return x.id === id; })[0];
        if (im) { im.desc = e.target.value; save(); }
      });
    }
    renderImgs();
    on("#b-co-save", "click", function () {
      var co = {}; ["name", "credit", "legal", "addr", "phone", "bank", "account", "product", "lead", "warranty"].forEach(function (k) { co[k] = document.getElementById("co-" + k).value.trim(); });
      m.company = co; save(); U.toast("企业资料已保存，可用于商务标填空");
    });

    // 标书取用包（资质即取即用）
    function renderPick() {
      var box = document.getElementById("pick-list"); if (!box) return;
      var list = m.knowledge || [];
      if (!list.length) { box.innerHTML = "<div class='empty'>知识库暂无可取用素材，请先上传资质/证书</div>"; return; }
      box.innerHTML = "<div class='list'>" + list.map(function (d) {
        var t = (d.meta && d.meta.type) || "其他";
        var info = (d.meta && d.meta.info) ? esc(d.meta.info) : "";
        return "<div class='item'><label style='display:flex;gap:8px;align-items:flex-start;font-size:13px'><input type='checkbox' class='pick-cb' data-id='" + d.id + "' " + (d.locked ? "checked" : "") + " style='margin-top:3px'/><span><b>" + esc(d.title) + "</b> " + (d.locked ? "<span class='kb-lock-badge'>🔒 原件只读</span>" : "") + "<div class='muted' style='font-size:11px'>" + esc(t) + (info ? " · " + info : "") + "</div></span></label></div>";
      }).join("") + "</div>";
    }
    renderPick();
    var pickText = "";
    on("#pick-all", "click", function () {
      view.querySelectorAll(".pick-cb").forEach(function (cb) {
        var d = m.knowledge.filter(function (x) { return x.id === cb.getAttribute("data-id"); })[0];
        cb.checked = !!(d && d.locked);
      });
      U.toast("已勾选全部原件类素材");
    });
    on("#pick-gen", "click", function () {
      var sel = m.knowledge.filter(function (d) {
        var cb = view.querySelector(".pick-cb[data-id='" + d.id + "']");
        return cb && cb.checked;
      });
      if (!sel.length) { U.toast("请至少勾选一项"); return; }
      var r = buildPickList(sel);
      pickText = r.text;
      document.getElementById("pick-result").textContent = r.text;
      document.getElementById("pick-actions").style.display = "";
      U.toast("已生成取用包（" + r.count + " 项）");
    });
    on("#pick-print", "click", function () {
      if (!pickText) { U.toast("请先生成取用包"); return; }
      printAttachment({ kind: 'doc', title: '标书取用包清单', text: pickText, meta: { name: '标书取用包' } });
    });
    on("#pick-doc", "click", function () {
      if (!pickText) { U.toast("请先生成取用包"); return; }
      U.downloadDoc("标书取用包清单.doc", "<h2 style='text-align:center'>标书取用包清单</h2><div style='white-space:pre-wrap'>" + esc(pickText) + "</div>");
    });
  }

  // ================= 设置 =================
  function renderSettings() {
    setView("系统设置");
    var ai = S.get().ai;
    var html = "<div class='card'><div class='section-title'>AI 大模型接入（OpenAI 兼容）</div><div class='section-sub'>填写后“智能方案/技术标”将调用真实大模型；不填则使用离线模板</div>";
    html += fld("API Base URL", "ai-url", ai.baseUrl);
    html += fld("API Key", "ai-key", ai.key);
    html += fld("模型名", "ai-model", ai.model);
    html += "<label class='pill'><input type='checkbox' id='ai-on' " + (ai.enabled ? "checked" : "") + " style='width:auto'/> 启用 AI 调用</label>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-ai-save'>保存配置</button><button class='btn-ghost btn-sm' id='b-ai-test'>测试连接</button><span id='ai-test-tip' class='muted' style='font-size:12px'></span></div></div>";

    html += "<div class='card'><div class='section-title'>评分维度（快捷/定制评分模式依据）</div>";
    html += "<table class='tbl'><tr><th>维度</th><th>权重%</th><th>关注关键词</th></tr>";
    D.scoreDims.forEach(function (d) { html += "<tr><td>" + esc(d.dim) + "</td><td>" + d.weight + "</td><td class='muted' style='font-size:12px'>" + esc(d.keys.join("、")) + "</td></tr>"; });
    html += "</table></div>";

    html += "<div class='card'><div class='section-title'>执行标准（冶金焦化）</div><div class='muted' style='font-size:12px'>" + esc(D.standards.join("；")) + "</div></div>";

    html += "<div class='card'><div class='section-title'>版式默认偏好</div>";
    html += "<label class='pill'><input type='checkbox' id='set-dark' " + (S.get().settings.defaultDarkLabel ? "checked" : "") + " style='width:auto'/> 新建项目默认启用暗标模式</label>";
    html += "<div class='muted' style='font-size:12px'>暗标：导出标书时隐去投标人名称与平台署名，符合无标识投标要求。</div></div>";

    html += "<div class='card'><div class='section-title'>工程数据迁移（跨设备 / 云同步）</div><div class='section-sub'>云同步只同步代码文件，不同步浏览器数据。用此功能把投标项目、素材库、AI 配置打包带走</div>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='b-export'>导出工程数据（.json）</button><button class='btn-ghost btn-sm' id='b-import'>导入工程数据</button><input type='file' id='f-import' accept='application/json,.json' style='display:none'/></div>";
    html += "<div class='muted' style='font-size:12px'>导出为 JSON 文件，可存入微云/网盘；在另一台电脑“导入”即可恢复全部数据与配置（含 AI Key）。</div></div>";

    html += "<div class='card'><div class='section-title' style='color:var(--bad)'>危险操作</div>";
    html += "<div class='toolbar'><button class='btn-danger btn-sm' id='b-reset'>清空全部本地数据</button></div>";
    html += "<div class='muted' style='font-size:12px'>仅清空本平台 localStorage 数据，不影响其他文件。</div></div>";
    view.innerHTML = html;

    on("#b-ai-save", "click", function () {
      ai.baseUrl = document.getElementById("ai-url").value.trim();
      ai.key = document.getElementById("ai-key").value.trim();
      ai.model = document.getElementById("ai-model").value.trim();
      ai.enabled = document.getElementById("ai-on").checked;
      save(); updateAIStatus(); U.toast("AI 配置已保存");
    });
    on("#b-ai-test", "click", async function () {
      var tip = document.getElementById("ai-test-tip");
      if (!ai.enabled || !ai.key) { tip.textContent = "请先启用并填写 Key"; return; }
      tip.textContent = "测试中…";
      try { var r = await SYD.ai.chat("只回复 ok", "ok"); tip.textContent = "连接成功：" + (r || "").slice(0, 20); }
      catch (e) { tip.textContent = "失败：" + e.message; }
    });
    on("#b-reset", "click", function () {
      confirmModal({ title: "危险操作确认", sub: "确认清空全部投标项目与素材库数据？此操作不可恢复。", okText: "确认清空", onOk: function () { S.reset(); U.toast("已清空"); SYD.ui.render("dashboard"); updateAIStatus(); } });
    });
    on("#set-dark", "change", function (e) { S.get().settings.defaultDarkLabel = e.target.checked; save(); });

    on("#b-export", "click", function () {
      U.download("智能投标平台_工程数据_" + U.fmtDate() + ".json", JSON.stringify(S.exportData(), null, 2), "application/json;charset=utf-8");
      U.toast("已导出工程数据");
    });
    on("#b-import", "click", function () { document.getElementById("f-import").click(); });
    on("#f-import", "change", function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var obj = JSON.parse(r.result);
          confirmModal({ title: "导入工程数据", sub: "将覆盖当前全部本地数据，确定导入？", okText: "确认导入", onOk: function () {
            S.importData(obj); U.toast("导入成功，正在刷新…"); SYD.ui.render("dashboard"); updateAIStatus();
          } });
        } catch (err) { U.toast("导入失败：" + err.message); }
      };
      r.readAsText(f); e.target.value = "";
    });
  }

  // ---------- 投标授权书一键生成（对标：资质专利与授权·人员授权一键生成） ----------
  // 纯函数：输入投标人资料 + 被授权人信息，输出正式《法定代表人授权委托书》文本。
  // 不臆造任何企业真实信息：缺字段时留明确占位，提示用户到企业资料库补全。
  function generateAuthLetter(d) {
    d = d || {};
    var c = d.company || {};
    var coName = (d.coName || c.name || "").trim() || "（投标人名称，请在企业资料库补全）";
    var legal = (d.legal || c.legal || "").trim() || "（法定代表人，请在企业资料库补全）";
    var credit = (d.credit || c.credit || "").trim() || "（统一社会信用代码）";
    var addr = (d.addr || c.addr || "").trim() || "（注册地址）";
    var agent = (d.agent || "").trim();
    var id = (d.id || "").trim();
    var proj = (d.proj || "").trim();
    var bidno = (d.bidno || "").trim();
    var buyer = (d.buyer || "").trim();
    var sd = (d.sd || "").trim();
    var ed = (d.ed || "").trim();
    var scope = (d.scope || "签署、澄清、说明、补正、递交、撤回本次投标文件及相关资料，并处理投标有关事务").trim();
    var t = "法定代表人授权委托书\n\n";
    t += "致：" + (buyer || "（招标人）") + "\n\n";
    t += "本授权委托书声明：我 " + legal + "（法定代表人姓名），系 " + coName + "（投标人名称，统一社会信用代码：" + credit + "，注册地址：" + addr + "）的法定代表人，现授权委托 " + (agent || "（被授权人姓名）") + "（被授权人姓名），身份证号码：" + (id || "（请填写）") + "，作为我公司的合法代理人，以本公司名义参加 " + (proj || "（投标项目名称）") + (bidno ? "（招标编号：" + bidno + "）" : "") + " 的投标活动。\n\n";
    t += "授权事项：" + scope + "。\n\n";
    t += "代理人在投标、开标、评标、合同谈判过程中所签署的一切文件和处理与之有关的一切事务，我均予以承认。\n\n";
    t += "代理人无转委托权。特此委托。\n\n";
    t += "投标人（盖单位章）：" + coName + "\n";
    t += "法定代表人（签字或盖章）：" + legal + "\n";
    t += "授权有效期：" + (sd || "") + " 至 " + (ed || "") + "\n";
    t += "代理人（签字）：____________\n";
    return t;
  }

  // ---------- 标书取用包（资质即取即用） ----------
  // 纯函数：给定已勾选的素材条目，输出按类型分组的取用清单文本。
  function buildPickList(items) {
    items = items || [];
    var groups = {};
    items.forEach(function (it) {
      var k = (it.meta && it.meta.type) || "其他";
      (groups[k] = groups[k] || []).push(it);
    });
    var keys = Object.keys(groups);
    var text = "标书取用包清单（共 " + items.length + " 项）\n生成时间：" + U.fmtDate() + "\n\n";
    keys.forEach(function (k, gi) {
      text += (gi + 1) + ". 【" + k + "】(" + groups[k].length + " 项)\n";
      groups[k].forEach(function (it, i) {
        var m = it.meta || {};
        text += "   (" + (i + 1) + ") " + (it.title || "未命名") + (m.date ? " 〔" + m.date + "〕" : "") + (m.code ? " 编号 " + m.code : "") + (it.locked ? " ［原件只读］" : "") + "\n";
      });
    });
    return { count: items.length, text: text };
  }

  // ---------- 场景化标书模板库（按招标类型/评分项自动装配） ----------
  // 新增能力（叠加，不改动任何既有模块）：把星源达高频标书的“章节骨架 + 评分项资质要求”固化为模板，
  // 选模板 + 填招标信息后，一键生成章节骨架并按评分项关键词从企业素材(知识库)自动装配资质取用清单，
  // 即“即取即用”。逻辑复用 buildKBEntries / isOriginalType / 打印引擎 / 取用包思路。
  var BID_TEMPLATES = [
    {
      id: "cri", name: "焦炭反应性测定装置（CRI/CSR）", summary: "焦炭反应性及反应后强度测定装置投标骨架",
      match: ["焦炭反应性", "CRI", "CSR", "反应后强度", "测定装置"],
      sections: ["投标函", "法定代表人授权委托书", "投标人资格证明文件", "投标保证金", "商务标（报价一览表/分项报价）", "技术标（技术方案/技术偏离表）", "供货业绩", "质量保证与售后服务", "培训方案"],
      scoreItems: [
        { name: "企业资质与体系认证", required: true, keywords: ["体系认证", "ISO", "资质", "证书", "认证"] },
        { name: "检测/检验报告", required: true, keywords: ["检测", "检验", "质检", "报告"] },
        { name: "供货业绩", required: true, keywords: ["业绩", "合同", "业绩表", "用户"] },
        { name: "知识产权（专利/软著）", required: false, keywords: ["专利", "软著", "著作权", "知识产权"] },
        { name: "产品认证（煤安/防爆等）", required: false, keywords: ["煤安", "防爆", "产品认证", "3C", "CE"] }
      ]
    },
    {
      id: "cokeoven", name: "小焦炉 / 试验焦炉", summary: "40kg 试验焦炉等小焦炉类投标骨架",
      match: ["小焦炉", "试验焦炉", "焦炉"],
      sections: ["投标函", "法定代表人授权委托书", "投标人资格证明文件", "商务标（报价一览表/分项报价）", "技术标（技术方案/技术偏离表）", "同类产品供货业绩", "安装调试与培训", "售后服务"],
      scoreItems: [
        { name: "企业资质与体系认证", required: true, keywords: ["体系认证", "ISO", "资质", "证书", "认证"] },
        { name: "检测/检验报告", required: true, keywords: ["检测", "检验", "质检", "报告"] },
        { name: "供货业绩（焦炉类）", required: true, keywords: ["业绩", "合同", "业绩表", "焦炉"] },
        { name: "知识产权（专利/软著）", required: false, keywords: ["专利", "软著", "著作权"] }
      ]
    },
    {
      id: "prep", name: "煤焦智能制样系统", summary: "智能化采制样/制样系统投标骨架",
      match: ["制样", "采制样", "智能制样", "采样"],
      sections: ["投标函", "法定代表人授权委托书", "投标人资格证明文件", "商务标（报价一览表/分项报价）", "技术方案（系统组成/工艺流程/自控）", "技术偏离表", "同类业绩", "安装调试与培训", "售后与备件"],
      scoreItems: [
        { name: "企业资质与体系认证", required: true, keywords: ["体系认证", "ISO", "资质", "证书", "认证"] },
        { name: "检测/检验报告", required: true, keywords: ["检测", "检验", "质检", "报告"] },
        { name: "供货业绩（制样/采样类）", required: true, keywords: ["业绩", "合同", "业绩表", "制样", "采样"] },
        { name: "软件著作权 / 专利", required: false, keywords: ["软著", "专利", "著作权", "软件"] },
        { name: "产品认证", required: false, keywords: ["煤安", "防爆", "产品认证", "3C"] }
      ]
    },
    {
      id: "generic", name: "通用标书骨架", summary: "未命中专用类型时的兜底模板",
      match: [],
      sections: ["投标函", "法定代表人授权委托书", "投标人资格证明文件", "商务标", "技术标", "业绩", "售后服务"],
      scoreItems: [
        { name: "企业资质与体系认证", required: true, keywords: ["体系认证", "ISO", "资质", "证书", "认证"] },
        { name: "检测/检验报告", required: true, keywords: ["检测", "检验", "质检", "报告"] },
        { name: "供货业绩", required: true, keywords: ["业绩", "合同", "业绩表"] }
      ]
    }
  ];

  // 纯函数：根据招标名称自动推荐模板（命中关键词最多者；无命中返回通用兜底）
  function recommendTemplate(projName) {
    projName = (projName || "").toLowerCase();
    var fallback = BID_TEMPLATES[BID_TEMPLATES.length - 1];
    var best = fallback, bestScore = 0;
    BID_TEMPLATES.forEach(function (t) {
      var s = 0;
      (t.match || []).forEach(function (kw) { if (projName.indexOf(String(kw).toLowerCase()) >= 0) s++; });
      if (s > bestScore) { bestScore = s; best = t; }
    });
    return bestScore > 0 ? best : fallback;
  }

  // 纯函数：素材条目是否命中某评分项关键词（匹配 meta.type / 标题 / info）
  function matchScoreItem(item, keywords) {
    var blob = [((item.meta || {}).type) || "", item.title || "", ((item.meta || {}).info) || ""].join(" ").toLowerCase();
    for (var i = 0; i < (keywords || []).length; i++) {
      if (blob.indexOf(String(keywords[i]).toLowerCase()) >= 0) return true;
    }
    return false;
  }

  function cnNum(n) { var d = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]; return n <= 10 ? d[n] : String(n); }

  // 纯函数：装配标书骨架 + 评分项资质清单（核心，可单测）
  function assembleBid(template, tender, kbEntries) {
    template = template || BID_TEMPLATES[BID_TEMPLATES.length - 1];
    tender = tender || {};
    kbEntries = kbEntries || [];
    var co = ((typeof S !== "undefined") && S.get && S.get().materials && S.get().materials.company) || {};
    var head = "投标单位：" + (co.name || "（待填）") + "    招标编号：" + (tender.bidno || "（待填）") +
      "    招标人：" + (tender.buyer || "（待填）") + "    项目名称：" + (tender.proj || "（待填）") + "\n";
    var skeleton = "【标书章节骨架】\n" + template.sections.map(function (s, i) { return "第" + cnNum(i + 1) + "章 " + s + "（待编制）"; }).join("\n") + "\n";
    var scoreLines = "", matchedAny = 0;
    template.scoreItems.forEach(function (si, gi) {
      var hits = kbEntries.filter(function (it) { return matchScoreItem(it, si.keywords); });
      matchedAny += hits.length;
      scoreLines += (gi + 1) + ". " + si.name + (si.required ? "【必备】" : "【加分】") + "：匹配到 " + hits.length + " 项\n";
      hits.forEach(function (it, i) {
        var m = it.meta || {};
        scoreLines += "   - " + (it.title || "未命名") + (m.date ? "〔" + m.date + "〕" : "") + (m.code ? " 编号" + m.code : "") + (it.locked ? "［原件只读］" : "") + "\n";
      });
      if (!hits.length) scoreLines += "   （素材库暂无匹配，请到「企业素材-知识库」补充）\n";
    });
    var scoreBlock = "【评分项资质装配】\n" + scoreLines;
    var text = head + "\n" + skeleton + "\n" + scoreBlock + "\n模板：" + template.name + " ｜ 生成时间：" + ((typeof U !== "undefined" && U.fmtDate) ? U.fmtDate() : "") + "\n";
    return { templateId: template.id, skeleton: skeleton, scoreBlock: scoreBlock, matchedCount: matchedAny, text: text };
  }

  function renderAuthz() {
    setView("投标授权");
    var co = S.get().materials.company || {};
    var miss = ["name", "legal", "credit", "addr"].filter(function (k) { return !(co[k] && String(co[k]).trim()); });
    var html = "<div class='grid grid-2'>";
    html += "<div class='card'><div class='section-title'>法定代表人授权委托书 · 一键生成</div><div class='section-sub'>投标人信息取自“企业素材-企业资料库”，未填请先补全</div>";
    html += fld("被授权人姓名", "az-name", "");
    html += fld("被授权人身份证号", "az-id", "");
    html += fld("投标项目名称", "az-proj", "");
    html += fld("招标编号", "az-bidno", "");
    html += fld("招标人（招标单位）", "az-buyer", "");
    html += fld("授权起始日期", "az-sd", U.fmtDate());
    html += fld("授权截止日期", "az-ed", U.fmtDate());
    html += "<label class='pill'>委托权限（可改）</label><textarea id='az-scope' rows='2' style='width:100%'>" + esc("签署、澄清、说明、补正、递交、撤回本次投标文件及相关资料，并处理投标有关事务") + "</textarea>";
    html += "<div class='toolbar'><button class='btn-primary btn-sm' id='az-gen'>生成授权委托书</button><button class='btn-ghost btn-sm' id='az-print' disabled>打印</button><button class='btn-ghost btn-sm' id='az-doc' disabled>导出Word</button></div>";
    if (miss.length) html += "<div class='muted' style='font-size:12px;color:var(--bad)'>提示：企业资料库缺少 " + esc(miss.join("、")) + "，请先到「企业素材-企业资料库」补全，否则委托书对应处留空。</div>";
    html += "</div>";
    html += "<div class='card'><div class='section-title'>预览</div><div id='az-preview' class='editor-out' style='white-space:pre-wrap;min-height:260px;font-size:13px'>填写左侧并点击「生成授权委托书」后，此处显示正式委托书文本。</div></div>";
    html += "</div>";
    html += "<div class='card'><div class='section-title'>已生成授权记录</div><div id='az-hist' class='list'></div></div>";
    view.innerHTML = html;
    var lastText = "";
    function renderHist() {
      var box = document.getElementById("az-hist"); if (!box) return;
      var arr = S.get().materials.authz || [];
      box.innerHTML = arr.length ? arr.map(function (a, i) {
        return "<div class='item'><div style='font-size:13px'><b>" + (i + 1) + ". " + esc(a.agent || "未命名") + "</b> <span class='muted' style='font-size:11px'>" + esc(a.buyer || "") + " · " + esc(a.proj || "") + " · " + esc(a.sd || "") + "~" + esc(a.ed || "") + "</span></div><div class='item-actions'><button class='btn-ghost btn-sm az-h-print' data-i='" + i + "'>打印</button><button class='btn-ghost btn-sm az-h-doc' data-i='" + i + "'>Word</button><button class='btn-danger btn-sm az-h-del' data-i='" + i + "'>删</button></div></div>";
      }).join("") : "<div class='empty'>暂无</div>";
      onAll(".az-h-del", "click", function (e) { var i = +e.target.getAttribute("data-i"); (S.get().materials.authz || []).splice(i, 1); save(); renderHist(); });
      onAll(".az-h-print", "click", function (e) { var a = (S.get().materials.authz || [])[+e.target.getAttribute("data-i")]; if (a) printAttachment({ kind: 'doc', title: '法定代表人授权委托书', text: a.text, meta: { name: '授权委托书' } }); });
      onAll(".az-h-doc", "click", function (e) { var a = (S.get().materials.authz || [])[+e.target.getAttribute("data-i")]; if (a) U.downloadDoc("授权委托书_" + (a.agent || "") + ".doc", "<h2 style='text-align:center'>法定代表人授权委托书</h2><div style='white-space:pre-wrap'>" + esc(a.text) + "</div>"); });
    }
    renderHist();
    function collect() {
      return {
        company: (S.get().materials.company || {}),
        agent: (document.getElementById("az-name").value || "").trim(),
        id: (document.getElementById("az-id").value || "").trim(),
        proj: (document.getElementById("az-proj").value || "").trim(),
        bidno: (document.getElementById("az-bidno").value || "").trim(),
        buyer: (document.getElementById("az-buyer").value || "").trim(),
        sd: (document.getElementById("az-sd").value || "").trim(),
        ed: (document.getElementById("az-ed").value || "").trim(),
        scope: (document.getElementById("az-scope").value || "").trim()
      };
    }
    on("#az-gen", "click", function () {
      var d = collect();
      if (!d.agent) { U.toast("请填写被授权人姓名"); return; }
      var text = generateAuthLetter(d);
      lastText = text;
      document.getElementById("az-preview").textContent = text;
      document.getElementById("az-print").disabled = false;
      document.getElementById("az-doc").disabled = false;
      if (!S.get().materials.authz) S.get().materials.authz = [];
      S.get().materials.authz.unshift({ agent: d.agent, buyer: d.buyer, proj: d.proj, sd: d.sd, ed: d.ed, text: text });
      save(); renderHist();
      U.toast("已生成授权委托书");
    });
    on("#az-print", "click", function () {
      if (!lastText) { U.toast("请先生成"); return; }
      printAttachment({ kind: 'doc', title: '法定代表人授权委托书', text: lastText, meta: { name: '授权委托书' } });
    });
    on("#az-doc", "click", function () {
      if (!lastText) { U.toast("请先生成"); return; }
      U.downloadDoc("授权委托书_" + (collect().agent || "") + ".doc", "<h2 style='text-align:center'>法定代表人授权委托书</h2><div style='white-space:pre-wrap'>" + esc(lastText) + "</div>");
    });
  }

  function renderTmpl() {
    setView("标书模板");
    var html = "<div class='grid grid-2'>";
    html += "<div class='card'><div class='section-title'>场景化标书模板库</div><div class='section-sub'>按招标类型套用骨架，并按评分项自动从企业素材装配资质清单（“即取即用”）</div>";
    html += "<div class='section-sub'>选择模板（或填招标名称后点「智能推荐」）：</div>";
    html += "<div id='tmpl-list' class='list'>" + BID_TEMPLATES.map(function (t) {
      return "<div class='item tmpl-item' data-id='" + t.id + "'><div style='font-size:13px'><b>" + esc(t.name) + "</b></div><div class='muted' style='font-size:11px'>" + esc(t.summary) + "</div></div>";
    }).join("") + "</div>";
    html += fld("招标项目名称（用于智能推荐）", "tm-proj", "");
    html += fld("招标编号", "tm-bidno", "");
    html += fld("招标人", "tm-buyer", "");
    html += "<div class='toolbar'><button class='btn-ghost btn-sm' id='tm-reco'>智能推荐模板</button><button class='btn-primary btn-sm' id='tm-gen' disabled>一键生成标书装配</button><button class='btn-ghost btn-sm' id='tm-print' disabled>打印</button><button class='btn-ghost btn-sm' id='tm-doc' disabled>导出Word</button></div>";
    html += "</div>";
    html += "<div class='card'><div class='section-title'>装配预览</div><div id='tm-preview' class='editor-out' style='white-space:pre-wrap;min-height:320px;font-size:13px'>选择左侧模板并填写招标信息，点击「一键生成标书装配」。系统将生成章节骨架，并按评分项自动从企业素材（知识库）匹配资质/证书/业绩，形成“即取即用”的取用装配。</div><div id='tm-authlink' class='muted' style='font-size:12px;margin-top:10px;display:none'>提示：标书中含“法定代表人授权委托书”章节，可到「投标授权」模块一键生成 →</div></div>";
    html += "</div>";
    view.innerHTML = html;
    var curT = null, lastText = "";
    function highlight(id) { document.querySelectorAll(".tmpl-item").forEach(function (el) { el.style.background = el.getAttribute("data-id") === id ? "var(--accent-soft)" : ""; }); }
    onAll(".tmpl-item", "click", function (e) {
      curT = BID_TEMPLATES.filter(function (t) { return t.id === e.currentTarget.getAttribute("data-id"); })[0];
      highlight(curT.id); document.getElementById("tm-gen").disabled = false; U.toast("已选模板：" + curT.name);
    });
    on("#tm-reco", "click", function () {
      var p = document.getElementById("tm-proj").value || "";
      var t = recommendTemplate(p); curT = t; highlight(t.id); document.getElementById("tm-gen").disabled = false; U.toast("推荐模板：" + t.name);
    });
    on("#tm-gen", "click", function () {
      if (!curT) { U.toast("请先选择模板"); return; }
      var tender = {
        proj: (document.getElementById("tm-proj").value || "").trim(),
        bidno: (document.getElementById("tm-bidno").value || "").trim(),
        buyer: (document.getElementById("tm-buyer").value || "").trim()
      };
      var kb = buildKBEntries(S.get().materials.knowledge || []);
      var r = assembleBid(curT, tender, kb);
      lastText = r.text;
      document.getElementById("tm-preview").textContent = r.text;
      document.getElementById("tm-print").disabled = false;
      document.getElementById("tm-doc").disabled = false;
      document.getElementById("tm-authlink").style.display = "";
      U.toast("已生成装配（匹配资质 " + r.matchedCount + " 项）");
    });
    on("#tm-print", "click", function () { if (!lastText) { U.toast("请先生成"); return; } printAttachment({ kind: "doc", title: "标书装配方案", text: lastText, meta: { name: "标书模板装配" } }); });
    on("#tm-doc", "click", function () { if (!lastText) { U.toast("请先生成"); return; } U.downloadDoc("标书装配_" + (curT ? curT.name : "") + ".doc", "<h2 style='text-align:center'>标书装配方案</h2><div style='white-space:pre-wrap'>" + esc(lastText) + "</div>"); });
  }

  function emptyCard(t, sub) { return "<div class='card'><div class='section-title'>" + t + "</div><div class='empty'>" + sub + "</div></div>"; }

  /* 模块空状态引导页：无投标项目时不再只显示一句话，而是完整展示模块能力与工作流，并提供直达新建按钮 */
  function renderModuleEmpty(icon, name, intro, steps) {
    var h = "<div class='card' style='padding:26px 28px'>";
    h += "<div style='display:flex;align-items:center;gap:14px'>";
    h += "<div class='mod-ico' style='width:48px;height:48px;font-size:22px;border-radius:14px;flex:0 0 48px;background:linear-gradient(135deg,var(--primary),var(--accent-2))'>" + icon + "</div>";
    h += "<div><div class='section-title' style='font-size:18px;margin:0 0 4px'>" + name + "</div><div class='section-sub'>" + intro + "</div></div></div>";
    h += "<div class='steps' style='margin-top:18px'>";
    steps.forEach(function (s, i) { h += "<div class='step'><span class='snum'>" + (i + 1) + "</span>" + s + "</div>"; });
    h += "</div>";
    h += "<div class='empty' style='margin-top:16px'>当前还没有投标项目。新建一个项目，本模块即可开始工作。</div>";
    h += "<div style='margin-top:12px'><button class='btn-primary' id='empty-new'>＋ 新建投标项目，立即开始</button></div>";
    h += "</div>";
    view.innerHTML = h;
    var b = view.querySelector("#empty-new");
    if (b) b.addEventListener("click", function () { var t = document.getElementById("btn-new-project"); if (t) t.click(); });
  }

  function updateAIStatus() {
    var el = document.getElementById("ai-status"); if (!el) return;
    el.textContent = SYD.ai.ready() ? "AI：已启用" : "AI：未配置";
  }

  var map = {
    dashboard: renderDashboard, plan: renderPlan, bid: renderBid, quote: renderQuote,
    qc: renderQC, dup: renderDup, lib: renderLib, authz: renderAuthz, tmpl: renderTmpl, settings: renderSettings
  };
  SYD.ui = {
    render: function (name) { (map[name] || map.dashboard)(); updateAIStatus(); },
    setProject: function (id) { cur.pid = id; },
    modal: modal,
    confirm: confirmModal,
    // 暴露给全站调用与自测：文件名智能识别 + 批量组装 + 原件锁定判定
    analyzeFileName: analyzeFileName,
    buildKBEntries: buildKBEntries,
    isOriginalType: isOriginalType,
    // 暴露给全站调用与自测：投标授权书一键生成 + 标书取用包
    generateAuthLetter: generateAuthLetter,
    buildPickList: buildPickList,
    // 暴露给全站调用与自测：场景化标书模板库（按招标类型/评分项自动装配）
    BID_TEMPLATES: BID_TEMPLATES,
    recommendTemplate: recommendTemplate,
    matchScoreItem: matchScoreItem,
    assembleBid: assembleBid,
    // 暴露给全站调用与自测：附件预览 / 打印 / 自动识别再编辑
    openAttachmentViewer: openAttachmentViewer,
    printAttachment: printAttachment,
    attachmentPrintHTML: attachmentPrintHTML
  };
})();
