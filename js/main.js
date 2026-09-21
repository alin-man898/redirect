/* main.js —— 启动 / 导航 / 主题 / 新建项目 */
(function () {
  "use strict";
  var SYD = window.SYD, S = SYD.store;
  var VIEW_TITLES = { dashboard: "工作台", plan: "AI 方案", bid: "AI 标书", quote: "AI 报价", qc: "AI 质检", dup: "方案查重", lib: "企业素材库", settings: "设置" };

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    S.get().settings.theme = t; S.save();
  }

  // 导航
  document.getElementById("nav").addEventListener("click", function (e) {
    var btn = e.target.closest(".nav-item"); if (!btn) return;
    document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    SYD.ui.render(btn.getAttribute("data-view"));
  });

  // 主题
  document.getElementById("btn-theme").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
    U_toast("已切换为" + (cur === "dark" ? "浅色" : "深色") + "主题");
  });
  function U_toast(m) { SYD.util.toast(m); }

  // 新建项目（玻璃弹窗，替代原生 prompt，兼容预览环境）
  document.getElementById("btn-new-project").addEventListener("click", function () {
    SYD.ui.modal({
      title: "新建投标项目",
      sub: "请输入项目名称，例如「XX钢厂 焦炭反应性测定装置 投标」",
      value: "XX钢厂 焦炭反应性测定装置 投标",
      okText: "创建",
      onOk: function (name) {
        name = (name || "").trim();
        if (!name) { SYD.util.toast("项目名称不能为空"); return; }
        var p = { id: SYD.util.uid(), name: name, buyer: "", projectDesc: "", deadline: "", budget: "", scoreRule: "",
          rawText: "", basics: null, mode: "quick", chapters: [], length: "中", generated: false, qc: { items: [], versions: [] }, quote: null, status: "草稿", updated: SYD.util.fmtDate(),
          darkLabel: !!(S.get().settings && S.get().settings.defaultDarkLabel), feedImg: true };
        S.get().projects.push(p); S.save();
        SYD.ui.setProject(p.id);
        document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-view") === "plan"); });
        SYD.ui.render("plan");
      }
    });
  });

  // 初始
  applyTheme(S.get().settings.theme || "light");
  SYD.ui.render("dashboard");
})();
