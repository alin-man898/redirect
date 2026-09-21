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
  // 启动时尝试初始化 worker（file:// 下若失败不影响后续 UI）
  try { initWorker(); } catch (e) {}
})(window);
