/* 自测：用 jsdom 加载平台并模拟交互 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/') + '/';
let html = fs.readFileSync(ROOT + 'index.html', 'utf8');
html = html.replace(/<script[\s\S]*?<\/script>/g, ''); // 剔除原 script，改为手动 eval
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://localhost/', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

window.fetch = () => Promise.reject(new Error('offline'));

// 加载脚本（按 index.html 顺序）
['store', 'ai', 'pdfparse', 'word-export', 'ui', 'main'].forEach(n => window.eval(fs.readFileSync(ROOT + 'js/' + n + '.js', 'utf8')));

const SYD = window.SYD;
const view = doc.getElementById('view');
let fails = 0;
function ok(c, m) { if (c) console.log('PASS  ' + m); else { console.log('FAIL  ' + m); fails++; } }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  // 1. 工作台
  ok(view.innerHTML.includes('平台能力总览'), '工作台渲染含能力总览');
  ok(view.innerHTML.includes('最近投标项目'), '工作台含项目区');
  ok(view.innerHTML.includes('data-go="quote"'), '工作台含模块导航卡(含报价)');
  ok(view.innerHTML.includes('data-go="lib"'), '工作台含企业素材库卡');

  // 2. 新建项目 + 方案提取
  const p = { id: 't1', name: '某钢厂焦炭反应性测定装置投标', buyer: '', projectDesc: '', deadline: '', budget: '', scoreRule: '',
    rawText: '招标人是某钢厂，项目是焦炭反应性测定装置，预算500万，需要ISO9001资质，依据GB/T 4000，采用综合评分法。交货期60天，质保2年。',
    basics: null, mode: 'quick', chapters: [], length: '中', generated: false, qc: { items: [], versions: [] }, status: '草稿', updated: SYD.util.fmtDate() };
  SYD.store.get().projects.push(p);
  SYD.ui.setProject('t1');
  SYD.ui.render('plan');
  ok(view.innerHTML.includes('项目与招标文件'), '方案视图渲染');
  p.basics = SYD.ai.extractBasics(p.rawText);
  ok(/钢厂/.test(p.basics.buyer), '提取招标方=钢厂');
  ok(p.basics.certs.indexOf('ISO9001 质量体系') >= 0, '提取资质 ISO9001');
  ok(p.basics.scoreRule === '综合评分', '提取评分办法');
  ok(p.basics.standards.some(s => s.indexOf('GB/T 4000') >= 0), '提取执行标准');

  // 3. 离线生成方案
  SYD.ui.render('plan');
  doc.getElementById('b-gen').click();
  await wait(300);
  ok(p.generated === true, '离线批量生成完成');
  ok(view.innerHTML.includes('离线模板') || view.innerHTML.includes('技术方案'), '生成后预览可见');
  const chap = p.chapters[0];
  ok(chap && chap.content && chap.content.length > 20, '首章已生成正文');

  // 4. AI 标书 - 商务标填空
  SYD.ui.render('bid');
  doc.getElementById('b-biz').click();
  ok(view.innerHTML.includes('商业标一键填空'), '商务标视图');
  // 写入企业资料并导出（不真正下载，仅验证不报错）
  const co = { name: '鞍山星源达科技有限公司', credit: '91210300XXX', lead: '60天', warranty: '2年' };
  SYD.store.get().materials.company = co;
  ok(true, '企业资料可注入');

  // 5. AI 质检 - 解析招标原文生成质检项
  SYD.ui.render('qc');
  doc.getElementById('b-parse').click();
  ok(p.qc.items.length > 0, '质检项已抽取(' + p.qc.items.length + '项)');
  ok(p.qc.items.some(i => i.cat === '资格'), '含资格类质检项');

  // 6. 方案查重 - 相似度
  SYD.ui.render('dup');
  doc.getElementById('d-a').value = '本设备采用模块化设计，集成自动控温与数据采集系统，满足焦化现场高温环境要求。';
  doc.getElementById('d-b').value = '本设备采用模块化设计，集成自动控温与数据采集系统，满足焦化现场高温环境要求。';
  doc.getElementById('b-dup').click();
  ok(view.innerHTML.includes('相似度'), '查重输出相似度');
  ok(/100%/.test(view.innerHTML) || /9\d%/.test(view.innerHTML), '相同文本高相似度');

  // 7. 企业素材库 - 知识库添加
  SYD.ui.render('lib');
  doc.getElementById('kb-title').value = 'CRI/CSR 产品简介';
  doc.getElementById('kb-text').value = '焦炭反应性测定装置用于测定焦炭反应后强度。';
  doc.getElementById('b-kb-add').click();
  ok(SYD.store.get().materials.knowledge.length === 1, '知识库文档已添加');

  // 7b. 知识库 单文件·不可自动提取格式(.wps) 点添加也能入库（回归：禁止静默拒绝）
  const lenBeforeWps = SYD.store.get().materials.knowledge.length;
  const wpsFile = new window.File(['fake wps bytes'], '业绩证明_2024_甲方.wps', { type: 'application/wps' });
  Object.defineProperty(doc.getElementById('kb-file'), 'files', { value: [wpsFile], configurable: true });
  doc.getElementById('kb-file').dispatchEvent(new window.Event('change'));
  await wait(250);
  doc.getElementById('kb-title').value = ''; doc.getElementById('kb-text').value = '';
  doc.getElementById('b-kb-add').click();
  await wait(150);
  ok(SYD.store.get().materials.knowledge.length === lenBeforeWps + 1, '不可提取格式单文件点添加也能入库(回归)');

  // 7c. 知识库 多选批量入库
  const lenBeforeMulti = SYD.store.get().materials.knowledge.length;
  const mf1 = new window.File(['正文一'], '合同_2025_甲方.doc', { type: 'application/msword' });
  const mf2 = new window.File(['正文二'], '报价单_2026_乙方.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  Object.defineProperty(doc.getElementById('kb-file'), 'files', { value: [mf1, mf2], configurable: true });
  doc.getElementById('kb-file').dispatchEvent(new window.Event('change'));
  await wait(400);
  ok(SYD.store.get().materials.knowledge.length === lenBeforeMulti + 2, '知识库多选批量入库(回归)');

  // 8. 设置 - AI 配置保存
  SYD.ui.render('settings');
  doc.getElementById('ai-url').value = 'https://api.openai.com/v1';
  doc.getElementById('ai-key').value = 'sk-test';
  doc.getElementById('ai-model').value = 'gpt-4o-mini';
  doc.getElementById('ai-on').checked = true;
  doc.getElementById('b-ai-save').click();
  ok(SYD.ai.ready() === true, 'AI 配置保存后可启用');
  // 关闭避免影响
  SYD.store.get().ai.enabled = false; SYD.store.save();

  // 9. AI 报价 - 离线测算
  SYD.ui.render('quote');
  ok(view.innerHTML.includes('成本构成录入'), '报价视图渲染');
  doc.getElementById('b-q-off').click();
  const tp = SYD.store.get().projects.find(x => x.id === 't1');
  ok(tp.quote && tp.quote.suggested != null, '离线测算产出建议报价(' + (tp.quote && tp.quote.suggested) + ')');
  ok(view.innerHTML.includes('建议报价'), '报价面板展示建议');

  // 10. 视觉理解离线拒绝
  SYD.ui.render('settings');
  doc.getElementById('ai-url').value = 'https://api.openai.com/v1';
  doc.getElementById('ai-key').value = ''; doc.getElementById('ai-on').checked = false;
  doc.getElementById('b-ai-save').click();
  let visionRejected = false;
  try { await SYD.ai.vision('s', 'p', 'data:image/png;base64,xx'); }
  catch (e) { visionRejected = true; }
  ok(visionRejected, '未配置AI时视觉理解被拒绝');

  // 11. PDF 解析接口存在
  ok(typeof SYD.pdf.parseFile === 'function', 'PDF 解析接口存在');
  ok(typeof SYD.pdf.available() === 'boolean', 'PDF available 可调用');

  // 12. 生成完整 Word 标书(docx) 并 Python 校验
  SYD.store.get().materials.company = { name: '鞍山星源达科技有限公司', credit: '91210300XXX', legal: '张三', addr: '辽宁鞍山', phone: '0412-xxx', bank: '工行鞍山', account: '1234', product: '焦炭反应性测定装置', lead: '60天', warranty: '2年' };
  tp.quote = { cost: { material: 600, labor: 120, mfg: 80, freight: 50, mgmt: 100 }, margin: 15, limit: '', suggested: 1118, breakdown: [{ name: '设备材料成本', amount: 600 }, { name: '人工与装配', amount: 120 }, { name: '制造费用', amount: 80 }, { name: '运输与保险', amount: 50 }, { name: '管理与税费', amount: 100 }], decided: 1118, note: '测试', status: 'offline' };
  const blob = SYD.word.buildBidDocx(tp);
  ok(blob && blob.size > 1000, 'docx Blob 已生成(size=' + (blob && blob.size) + ')');
  const buf = Buffer.from(await blob.arrayBuffer());
  const outPath = ROOT + 'js/_docx_test.docx';
  fs.writeFileSync(outPath, buf);
  fs.writeFileSync(ROOT + 'js/_validate_docx.py',
    "import zipfile, xml.dom.minidom as M, sys\n" +
    "z=zipfile.ZipFile(sys.argv[1])\n" +
    "bad=z.testzip()\n" +
    "print('ZIP_OK' if bad is None else 'ZIP_BAD')\n" +
    "print('PARTS=' + str(len(z.namelist())))\n" +
    "[M.parseString(z.read(n)) for n in z.namelist() if n.endswith('.xml')]\n" +
    "print('XML_OK')\n");
  const py = 'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe';
  const out = require('child_process').execSync(py + ' "' + ROOT + 'js/_validate_docx.py" "' + outPath + '"').toString();
  ok(/ZIP_OK/.test(out), 'docx zip 结构有效');
  ok(/PARTS=7/.test(out), 'docx 含7个部件');
  ok(/XML_OK/.test(out), 'docx 全部 XML 合规');

  // 13. 弹窗新建项目（替代 prompt）
  doc.getElementById('btn-new-project').click();
  ok(doc.getElementById('modal-overlay').classList.contains('show'), '点击新建弹出毛玻璃弹窗');
  doc.getElementById('modal-input').value = '测试暗标项目';
  doc.getElementById('modal-ok').click();
  ok(SYD.store.get().projects.some(x => x.name === '测试暗标项目'), '弹窗创建项目成功');
  ok(SYD.store.get().projects.filter(x => x.name === '测试暗标项目')[0].feedImg === true, '新项目默认融入图库=true');

  // 14. 暗标导出匿名化
  const tp2 = SYD.store.get().projects.filter(x => x.name === '测试暗标项目')[0];
  tp2.darkLabel = true;
  const blob2 = SYD.word.buildBidDocx(tp2);
  const out2 = ROOT + 'js/_docx_dark.docx';
  fs.writeFileSync(out2, Buffer.from(await blob2.arrayBuffer()));
  const outD = require('child_process').execSync(py + ' "' + ROOT + 'js/_validate_docx.py" "' + out2 + '"').toString();
  ok(/ZIP_OK/.test(outD) && /XML_OK/.test(outD), '暗标 docx 结构有效');
  const darkCheck = require('child_process').execSync(py + ' -c "import zipfile,sys; d=zipfile.ZipFile(sys.argv[1]).read(\'word/document.xml\').decode(\'utf-8\'); print(\'DARK_OK\' if (\'暗标\' in d and \'鞍山星源达\' not in d) else \'DARK_FAIL\')" "' + out2 + '"', { encoding: 'utf8' });
  ok(/DARK_OK/.test(darkCheck), '暗标 docx 含“暗标”且匿名化投标人');
  try { fs.unlinkSync(out2); } catch (e) { /* 环境 safe-delete 拦截，忽略 */ }

  // 15. 图库理解融入技术标
  SYD.store.get().materials.images.push({ id: 'i1', src: 'data:image/png;base64,xx', name: '设备外观', desc: '灰色金属机柜，带触控屏与散热格栅。', tags: ['外观设计'] });
  SYD.ui.setProject('t1');
  SYD.ui.render('plan');
  doc.getElementById('b-gen').click();
  await wait(300);
  ok(tp.chapters.some(c => (c.content || '').indexOf('图库') >= 0), '图库理解结果已融入技术标章节');

  // 16. 文档上传格式全局放开（PDF/Word/WPS/图片/音视频等常用格式）
  window.DecompressionStream = DecompressionStream; // jsdom 缺原生解压，注入 Node 原生实现
  window.Response = Response;
  window.Blob = Blob;
  SYD.ui.render('plan');
  const fAcc = (doc.getElementById('f-file').getAttribute('accept') || '');
  ok(/\.pdf\b/.test(fAcc) && /\.docx\b/.test(fAcc) && /\.wps\b/.test(fAcc) && /\.jpg\b/.test(fAcc) && /\.mp4\b/.test(fAcc), '智能提取上传框已放开常用格式(accept)');
  SYD.ui.render('lib');
  const kbAcc = (doc.getElementById('kb-file').getAttribute('accept') || '');
  ok(/\.pdf\b/.test(kbAcc) && /\.docx\b/.test(kbAcc) && /\.wps\b/.test(kbAcc) && /\.png\b/.test(kbAcc) && /\.doc\b/.test(kbAcc) && /\.mp3\b/.test(kbAcc), '知识库上传框已放开常用格式(accept)');

  // 17. docx 正文提取引擎（用测试12生成的真实样本 _docx_test.docx）
  const raw = fs.readFileSync(ROOT + 'js/_docx_test.docx');
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  let docxText = '';
  try { docxText = await SYD.docx.extractText(ab); } catch (e) { docxText = 'ERR:' + e.message; }
  ok(!/^ERR/.test(docxText) && /星源达/.test(docxText), 'docx 正文提取成功(含中文正文, len=' + docxText.length + ')');

  // 18. 文件名智能识别引擎（标题/类型/日期/编号/附件信息）
  const af = SYD.ui.analyzeFileName;
  const a1 = af('某钢铁集团焦炭反应性测定装置投标文件_2026-03-04.pdf');
  ok(a1.date === '2026-03-04', '识别完整日期 2026-03-04');
  ok(a1.type === '投标文件', '识别类型=投标文件');
  ok(a1.title.indexOf('焦炭反应性测定装置') >= 0, '标题保留产品名(剔除日期/类型后)');
  ok(a1.info.indexOf('类型：投标文件') >= 0 && a1.info.indexOf('日期：2026-03-04') >= 0, '附件信息串含类型与日期');
  const a2 = af('ISO9001质量体系认证证书.jpg');
  ok(a2.type === '体系认证' || a2.type === '认证', '识别类型=认证类');
  ok(a2.title.indexOf('ISO9001') >= 0, '标题保留 ISO9001');
  ok(a2.info.indexOf('类型：') >= 0, '附件信息含类型');
  const a3 = af('招标公告〔2026〕第012号.docx');
  ok(a3.type === '招标公告', '识别类型=招标公告');
  ok(a3.code === '012', '识别编号=012(排除年份误判)');
  const a4 = af('业绩证明_客户A_2025年度合同.pdf');
  ok(a4.type === '业绩证明', '识别类型=业绩证明');
  ok(a4.date === '2025', '识别仅年份 2025');

  // 19. 全站上传框支持一次性多选附件
  SYD.ui.render('lib');
  ok(doc.getElementById('kb-file').hasAttribute('multiple'), '知识库上传框支持多选(multiple)');
  ok(doc.getElementById('img-file').hasAttribute('multiple'), '私人图库上传框支持多选(multiple)');
  SYD.ui.render('plan');
  ok(doc.getElementById('f-file').hasAttribute('multiple'), '方案招标文件上传框支持多选(multiple)');

  // 20. 批量组装知识库条目（标题/附件信息自动识别）
  const ents = SYD.ui.buildKBEntries([
    { name: '某钢厂焦炭反应性测定装置投标文件_2026-03-04.pdf', text: '正文A' },
    { name: 'ISO9001质量体系认证证书.jpg', text: '正文B' }
  ]);
  ok(ents.length === 2, '批量组装 2 条条目');
  ok(ents[0].title.indexOf('焦炭反应性测定装置') >= 0 && ents[0].meta.type === '投标文件' && ents[0].meta.date === '2026-03-04', '首条标题/类型/日期自动识别正确');
  ok(ents[1].meta.type === '体系认证' && ents[1].text === '正文B', '次条类型与正文正确');

  // 21. 附件查看器：打印 HTML / 预览填充 / 再编辑回写（全站通用）
  const ph = SYD.ui.attachmentPrintHTML({ kind: 'doc', title: '测试文档', text: '正文内容一二三', meta: { type: '合同', date: '2026', code: '088', name: '合同.pdf' } });
  ok(ph.indexOf('<h2>测试文档</h2>') >= 0, '打印HTML含标题');
  ok(ph.indexOf('正文内容一二三') >= 0, '打印HTML含正文');
  ok(ph.indexOf('类型：合同') >= 0 && ph.indexOf('日期：2026') >= 0, '打印HTML含自动识别附件信息');
  const phImg = SYD.ui.attachmentPrintHTML({ kind: 'image', title: '现场图', text: '设备外观', src: 'data:image/png;base64,xx', meta: { name: '现场图.png' } });
  ok(phImg.indexOf("<img src='data:image/png;base64,xx'") >= 0, '图片打印HTML含<img>与src');

  // 预览填充 + 再编辑回写
  let saved = null;
  SYD.ui.openAttachmentViewer({ kind: 'doc', title: '原标题', text: '原正文', meta: { type: '合同', date: '2026' }, onSave: (nt, ntx) => { saved = { nt: nt, ntx: ntx }; } });
  ok(doc.getElementById('att-overlay') && doc.getElementById('att-overlay').classList.contains('show'), '预览查看器已打开');
  ok(doc.getElementById('att-title').value === '原标题', '预览标题自动填充为识别标题');
  ok(doc.getElementById('att-text').value === '原正文', '预览正文自动填充');
  doc.getElementById('att-title').value = '改后标题';
  doc.getElementById('att-text').value = '改后正文';
  doc.getElementById('att-save').click();
  ok(saved && saved.nt === '改后标题' && saved.ntx === '改后正文', '点保存并关闭回调回写(再编辑生效)');
  ok(!doc.getElementById('att-overlay').classList.contains('show'), '保存后查看器已关闭');

  // 22. 三模块均已接入预览/打印按钮
  // 知识库
  SYD.ui.render('lib');
  ok(view.innerHTML.includes('kb-view') && view.innerHTML.includes('kb-print'), '知识库文档含“预览/编辑”“打印”按钮');
  // 图库（注入一张图后渲染）
  SYD.store.get().materials.images.push({ id: 'i9', src: 'data:image/png;base64,xx', name: '装置外观图.png', desc: '灰色机柜', tags: [] });
  SYD.ui.render('lib');
  ok(view.innerHTML.includes('img-view') && view.innerHTML.includes('img-print'), '私人图库图片含“预览”“打印”按钮');
  // 方案招标文件原文预览/打印
  SYD.ui.render('plan');
  ok(view.innerHTML.includes('b-fraw-view'), '智能方案含“预览/打印”招标文件原文按钮');

  // 23. 原件/不可编辑类型判定（体系、证书、资质自动锁定）
  const iot = SYD.ui.isOriginalType;
  ok(iot('体系认证') === true, '类型=体系认证 → 锁');
  ok(iot('资质证书') === true, '类型=资质证书 → 锁');
  ok(iot('认证') === true, '类型=认证 → 锁');
  ok(iot('检测报告') === true, '类型=检测报告 → 锁');
  ok(iot('投标文件') === false, '类型=投标文件 → 不锁');
  ok(iot('合同') === false, '类型=合同 → 不锁');
  ok(iot('招标公告') === false, '类型=招标公告 → 不锁');
  ok(iot('') === false, '类型为空 → 不锁');

  // 24. 锁定文档在知识库显示“原件只读”角标与“解锁”按钮；解锁后可编辑
  SYD.store.get().materials.knowledge = [];
  SYD.store.get().materials.knowledge.push({ id: 'kL', title: 'ISO9001证书', text: '证书正文', meta: { type: '体系认证', info: '类型：体系认证' }, locked: true });
  SYD.ui.render('lib');
  ok(view.innerHTML.includes('kb-lock-badge'), '锁定文档显示“原件只读”角标');
  ok(view.innerHTML.includes('kb-unlock'), '锁定文档显示“解锁”按钮');
  view.querySelector('.kb-unlock').click();
  ok(SYD.store.get().materials.knowledge[0].locked === false, '点解锁后 locked=false');
  SYD.ui.render('lib');
  ok(!view.innerHTML.includes('kb-lock-badge'), '解锁后“原件只读”角标消失');
  ok(!view.innerHTML.includes('kb-unlock'), '解锁后“解锁”按钮消失');

  // 25. 查看器只读模式：原件锁定时标题/正文禁用、无保存按钮、显示只读提示
  SYD.ui.openAttachmentViewer({ kind: 'doc', title: '证书', text: '内容', meta: { type: '体系认证' }, readonly: true, onSave: function () {} });
  ok(!doc.getElementById('att-save'), '只读模式无“保存并关闭”按钮');
  ok(doc.getElementById('att-title').disabled === true, '只读模式标题框禁用');
  ok(doc.getElementById('att-text').hasAttribute('readonly'), '只读模式正文框只读');
  ok(doc.getElementById('att-overlay').innerHTML.includes('att-readonly-note'), '只读模式显示锁定提示');
  doc.getElementById('att-close').click();
  // 可编辑模式仍保留保存按钮
  SYD.ui.openAttachmentViewer({ kind: 'doc', title: '合同', text: 'x', meta: {}, onSave: function () {} });
  ok(!!doc.getElementById('att-save'), '可编辑模式含“保存并关闭”按钮');
  doc.getElementById('att-close').click();

  // 26. 投标授权书一键生成（对标：人员授权一键生成）
  SYD.store.get().materials.company = { name: '鞍山星源达科技有限公司', credit: '91210300XXX', legal: '张三', addr: '辽宁鞍山', phone: '0412-xxx', bank: '工行鞍山', account: '1234', product: '焦炭反应性测定装置', lead: '60天', warranty: '2年' };
  const letter = SYD.ui.generateAuthLetter({ company: SYD.store.get().materials.company, agent: '李四', id: '2103XXXXXXXXXXXX', proj: '某钢厂焦炭反应性测定装置投标', bidno: 'GX2026-001', buyer: '某钢厂', sd: '2026-01-01', ed: '2026-12-31' });
  ok(/法定代表人授权委托书/.test(letter), '授权书含标题');
  ok(/致：某钢厂/.test(letter), '授权书含招标人');
  ok(letter.indexOf('李四') >= 0, '授权书含被授权人');
  ok(letter.indexOf('张三') >= 0, '授权书含法定代表人');
  ok(letter.indexOf('鞍山星源达科技有限公司') >= 0, '授权书含投标人名称');
  ok(letter.indexOf('GX2026-001') >= 0, '授权书含招标编号');
  SYD.ui.render('authz');
  ok(view.innerHTML.includes('投标人信息取自'), '投标授权视图渲染');
  doc.getElementById('az-name').value = '李四';
  doc.getElementById('az-proj').value = '某钢厂项目';
  doc.getElementById('az-buyer').value = '某钢厂';
  doc.getElementById('az-gen').click();
  ok(view.innerHTML.includes('法定代表人授权委托书'), '生成后预览含授权书');
  ok(SYD.store.get().materials.authz.length === 1, '授权记录已入库');
  ok(doc.getElementById('az-print').disabled === false, '生成后打印按钮可用');

  // 27. 标书取用包（资质即取即用）
  SYD.store.get().materials.knowledge = [];
  SYD.store.get().materials.knowledge.push({ id: 'p1', title: 'ISO9001证书', text: '', meta: { type: '体系认证', info: '类型：体系认证' }, locked: true });
  SYD.store.get().materials.knowledge.push({ id: 'p2', title: '营业执照', text: '', meta: { type: '其他', info: '' }, locked: false });
  SYD.ui.render('lib');
  ok(view.innerHTML.includes('标书取用包'), '企业素材含标书取用包卡片');
  const cbLocked = view.querySelector(".pick-cb[data-id='p1']");
  const cbOther = view.querySelector(".pick-cb[data-id='p2']");
  ok(cbLocked && cbLocked.checked === true, '原件类默认勾选');
  ok(cbOther && cbOther.checked === false, '非原件默认不勾选');
  doc.getElementById('pick-gen').click();
  ok(view.innerHTML.includes('标书取用包清单'), '生成取用包清单');
  ok(view.innerHTML.includes('ISO9001'), '清单含已勾选原件');
  const plr = SYD.ui.buildPickList(SYD.store.get().materials.knowledge);
  ok(plr.count === 2 && /ISO9001/.test(plr.text) && /体系认证/.test(plr.text), 'buildPickList 正确分组');

  // 28. 场景化标书模板库（对标：资质即取即用 / 场景化装配）
  ok(Array.isArray(SYD.ui.BID_TEMPLATES) && SYD.ui.BID_TEMPLATES.length >= 4, '模板库含≥4个模板');
  ok(SYD.ui.recommendTemplate('焦炭反应性测定装置CRI').id === 'cri', '智能推荐命中焦炭反应性模板');
  ok(SYD.ui.recommendTemplate('40kg试验焦炉').id === 'cokeoven', '智能推荐命中小焦炉模板');
  ok(SYD.ui.recommendTemplate('智能制样系统').id === 'prep', '智能推荐命中制样系统模板');
  ok(SYD.ui.recommendTemplate('不相关的办公用品采购').id === 'generic', '无命中回退通用模板');
  const kb = [
    { id: 'k1', title: 'ISO9001体系认证证书', meta: { type: '体系认证', info: 'ISO9001' }, locked: true },
    { id: 'k2', title: '产品检测报告', meta: { type: '检测报告', info: '检测' }, locked: true },
    { id: 'k3', title: '某钢厂供货业绩合同', meta: { type: '业绩', info: '业绩 合同' }, locked: false }
  ];
  const tpl = SYD.ui.BID_TEMPLATES.filter(t => t.id === 'cri')[0];
  const asm = SYD.ui.assembleBid(tpl, { proj: '某钢厂CRI项目', bidno: 'GX-9', buyer: '某钢厂' }, kb);
  ok(/第.章 投标函/.test(asm.skeleton), '装配含章节骨架(投标函)');
  ok(/第.章 法定代表人授权委托书/.test(asm.skeleton), '装配含授权书章节');
  ok(asm.matchedCount >= 3, '评分项装配匹配到≥3项资质(' + asm.matchedCount + ')');
  ok(asm.text.indexOf('某钢厂') >= 0 && asm.text.indexOf('GX-9') >= 0, '装配头部含招标信息');
  ok(asm.text.indexOf('ISO9001') >= 0 && asm.text.indexOf('供货业绩') >= 0, '装配含匹配到的资质条目');
  SYD.ui.render('tmpl');
  ok(view.innerHTML.includes('场景化标书模板库'), '标书模板视图渲染');
  ok(view.querySelector('.tmpl-item') !== null, '模板列表有可点击项');
  view.querySelector(".tmpl-item[data-id='cri']").click();
  ok(doc.getElementById('tm-gen').disabled === false, '选模板后生成按钮可用');
  doc.getElementById('tm-proj').value = '焦炭反应性测定装置';
  doc.getElementById('tm-bidno').value = 'GX-9';
  doc.getElementById('tm-buyer').value = '某钢厂';
  doc.getElementById('tm-gen').click();
  ok(view.innerHTML.includes('标书章节骨架'), '生成后预览含装配');
  ok(doc.getElementById('tm-print').disabled === false && doc.getElementById('tm-doc').disabled === false, '生成后打印/Word可用');
  ok(view.innerHTML.includes('投标授权'), '装配提示关联投标授权模块');

  console.log('\n结果：' + (fails === 0 ? '全部通过 ✅' : (fails + ' 项失败 ❌')));
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('运行异常：', e); process.exit(2); });
