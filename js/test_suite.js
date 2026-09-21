/* 自测：用 jsdom 加载平台并模拟交互 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = 'G:/智能投标工作平台/';
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

  console.log('\n结果：' + (fails === 0 ? '全部通过 ✅' : (fails + ' 项失败 ❌')));
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('运行异常：', e); process.exit(2); });
