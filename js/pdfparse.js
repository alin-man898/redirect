/* pdfparse.js —— 基于本地 pdf.js 的真实 PDF 文本解析（离线）
   重点：在 file:// 下浏览器常拦截独立 worker 文件，故做分层健壮性处理。 */
(function (global) {
  "use strict";

  function available() { return !!(global.pdfjsLib && global.pdfjsLib.getDocument); }

  // 分层初始化 worker：
  //  1) 优先 fetch worker 源码 → Blob URL（blob: 同源，file:// 下也能被 Worker 加载）
  //  2) 失败则退回相对路径（http / 本地服务器可用）
  //  3) 仍失败时主线程兜底，并在解析出错时提示用本地服务器打开
  function initWorker() {
    if (!available()) return false;
    try {
      var lib = global.pdfjsLib;
      if (lib.GlobalWorkerOptions && lib.GlobalWorkerOptions.workerSrc) return true;
      // 1) fetch + blob（最稳，规避 file:// 拦截）
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "js/lib/pdf.worker.min.js", false);
        xhr.send();
        if (xhr.status === 200 && xhr.responseText) {
          var url = URL.createObjectURL(new Blob([xhr.responseText], { type: "application/javascript" }));
          lib.GlobalWorkerOptions.workerSrc = url;
          return true;
        }
      } catch (e) { /* file:// 下 fetch 受限，继续 */ }
      // 2) 相对路径
      lib.GlobalWorkerOptions.workerSrc = "js/lib/pdf.worker.min.js";
      return true;
    } catch (e) { return false; }
  }

  function parseFile(file) {
    return new Promise(function (resolve, reject) {
      if (!available()) { reject(new Error("PDF 引擎未加载（js/lib/pdf.min.js 缺失或被浏览器拦截）")); return; }
      if (!global.pdfjsLib.GlobalWorkerOptions.workerSrc) initWorker();
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("文件读取失败")); };
      reader.onload = function () {
        var data = new Uint8Array(reader.result);
        parseBuffer(data).then(resolve, function (err) {
          var msg = err && err.message ? err.message : String(err);
          if (/worker/i.test(msg)) {
            msg += "；若报错来自 Worker，请用本地服务器打开：在平台文件夹内执行 python -m http.server，再访问 http://localhost:8000";
          }
          reject(new Error(msg));
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // 从 ArrayBuffer/Uint8Array 提取（可被测试复用）
  function parseBuffer(data) {
    return new Promise(function (resolve, reject) {
      if (!available()) { reject(new Error("PDF 引擎未加载")); return; }
      var loading = global.pdfjsLib.getDocument({ data: data, isEvalSupported: false, useSystemFonts: true });
      loading.promise.then(function (pdf) {
        var pages = [], count = pdf.numPages;
        function next(i) {
          if (i > count) {
            // 过滤空行，规整
            var text = pages.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
            resolve(text);
            return;
          }
          pdf.getPage(i).then(function (page) {
            return page.getTextContent();
          }).then(function (tc) {
            var str = (tc.items || []).map(function (it) { return it.str || ""; }).join(" ");
            pages.push(str);
            next(i + 1);
          }).catch(function (e) { pages.push(""); next(i + 1); });
        }
        next(1);
      }).catch(function (e) { reject(new Error("PDF 解析失败：" + (e && e.message ? e.message : e))); });
    });
  }

  global.SYD = global.SYD || {};
  global.SYD.pdf = { available: available, initWorker: initWorker, parseFile: parseFile, parseBuffer: parseBuffer };

  // ---------- DOCX(.docx) 正文提取：解析 ZIP 容器 → 抽取 word/document.xml → 还原纯文本 ----------
  // 纯前端离线实现：依靠浏览器原生 DecompressionStream 解 deflate（Edge/Chrome 103+ 均支持）
  var docx = (function () {
    function u16(v, o) { return v.getUint16(o, true); }
    function u32(v, o) { return v.getUint32(o, true); }
    function bytesToText(u8) {
      try { return new TextDecoder("utf-8").decode(u8); }
      catch (e) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return decodeURIComponent(escape(s)); }
    }
    // 从文件尾部向前找 ZIP 结束记录(EOCD)
    function findEOCD(u8, dv) {
      var lo = Math.max(0, u8.length - 22 - 65535);
      for (var i = u8.length - 22; i >= lo; i--) { if (u32(dv, i) === 0x06054b50) return i; }
      return -1;
    }
    // 原生解压 raw deflate
    function inflateRaw(u8) {
      if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("浏览器版本过低，不支持自动解压"));
      try {
        var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      } catch (e) { return Promise.reject(e); }
    }
    // document.xml → 纯文本（段落换行、制表还原、实体解码）
    function xmlToText(xml) {
      var s = xml;
      s = s.replace(/<w:tab[^>]*\/?>/g, "\t").replace(/<w:br[^>]*\/?>/g, "\n").replace(/<\/w:p>/g, "\n");
      s = s.replace(/<[^>]+>/g, "");
      s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
      s = s.replace(/&amp;/g, "&");
      s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return s;
    }
    // 从 ArrayBuffer(docx 文件内容) 提取正文文本
    function extractText(buf) {
      try {
        var u8 = new Uint8Array(buf), dv = new DataView(buf);
        var eocd = findEOCD(u8, dv);
        if (eocd < 0) return Promise.reject(new Error("不是有效的 .docx 文件"));
        var count = u16(dv, eocd + 10), cdOff = u32(dv, eocd + 16), i = cdOff, target = null;
        for (var n = 0; n < count; n++) {
          if (i + 46 > u8.length || u32(dv, i) !== 0x02014b50) break;
          var method = u16(dv, i + 10), csize = u32(dv, i + 20);
          var nameLen = u16(dv, i + 28), extraLen = u16(dv, i + 30), commLen = u16(dv, i + 32), lho = u32(dv, i + 42);
          var name = bytesToText(u8.subarray(i + 46, i + 46 + nameLen));
          if (name === "word/document.xml") {
            // 定位需用 local header 自身的文件名/扩展字段长度
            var lnLen = u16(dv, lho + 26), leLen = u16(dv, lho + 28);
            var start = lho + 30 + lnLen + leLen;
            target = { method: method, data: u8.subarray(start, start + csize) };
            break;
          }
          i += 46 + nameLen + extraLen + commLen;
        }
        if (!target) return Promise.reject(new Error("docx 中未找到正文部件(word/document.xml)"));
        var p = target.method === 8 ? inflateRaw(target.data) : Promise.resolve(target.data);
        return p.then(function (raw) { return xmlToText(bytesToText(raw)); });
      } catch (e) { return Promise.reject(e); }
    }
    function extractFile(file) {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { extractText(r.result).then(res, rej); };
        r.onerror = function () { rej(new Error("文件读取失败")); };
        r.readAsArrayBuffer(file);
      });
    }
    return { extractText: extractText, extractFile: extractFile };
  })();
  global.SYD.docx = docx;

  // 启动时尝试初始化 worker（file:// 下若失败不影响后续 UI）
  try { initWorker(); } catch (e) {}
})(window);
