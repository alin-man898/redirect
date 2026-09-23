/* =========================================================
   智能投标工作平台 · 登录门禁与授权逻辑（纯前端）
   - 首次初始化：所有权人自设主密码（不再写死），并生成恢复码
   - 主密码登录（所有者，本机）
   - 授权他人：生成带过期时间的授权码（SHA-256 签名防伪造）
   - 授权码登录（访客，自带时效）
   - 恢复码登录（跨设备自救）：验证通过 → 重设本机主密码
   - 会话管理 + 所有者授权管理面板（含恢复码查看/重生成）
   注意：纯前端方案，无后端。系统密钥写在源码中，仅适合内部工具。
   请修改 OWNER_INIT_TOKEN / SECRET / RECOVERY_SECRET 为你自己的值。
   ========================================================= */
(function () {
  "use strict";

  /* ====== 可配置项（请修改为你自己的值） ====== */
  const SECRET = "ALIN-MAN898-SYD-2026-KEY";          // 授权码签名密钥（改了会让所有旧授权码失效）
  const RECOVERY_SECRET = "ALIN-RECOVERY-2026-SYD";   // 恢复码签名密钥（改了所有旧恢复码失效）
  const OWNER_INIT_TOKEN = "alin-init-owner-2026";    // 初始化门槛令牌（设完主密码即废，请改成只有你知道的）
  const KEY_VERSION = "v1";                            // 授权码版本（轮换密钥时改这里 + 重部署）
  const OWNER_TTL = 12 * 3600 * 1000;                  // 所有者会话时长：12 小时
  const TRUST_TTL = 7 * 24 * 3600 * 1000;              // “信任此浏览器”时长：7 天
  const MASTER_SALT = "::sy-master-salt::";            // 主密码派生盐
  const RECOVERY_COUNT = 8;                            // 初始恢复码数量

  /* ====== 存储键 ====== */
  const LKEY_MASTER = "sy_master_hash";   // 本机主密码哈希
  const LKEY_INIT = "sy_initialized";     // 是否已初始化标记
  const LKEY_TRUST = "sy_auth_trust";     // localStorage（信任设备）
  const LKEY_GEN = "sy_auth_generated";   // 已生成授权码列表
  const LKEY_REVOKE = "sy_auth_revoked";  // 本机作废列表
  const LKEY_RECOVERY = "sy_recovery_codes"; // 本机保存的恢复码（展示/重生成用）

  /* ====== 工具：base64url + SHA-256 ====== */
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return decodeURIComponent(escape(atob(str)));
  }
  // 纯 JS SHA-256
  function sha256hex(str) {
    const bytes = new TextEncoder().encode(str);
    const K = new Uint32Array([
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ]);
    let h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    const l = bytes.length;
    const k = Math.ceil((l + 9) / 64) * 64;
    const msg = new Uint8Array(k);
    msg.set(bytes);
    msg[l] = 0x80;
    const bitLen = l * 8;
    msg[k - 8] = Math.floor(bitLen / 0x100000000);
    msg[k - 7] = (bitLen / 0x1000000) & 255;
    msg[k - 6] = (bitLen / 0x10000) & 255;
    msg[k - 5] = (bitLen / 0x100) & 255;
    msg[k - 4] = bitLen & 255;
    for (let off = 0; off < k; off += 64) {
      const w = new Uint32Array(64);
      for (let i = 0; i < 16; i++) {
        w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    let out = "";
    for (let i = 0; i < 8; i++) out += ("00000000" + (h[i] >>> 0).toString(16)).slice(-8);
    return out;
  }
  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    let s = "";
    for (let i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
    return s;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ====== 主密码 / 初始化 ====== */
  function masterHashOf(pw) { return sha256hex(pw + MASTER_SALT); }
  function hasMaster() { try { return !!localStorage.getItem(LKEY_MASTER); } catch (e) { return false; } }
  function isInitialized() { try { return localStorage.getItem(LKEY_INIT) === "1"; } catch (e) { return false; } }

  /* ====== 授权码：生成 / 校验 ====== */
  function makeCode(days, label) {
    const exp = Date.now() + days * 86400000;
    const payload = { v: KEY_VERSION, role: "guest", exp: exp, label: label || "", r: Math.random().toString(36).slice(2, 9) };
    const raw = b64urlEncode(JSON.stringify(payload));
    const sig = sha256hex(raw + SECRET).slice(0, 18);
    return raw + "." + sig;
  }
  function verifyCode(code) {
    code = (code || "").trim();
    const parts = code.split(".");
    if (parts.length !== 2) return { ok: false, reason: "授权码格式不正确" };
    const raw = parts[0], sig = parts[1];
    let revoked = [];
    try { revoked = JSON.parse(localStorage.getItem(LKEY_REVOKE) || "[]"); } catch (e) {}
    if (revoked.indexOf(raw) >= 0) return { ok: false, reason: "该授权码已被作废（本机）" };
    if (sha256hex(raw + SECRET).slice(0, 18) !== sig) return { ok: false, reason: "授权码无效或被篡改" };
    let payload;
    try { payload = JSON.parse(b64urlDecode(raw)); } catch (e) { return { ok: false, reason: "授权码无法解析" }; }
    if (payload.v !== KEY_VERSION) return { ok: false, reason: "授权码版本过期，请联系管理员重新生成" };
    if (!payload.exp || payload.exp < Date.now()) return { ok: false, reason: "授权码已过期" };
    return { ok: true, payload: payload };
  }

  /* ====== 恢复码：生成 / 校验 / 存取 ====== */
  function genRecoveryCodes(n) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const raw = randomHex(10);                       // 20 hex
      const sig = sha256hex(raw + RECOVERY_SECRET).slice(0, 10); // 10 hex 签名
      list.push({ raw: raw, sig: sig, code: raw + sig }); // 30 hex
    }
    return list;
  }
  function verifyRecovery(code) {
    code = (code || "").trim();
    if (code.length !== 30) return { ok: false, reason: "恢复码格式不正确" };
    const raw = code.slice(0, 20), sig = code.slice(20);
    if (sha256hex(raw + RECOVERY_SECRET).slice(0, 10) !== sig) return { ok: false, reason: "恢复码无效或被篡改" };
    return { ok: true };
  }
  function loadRecovery() { try { return JSON.parse(localStorage.getItem(LKEY_RECOVERY) || "[]"); } catch (e) { return []; } }
  function saveRecovery(arr) { try { localStorage.setItem(LKEY_RECOVERY, JSON.stringify(arr)); } catch (e) {} }

  /* ====== 会话 ====== */
  function saveSession(role, ttl, label) {
    const exp = Date.now() + ttl;
    const sess = { role: role, exp: exp, label: label || "", ts: Date.now() };
    try { sessionStorage.setItem("sy_auth_session", JSON.stringify(sess)); } catch (e) {}
    return sess;
  }
  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem("sy_auth_session") || "null");
      if (s && s.exp > Date.now()) return s;
    } catch (e) {}
    try {
      const t = JSON.parse(localStorage.getItem(LKEY_TRUST) || "null");
      if (t && t.exp > Date.now()) return t;
    } catch (e) {}
    return null;
  }

  /* ====== DOM 引用 ====== */
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  let gate, msgEl, clockEl, fab, modal, listEl;

  function showMsg(text, type) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.className = "login-msg" + (type ? " " + type : "");
  }
  function openGate() { if (gate) gate.classList.remove("hidden"); }
  function closeGate() { if (gate) gate.classList.add("hidden"); }

  /* ====== 初始化（首次设主密码 + 生成恢复码） ====== */
  function doInit() {
    const token = $("#init-token").value;
    const pw = $("#init-pw").value;
    const pw2 = $("#init-pw2").value;
    const im = $("#init-msg");
    if (token !== OWNER_INIT_TOKEN) { im.textContent = "所有权人初始令牌错误"; im.className = "login-msg err"; return; }
    if (pw.length < 6) { im.textContent = "主密码至少 6 位"; im.className = "login-msg err"; return; }
    if (pw !== pw2) { im.textContent = "两次输入的主密码不一致"; im.className = "login-msg err"; return; }
    try {
      localStorage.setItem(LKEY_MASTER, masterHashOf(pw));
      localStorage.setItem(LKEY_INIT, "1");
    } catch (e) {}
    const codes = genRecoveryCodes(RECOVERY_COUNT);
    saveRecovery(codes);
    saveSession("owner", OWNER_TTL, "所有者");
    renderRecoveryInto($("#init-recovery-list"), codes);
    $("#init-form").classList.add("hidden");
    $("#init-recovery").classList.remove("hidden");
    $("#btn-init-enter").classList.remove("hidden");
  }
  function renderRecoveryInto(box, codes) {
    if (!box) return;
    box.innerHTML = "";
    codes.forEach(function (c) {
      const row = document.createElement("div");
      row.className = "recovery-code";
      row.innerHTML = '<code>' + esc(c.code) + '</code><button class="auth-mini" data-act="rcopy" data-code="' + esc(c.code) + '">复制</button>';
      box.appendChild(row);
    });
  }

  /* ====== 主密码登录 ====== */
  function doMasterLogin() {
    const pw = $("#master-pw").value;
    if (!pw) { showMsg("请输入主密码", "err"); return; }
    let stored = null; try { stored = localStorage.getItem(LKEY_MASTER); } catch (e) {}
    if (masterHashOf(pw) !== stored) { showMsg("主密码错误", "err"); return; }
    saveSession("owner", OWNER_TTL, "所有者");
    showMsg("验证通过，正在进入…", "ok");
    setTimeout(function () { closeGate(); if (fab) fab.classList.remove("hidden"); }, 260);
  }

  /* ====== 授权码登录 ====== */
  function doCodeLogin() {
    const code = $("#code-input").value;
    if (!code) { showMsg("请粘贴授权码", "err"); return; }
    const r = verifyCode(code);
    if (!r.ok) { showMsg(r.reason, "err"); return; }
    const trust = $("#trust-device") && $("#trust-device").checked;
    const ttl = Math.min(r.payload.exp - Date.now(), TRUST_TTL);
    saveSession("guest", Math.max(ttl, 60000), r.payload.label);
    if (trust) {
      try { localStorage.setItem(LKEY_TRUST, JSON.stringify({ role: "guest", exp: r.payload.exp, label: r.payload.label, ts: Date.now() })); } catch (e) {}
    }
    showMsg("授权码有效，正在进入…", "ok");
    setTimeout(function () { closeGate(); }, 260);
  }

  /* ====== 恢复码登录 → 重设本机主密码 ====== */
  function doRecoveryLogin() {
    const code = $("#recovery-input").value;
    if (!code) { showMsg("请粘贴恢复码", "err"); return; }
    const r = verifyRecovery(code);
    if (!r.ok) { showMsg(r.reason, "err"); return; }
    // 切到重设面板
    $("#login-area").classList.add("hidden");
    $("#reset-pane").classList.remove("hidden");
    const rm = $("#reset-msg"); rm.textContent = "恢复码有效，请设置本机主密码"; rm.className = "login-msg ok";
    setTimeout(function () { const e = $("#reset-pw"); if (e) e.focus(); }, 50);
  }
  function doReset() {
    const pw = $("#reset-pw").value;
    const pw2 = $("#reset-pw2").value;
    const rm = $("#reset-msg");
    if (pw.length < 6) { rm.textContent = "主密码至少 6 位"; rm.className = "login-msg err"; return; }
    if (pw !== pw2) { rm.textContent = "两次输入不一致"; rm.className = "login-msg err"; return; }
    try { localStorage.setItem(LKEY_MASTER, masterHashOf(pw)); localStorage.setItem(LKEY_INIT, "1"); } catch (e) {}
    saveSession("owner", OWNER_TTL, "所有者");
    setTimeout(function () { closeGate(); if (fab) fab.classList.remove("hidden"); }, 200);
  }

  /* ====== 授权管理面板 ====== */
  function loadGen() { try { return JSON.parse(localStorage.getItem(LKEY_GEN) || "[]"); } catch (e) { return []; } }
  function saveGen(arr) { try { localStorage.setItem(LKEY_GEN, JSON.stringify(arr)); } catch (e) {} }

  function renderList() {
    if (!listEl) return;
    const arr = loadGen();
    if (!arr.length) { listEl.innerHTML = '<div class="auth-empty">还没有生成过授权码。设置时长与备注后点“生成授权码”。</div>'; return; }
    listEl.innerHTML = "";
    arr.forEach(function (item) {
      const exp = item.exp;
      const expired = exp < Date.now();
      const row = document.createElement("div");
      row.className = "auth-item" + (expired ? " expired" : "");
      const label = item.label || "（无备注）";
      const expStr = new Date(exp).toLocaleString("zh-CN", { hour12: false });
      row.innerHTML =
        '<div class="auth-item-top"><span class="auth-item-label">' + esc(label) + '</span>' +
        '<span class="auth-item-meta" data-exp="' + exp + '"></span></div>' +
        '<div class="auth-item-meta">授权码：<code style="color:#9af0dd;font-size:11px;">' + esc(item.code.slice(0, 22)) + '…</code></div>' +
        '<div class="auth-item-actions">' +
        '<button class="auth-mini" data-act="copy" data-code="' + esc(item.code) + '">复制</button>' +
        '<button class="auth-mini danger" data-act="revoke" data-raw="' + esc(item.raw) + '">本机作废</button>' +
        '</div>';
      listEl.appendChild(row);
      const meta = row.querySelector("[data-exp]");
      meta.textContent = expired ? "已过期 · " + expStr : "剩余 " + fmtRemain(exp - Date.now()) + " · 至 " + expStr;
    });
  }
  function renderRecoveryList() {
    const box = $("#auth-recovery-list");
    if (!box) return;
    const codes = loadRecovery();
    box.innerHTML = "";
    if (!codes.length) { box.innerHTML = '<div class="auth-empty">暂无恢复码（首次初始化时已生成，若丢失请重新生成）。</div>'; return; }
    codes.forEach(function (c) {
      const row = document.createElement("div");
      row.className = "recovery-code";
      row.innerHTML = '<code>' + esc(c.code) + '</code><button class="auth-mini" data-act="rcopy" data-code="' + esc(c.code) + '">复制</button>';
      box.appendChild(row);
    });
  }
  function fmtRemain(ms) {
    if (ms < 0) return "0";
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return d + " 天 " + h + " 时";
    if (h > 0) return h + " 时 " + m + " 分";
    return m + " 分";
  }

  function genCode() {
    const durSel = $("#auth-dur").value;
    let days;
    if (durSel === "custom") {
      days = parseFloat($("#auth-custom").value);
      if (!(days > 0)) { alert("请输入有效的自定义天数"); return; }
    } else {
      days = parseFloat(durSel);
    }
    const label = $("#auth-label").value.trim();
    const code = makeCode(days, label);
    const raw = code.split(".")[0];
    const exp = Date.now() + days * 86400000;
    $("#auth-code-text").textContent = code;
    $("#auth-code-box").style.display = "flex";
    const arr = loadGen();
    arr.unshift({ code: code, raw: raw, exp: exp, label: label, created: Date.now() });
    saveGen(arr.slice(0, 50));
    renderList();
  }

  function copyCode(code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { toast("已复制到剪贴板"); }, function () { fallbackCopy(code); });
    } else { fallbackCopy(code); }
  }
  function fallbackCopy(code) {
    const ta = document.createElement("textarea");
    ta.value = code; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("已复制到剪贴板"); } catch (e) { toast("复制失败，请手动选择"); }
    document.body.removeChild(ta);
  }
  let toastTimer;
  function toast(txt) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = txt; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function openModal() {
    renderList();
    renderRecoveryList();
    $("#auth-code-box").style.display = "none";
    modal.classList.remove("hidden");
  }
  function closeModal() { modal.classList.add("hidden"); }

  function requireOwner(cb) {
    const s = getSession();
    if (s && s.role === "owner") { cb(); }
    else { openGate(); showMsg("请先使用主密码登录", "err"); const e = $("#master-pw"); if (e) e.focus(); }
  }

  /* ====== 退出登录（销毁当前会话并回到登录界面，无需关闭浏览器） ====== */
  function doLogout() {
    try { sessionStorage.removeItem("sy_auth_session"); } catch (e) {}
    closeModal();
    ["#master-pw", "#code-input", "#recovery-input"].forEach(function (s) { const el = $(s); if (el) el.value = ""; });
    if (fab) fab.classList.add("hidden");
    showMsg("", "");
    openGate();
    const mp = $("#master-pw"); if (mp) mp.focus();
    toast("已退出登录");
  }

  /* ====== 初始化 ====== */
  function init() {
    gate = $("#login-gate"); msgEl = $("#login-msg"); clockEl = $("#login-clock");
    fab = $("#auth-fab"); modal = $("#auth-modal"); listEl = $("#auth-list");
    var clockTimeEl = $("#login-clock-time");   // 顶部显著时钟（时分秒）
    var clockDateEl = $("#login-clock-date");   // 顶部显著时钟（日期+星期）

    // 实时时钟（顶部显著展示 + 底部旧节点兜底，二者均更新）
    function tick() {
      var now = new Date();
      var t = now.toLocaleTimeString("zh-CN", { hour12: false });
      var d = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
      if (clockTimeEl) clockTimeEl.textContent = t;
      if (clockDateEl) clockDateEl.textContent = d;
      if (clockEl) clockEl.textContent = t;
    }
    tick(); setInterval(tick, 1000);

    // 显示分支：未初始化 → 初始化面板；已初始化 → 登录区
    if (!isInitialized() || !hasMaster()) {
      $("#init-pane").classList.remove("hidden");
      $("#login-area").classList.add("hidden");
      $("#reset-pane").classList.add("hidden");
    } else {
      $("#init-pane").classList.add("hidden");
      $("#login-area").classList.remove("hidden");
      $("#reset-pane").classList.add("hidden");
    }

    // 选项卡切换（仅登录区内）
    document.querySelectorAll(".ltab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".ltab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        const which = tab.getAttribute("data-tab");
        document.querySelectorAll(".ltab-pane").forEach(function (p) {
          p.classList.toggle("hidden", p.getAttribute("data-pane") !== which);
        });
        showMsg("", "");
      });
    });

    // 初始化按钮
    $("#btn-init").addEventListener("click", doInit);
    $("#btn-init-enter").addEventListener("click", function () { closeGate(); if (fab) fab.classList.remove("hidden"); });
    // 已有恢复码（换设备）入口
    $("#btn-have-recovery").addEventListener("click", function () {
      $("#init-pane").classList.add("hidden");
      $("#login-area").classList.remove("hidden");
      const t = document.querySelector('.ltab[data-tab="recovery"]');
      if (t) {
        document.querySelectorAll(".ltab").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        document.querySelectorAll(".ltab-pane").forEach(function (p) {
          p.classList.toggle("hidden", p.getAttribute("data-pane") !== "recovery");
        });
      }
      showMsg("", "");
    });
    // 重设按钮
    $("#btn-reset").addEventListener("click", doReset);
    // 登录按钮
    $("#btn-master-login").addEventListener("click", doMasterLogin);
    $("#btn-code-login").addEventListener("click", doCodeLogin);
    $("#btn-recovery-login").addEventListener("click", doRecoveryLogin);
    $("#master-pw").addEventListener("keydown", function (e) { if (e.key === "Enter") doMasterLogin(); });
    $("#code-input").addEventListener("keydown", function (e) { if (e.key === "Enter") doCodeLogin(); });
    $("#recovery-input").addEventListener("keydown", function (e) { if (e.key === "Enter") doRecoveryLogin(); });
    $("#reset-pw2").addEventListener("keydown", function (e) { if (e.key === "Enter") doReset(); });

    // 授权管理入口
    $("#btn-open-auth").addEventListener("click", function () { requireOwner(openModal); });
    if (fab) fab.addEventListener("click", function () { requireOwner(openModal); });

    // 退出登录（无需关闭浏览器即可回到登录界面）
    $("#btn-logout").addEventListener("click", doLogout);

    // 弹窗
    $("#auth-close").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    $("#auth-gen").addEventListener("click", genCode);
    $("#auth-copy").addEventListener("click", function () {
      const code = $("#auth-code-text").textContent;
      if (!code) return;
      copyCode(code);
      const b = this, old = b.textContent; b.textContent = "已复制 ✓";
      setTimeout(function () { b.textContent = old; }, 1400);
    });
    $("#auth-dur").addEventListener("change", function () {
      $("#auth-custom").style.display = this.value === "custom" ? "block" : "none";
    });
    // 重新生成恢复码
    $("#auth-regen-recovery").addEventListener("click", function () {
      const codes = genRecoveryCodes(RECOVERY_COUNT);
      saveRecovery(codes);
      renderRecoveryList();
      toast("已重新生成恢复码，旧码作废");
    });

    // 复制 / 作废 / 恢复码复制 事件委托（弹窗 + 初始化面板通用）
    document.body.addEventListener("click", function (e) {
      const btn = e.target.closest("button"); if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "copy") {
        copyCode(btn.getAttribute("data-code"));
        const old = btn.textContent; btn.textContent = "已复制";
        setTimeout(function () { btn.textContent = old; }, 1400);
      } else if (act === "rcopy") {
        copyCode(btn.getAttribute("data-code"));
        const old = btn.textContent; btn.textContent = "已复制";
        setTimeout(function () { btn.textContent = old; }, 1400);
      } else if (act === "revoke") {
        const raw = btn.getAttribute("data-raw");
        let rev = []; try { rev = JSON.parse(localStorage.getItem(LKEY_REVOKE) || "[]"); } catch (e2) {}
        if (rev.indexOf(raw) < 0) rev.push(raw);
        try { localStorage.setItem(LKEY_REVOKE, JSON.stringify(rev)); } catch (e2) {}
        const arr = loadGen().filter(function (x) { return x.raw !== raw; });
        saveGen(arr);
        renderList();
        toast("已在本机作废");
      }
    });

    // 列表倒计时刷新
    setInterval(function () {
      if (modal.classList.contains("hidden")) return;
      document.querySelectorAll("#auth-list .auth-item").forEach(function (row) {
        const meta = row.querySelector("[data-exp]");
        if (!meta) return;
        const exp = parseInt(meta.getAttribute("data-exp"), 10);
        if (exp < Date.now()) { row.classList.add("expired"); meta.textContent = "已过期 · " + new Date(exp).toLocaleString("zh-CN", { hour12: false }); }
        else { meta.textContent = "剩余 " + fmtRemain(exp - Date.now()) + " · 至 " + new Date(exp).toLocaleString("zh-CN", { hour12: false }); }
      });
    }, 30000);

    // 若已有有效会话，直接放行
    const s = getSession();
    if (s) {
      closeGate();
      if (s.role === "owner" && fab) fab.classList.remove("hidden");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
