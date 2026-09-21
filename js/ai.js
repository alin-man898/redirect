/* ai.js —— OpenAI 兼容大模型接入（可离线模板兜底） */
(function (global) {
  "use strict";
  var SYD = global.SYD;

  function ready() {
    var ai = SYD.store.get().ai;
    return !!(ai && ai.enabled && ai.key && ai.baseUrl);
  }

  // 调用大模型（OpenAI 兼容 /chat/completions）
  function chat(system, user, opts) {
    opts = opts || {};
    var ai = SYD.store.get().ai;
    if (!ready()) return Promise.reject(new Error("AI 未配置"));
    var body = {
      model: ai.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: system || "你是资深工业设备投标方案专家，熟悉冶金焦化行业。" },
        { role: "user", content: user }
      ],
      temperature: opts.temperature != null ? opts.temperature : 0.6
    };
    return fetch(ai.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ai.key },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("API " + r.status + "：" + t.slice(0, 200)); });
      return r.json();
    }).then(function (j) {
      return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : "";
    });
  }

  // 抽取招标文件中的结构化基础信息（离线正则兜底 + AI 增强）
  function extractBasics(text) {
    var out = { buyer: "", project: "", budget: "", deadline: "", certs: [], standards: [], scoreRule: "" };
    if (!text) return out;
    // 招标方
    var m = text.match(/(?:招标人|采购人|业主|甲方|买方)[\s:：]*([^\n，。；]{2,40})/);
    if (m) out.buyer = m[1].trim();
    // 项目名称
    m = text.match(/(?:项目名称|标的名称|采购内容)[\s:：]*([^\n，。；]{2,50})/);
    if (m) out.project = m[1].trim();
    // 预算
    m = text.match(/(?:预算|最高限价|控制价|投标限价)[\s:：]*[¥￥]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:万|元|万元)?)/);
    if (m) out.budget = m[1].trim();
    // 截止
    m = text.match(/(?:投标截止|开标|递交截止)[\s:：]*([0-9]{4}[-年/][0-9]{1,2}[-月/][0-9]{1,2}[日]?)/);
    if (m) out.deadline = m[1].replace(/[年月]/g, "-").replace("日", "");
    // 资质/标准关键词（用简称/代号前缀匹配，原文常写作“ISO9001资质”等简写）
    SYD.domain.certs.forEach(function (c) {
      var key = c.split(" ")[0];
      if (text.indexOf(key) >= 0 || text.indexOf(c) >= 0) out.certs.push(c);
    });
    SYD.domain.standards.forEach(function (s) {
      var m = s.match(/GB\/T\s*\d+/);
      if (m && text.indexOf(m[0]) >= 0) out.standards.push(s);
    });
    // 评分办法
    m = text.match(/(综合评分|最低价|合理低价|经评审)/);
    if (m) out.scoreRule = m[0];
    return out;
  }

  function readyVision() {
    var ai = SYD.store.get().ai;
    return !!(ai && ai.enabled && ai.key && ai.baseUrl);
  }

  // 多模态视觉理解：发送图片(base64 dataURL) + 文本提示，返回描述
  function vision(system, prompt, dataUrl, opts) {
    opts = opts || {};
    var ai = SYD.store.get().ai;
    if (!readyVision()) return Promise.reject(new Error("AI 未配置（视觉理解需启用并填写 Key）"));
    var content = [{ type: "text", text: prompt }];
    if (dataUrl) content.push({ type: "image_url", image_url: { url: dataUrl } });
    var body = {
      model: ai.visionModel || ai.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: system || "你是工业设备视觉识别专家，擅长为投标素材描述产品外观、结构与场景。" },
        { role: "user", content: content }
      ],
      temperature: opts.temperature != null ? opts.temperature : 0.4,
      max_tokens: opts.max_tokens || 600
    };
    return fetch(ai.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ai.key },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("API " + r.status + "：" + t.slice(0, 200)); });
      return r.json();
    }).then(function (j) {
      return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : "";
    });
  }

  // 离线报价测算：成本(各项金额) + 期望毛利率 + 招标限价 → 建议总价与分项
  function quoteComputeOffline(cost, marginPct, limit) {
    marginPct = (marginPct == null ? 15 : +marginPct);
    var keys = ["material", "labor", "mfg", "freight", "mgmt"];
    var labels = { material: "设备材料成本", labor: "人工与装配", mfg: "制造费用", freight: "运输与保险", mgmt: "管理与税费" };
    var totalCost = 0;
    keys.forEach(function (k) { totalCost += (+cost[k] || 0); });
    var suggested = totalCost / (1 - marginPct / 100);
    var capped = false, decided = suggested;
    if (limit && +limit > 0 && suggested > +limit) { decided = +limit; capped = true; }
    var breakdown = keys.map(function (k) {
      var amt = +cost[k] || 0;
      return { name: labels[k], amount: Math.round(amt * (decided / Math.max(suggested, 1)) * 100) / 100 };
    });
    var note = capped
      ? "建议报价 " + Math.round(suggested) + " 元已超出招标限价 " + limit + " 元，已按限价封顶；请复核成本或调整毛利率。"
      : "基于成本 " + Math.round(totalCost) + " 元、毛利率 " + marginPct + "% 测算，建议报价 " + Math.round(decided) + " 元。";
    return { totalCost: Math.round(totalCost), suggested: Math.round(suggested), decided: Math.round(decided), capped: capped, breakdown: breakdown, note: note };
  }

  global.SYD.ai = {
    ready: ready,
    readyVision: readyVision,
    chat: chat,
    vision: vision,
    extractBasics: extractBasics,
    quoteComputeOffline: quoteComputeOffline
  };
})(window);
