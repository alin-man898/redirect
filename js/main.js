/* main.js —— 启动 / 导航 / 主题 / 新建项目 */
(function () {
  "use strict";
  var SYD = window.SYD, S = SYD.store;
  var VIEW_TITLES = { dashboard: "工作中心", plan: "智能方案", bid: "智能标书", quote: "智能报价", qc: "智能质检", dup: "方案查重", lib: "企业素材", settings: "系统设置" };

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

  // 全站禁右键 + 版权所有人提示（跟随光标，自动贴边防越界）
  (function () {
    var tip = null;
    function showTip(x, y) {
      if (!tip) {
        tip = document.createElement("div");
        tip.id = "copyright-tip";
        tip.textContent = "版权所有人：梵音未改";
        document.body.appendChild(tip);
      }
      var w = tip.offsetWidth || 140, h = tip.offsetHeight || 36;
      var left = Math.min(Math.max(x, w / 2 + 8), window.innerWidth - w / 2 - 8);
      // 靠近顶部时翻到光标下方，避免被推到屏幕外看不见
      if (y - h - 14 < 8) {
        tip.style.transform = "translate(-50%, 22px)";
      } else {
        tip.style.transform = "translate(-50%, -130%)";
      }
      tip.style.left = left + "px";
      tip.style.top = y + "px";
      tip.classList.add("show");
      clearTimeout(tip._t);
      tip._t = setTimeout(function () { tip.classList.remove("show"); }, 2000);
    }
    document.addEventListener("contextmenu", function (e) {
      // 全站统一（含登录门禁/授权弹窗/输入框界面）：禁右键原生菜单 + 显示「版权所有人：梵音未改」文字跟随特效
      // 复制/粘贴/剪切/全选不受影响：用键盘快捷键 Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A（键盘与右键菜单相互独立）
      e.preventDefault();
      showTip(e.clientX, e.clientY);
    });
    document.addEventListener("click", function () { if (tip) tip.classList.remove("show"); });

    // 防盗复制：内容区拦截 copy/cut/selectstart（防止图文视频被复制窃取）
    // 登录/授权码输入框放行，保留复制、剪切、全选、粘贴能力
    function isAuthField(el) {
      if (!el || !el.tagName) return false;
      var t = el.tagName.toLowerCase();
      return t === "input" || t === "textarea" || el.isContentEditable === true;
    }
    ["copy", "cut", "selectstart"].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        if (isAuthField(e.target)) return; // 输入框：放行复制/剪切/全选
        e.preventDefault();
      });
    });
  })();
})();
