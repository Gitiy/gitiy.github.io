/**
 * 按需加载 vendor/ 下的第三方库。
 *
 * 这些都是 UMD 包（挂到 window 上），所以用 <script> 注入而不是 import()；
 * pdf.js 是真正的 ES module，用动态 import。
 *
 * 所有路径都用 new URL(..., import.meta.url) 解析成绝对地址，
 * 这样不管页面在 /tools/ 还是 /tools/xxx/ 下都能正确加载。
 */

const BASE = new URL('../../vendor/', import.meta.url);

export const vendorUrl = (rel) => new URL(rel, BASE).href;

const scriptCache = new Map();

export function loadScript(rel) {
  const href = vendorUrl(rel);
  if (scriptCache.has(href)) return scriptCache.get(href);

  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = href;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`依赖加载失败：${rel}（请检查网络或 vendor 目录）`));
    document.head.appendChild(s);
  });
  scriptCache.set(href, p);
  return p;
}

let pdfjsPromise = null;

/** pdf.js（ES module），顺带把 worker 与中日韩字体资源指到本地 vendor */
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(vendorUrl('pdf.min.mjs')).then((m) => {
      m.GlobalWorkerOptions.workerSrc = vendorUrl('pdf.worker.min.mjs');
      return m;
    });
  }
  return pdfjsPromise;
}

async function need(rel, globalName) {
  if (!globalThis[globalName]) await loadScript(rel);
  if (!globalThis[globalName]) throw new Error(`${rel} 已加载但未挂载全局变量 ${globalName}`);
  return globalThis[globalName];
}

export const loadPdfLib = () => need('pdf-lib.min.js', 'PDFLib');
export const loadJSZip = () => need('jszip.min.js', 'JSZip');
export const loadXLSX = () => need('xlsx.full.min.js', 'XLSX');
export const loadDocxPreview = () => need('docx-preview.min.js', 'docx');
export const loadHtmlToImage = () => need('html-to-image.js', 'htmlToImage');

/** 提前把某个工具会用到的库预热（在工具 init 里调用，减少首次操作等待） */
export function preload(...loaders) {
  return Promise.all(loaders.map((f) => f().catch(() => null)));
}
