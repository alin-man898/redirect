/* store.js —— 本地存储 / 领域数据 / 通用工具 */
(function (global) {
  "use strict";
  var KEY = "syd_bid_platform_v1";

  // 默认状态
  function defaultState() {
    return {
      projects: [],            // 投标项目
      materials: {             // 企业素材
        knowledge: [],         // 知识库文档
        images: [],            // 私人图库(base64 + 描述 + 标签)
        company: null          // 企业资料库(结构化)
      },
      ai: { baseUrl: "https://api.openai.com/v1", key: "", model: "gpt-4o-mini", visionModel: "gpt-4o-mini", enabled: false },
      qcTemplates: [],         // 自定义质检模板
      settings: { theme: "light", defaultDarkLabel: false }
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      // 合并默认，防止缺字段
      var d = defaultState();
      s.projects = s.projects || d.projects;
      s.materials = Object.assign(d.materials, s.materials || {});
      s.ai = Object.assign(d.ai, s.ai || {});
      s.qcTemplates = s.qcTemplates || d.qcTemplates;
      s.settings = Object.assign(d.settings, s.settings || {});
      return s;
    } catch (e) { return defaultState(); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { SYD.toast("保存失败：" + e.message); }
  }

  // 冶金焦化 B2B 投标领域知识（工业产品类）
  var domain = {
    // 工业产品类技术方案标准目录（可编辑/扩展）
    planChapters: [
      { name: "项目理解与需求分析", tip: "解读招标方工况、产能、痛点与采购目标" },
      { name: "产品总体技术方案", tip: "设备构成、工作原理、技术路线" },
      { name: "关键技术参数与响应表", tip: "逐条响应招标技术要求，标注正/偏离" },
      { name: "执行标准与质量保障", tip: "GB/T 4000、GB/T 220、GB/T 5447 等引用" },
      { name: "供货范围与进度计划", tip: "设备清单、生产周期、交货节点（工业产品类专属）" },
      { name: "安装调试与验收方案", tip: "现场安装、联调、性能验收" },
      { name: "操作培训与技术交底", tip: "操作工培训、资料移交" },
      { name: "售后服务与质保体系", tip: "响应时间、质保期、备品备件、终身维护" }
    ],
    // 常见评分维度（制造业投标）
    scoreDims: [
      { dim: "技术方案", weight: 40, keys: ["技术方案", "先进性", "技术路线", "参数响应"] },
      { dim: "企业综合实力", weight: 20, keys: ["资质", "业绩", "认证", "财务", "规模"] },
      { dim: "产品质量与标准", weight: 20, keys: ["质量", "标准", "GB", "检测", "认证"] },
      { dim: "售后服务", weight: 10, keys: ["售后", "质保", "响应", "培训", "备件"] },
      { dim: "报价", weight: 10, keys: ["报价", "价格", "分项", "优惠"] }
    ],
    // 常见资质（工业产品类设备制造商）
    certs: ["ISO9001 质量体系", "ISO14001 环境体系", "高新技术企业", "CE 认证", "计量器具型式批准",
      "专利证书", "软件著作权", "职业健康安全体系", "AAA 信用等级", "检测报告"],
    // 常见执行标准（冶金焦化）
    standards: ["GB/T 4000 焦炭反应性及反应后强度", "GB/T 220 煤对二氧化碳化学反应性",
      "GB/T 5447 烟煤粘结指数", "GB/T 1996 冶金焦炭", "GB/T 2006 焦炭机械强度",
      "GB/T 2286 焦化产品", "GB/T 9976 焦化产品试验"],
    // 招标文件质检关键词（抽取质检项）
    qcKeywords: [
      { kw: "资质", label: "资质要求", cat: "资格" },
      { kw: "认证", label: "认证要求", cat: "资格" },
      { kw: "业绩", label: "业绩要求", cat: "资格" },
      { kw: "财务", label: "财务要求", cat: "资格" },
      { kw: "联合体", label: "联合体/分包", cat: "资格" },
      { kw: "保证金", label: "投标保证金", cat: "商务" },
      { kw: "报价", label: "报价要求", cat: "商务" },
      { kw: "交货", label: "交货期/工期", cat: "商务" },
      { kw: "质保", label: "质保期", cat: "商务" },
      { kw: "售后", label: "售后服务", cat: "商务" },
      { kw: "培训", label: "培训要求", cat: "商务" },
      { kw: "参数", label: "技术参数响应", cat: "技术" },
      { kw: "标准", label: "执行标准", cat: "技术" },
      { kw: "检测", label: "检测/验收", cat: "技术" },
      { kw: "偏离", label: "偏离表", cat: "技术" },
      { kw: "废标", label: "废标条款", cat: "合规" },
      { kw: "否决", label: "否决条款", cat: "合规" },
      { kw: "盖章", label: "签章/签署", cat: "合规" },
      { kw: "密封", label: "密封要求", cat: "合规" }
    ],
    // 商务标一键填空模板（工业产品类）
    bidFillTemplate: [
      { f: "投标人名称", k: "name" }, { f: "统一社会信用代码", k: "credit" },
      { f: "法定代表人", k: "legal" }, { f: "注册地址", k: "addr" },
      { f: "联系电话", k: "phone" }, { f: "开户银行", k: "bank" },
      { f: "银行账号", k: "account" }, { f: "投标产品", k: "product" },
      { f: "交货期", k: "lead" }, { f: "质保期", k: "warranty" }
    ],
    // 报价成本构成（工业产品类投标）
    quoteCostCats: [
      { k: "material", label: "设备材料成本", def: 60 },
      { k: "labor", label: "人工与装配", def: 12 },
      { k: "mfg", label: "制造费用", def: 8 },
      { k: "freight", label: "运输与保险", def: 5 },
      { k: "mgmt", label: "管理与税费", def: 10 }
    ],
    quoteMarginDefault: 15,     // 期望毛利率(%)
    quoteItems: [               // 报价明细默认结构（导出用）
      "设备主机", "辅机与配件", "控制系统", "安装调试", "质保与培训"
    ]
  };

  // 通用工具
  var util = {
    uid: function () { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    fmtDate: function (d) { d = d || new Date(); var p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
    escapeHtml: function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); },
    download: function (filename, content, mime) {
      mime = mime || "text/plain;charset=utf-8";
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
    },
    // 导出为可被 Word 打开的 .doc（HTML 包装）
    downloadDoc: function (filename, htmlBody) {
      var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei","微软雅黑",sans-serif;line-height:1.8}</style></head><body>' + htmlBody + "</body></html>";
      util.download(filename, html, "application/msword;charset=utf-8");
    },
    toast: function (msg) {
      var t = document.getElementById("toast");
      if (!t) return;
      t.textContent = msg; t.classList.add("show");
      clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
    }
  };

  // 工程数据导出/导入（跨设备迁移用）
  function exportData() {
    return { _app: "智能投标工作平台", _ver: 1, _exported: util.fmtDate(), data: state };
  }
  function importData(obj) {
    if (!obj || !obj.data) throw new Error("文件格式不正确（缺少 data 字段）");
    var d = defaultState(), s = obj.data;
    state = {
      projects: Array.isArray(s.projects) ? s.projects : d.projects,
      materials: Object.assign(d.materials, s.materials || {}),
      ai: Object.assign(d.ai, s.ai || {}),
      qcTemplates: Array.isArray(s.qcTemplates) ? s.qcTemplates : d.qcTemplates,
      settings: Object.assign(d.settings, s.settings || {})
    };
    save();
  }

  global.SYD = {
    store: {
      get: function () { return state; },
      save: save,
      reset: function () { state = defaultState(); save(); },
      exportData: exportData,
      importData: importData
    },
    domain: domain,
    util: util
  };
})(window);
