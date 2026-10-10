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

/* 开发者工具用到的几个 */
export const loadYaml = () => need('js-yaml.min.js', 'jsyaml');
export const loadTurndown = () => need('turndown.min.js', 'TurndownService');
export const loadCronstrue = () => need('cronstrue-i18n.min.js', 'cronstrue');
export const loadXml = () => need('fxp.min.js', 'fxp');
export const loadSqlFormatter = () => need('sql-formatter.min.js', 'sqlFormatter');
export const loadWordCloud = () => need('wordcloud2.js', 'WordCloud');
export const loadJsQR = () => need('jsQR.js', 'jsQR');

/** 二维码生成器是 ESM，UTF-8 支持是它的一个可选补丁模块 */
let qrcodePromise = null;
export function loadQrcode() {
  if (!qrcodePromise) {
    qrcodePromise = Promise.all([
      import(vendorUrl('qrcode.mjs')),
      import(vendorUrl('qrcode_UTF8.mjs')),
    ]).then(([qr, utf8]) => {
      const qrcode = qr.default;
      // 注意：qrcode-generator 的 UTF-8 支持是**直接替换** stringToBytes，
      // 没有 stringToBytesFuncs 那种注册表；不换的话中文会编成乱码。
      qrcode.stringToBytes = utf8.stringToBytes;
      return qrcode;
    });
  }
  return qrcodePromise;
}

/**
 * opencc-js 的简繁词典。
 *
 * 两个方向的词典是两个独立的 UMD 包，各自都是 `globalThis.OpenCC = {}` ——
 * 是**覆盖**而不是合并，所以不能先后加载后一起用。
 * 这里在每次加载完成后立刻把 Converter 引用取出来存好，两个方向就都能用了。
 * 另外每个包体积差很多（cn2t 1.1MB / t2cn 107KB），所以按方向按需加载。
 */
const openccCache = new Map();
export function loadOpenCC(bundle) {
  if (!openccCache.has(bundle)) {
    openccCache.set(bundle, loadScript(`opencc/${bundle}.js`).then(() => {
      const api = globalThis.OpenCC;
      if (!api || typeof api.Converter !== 'function') {
        throw new Error('简繁词典加载失败');
      }
      return api.Converter;   // 关键：立刻取引用，否则会被下一次加载覆盖掉
    }));
  }
  return openccCache.get(bundle);
}

/** svgo 是 ESM（jsDelivr 打包版），用动态 import */
let svgoPromise = null;
export function loadSvgo() {
  if (!svgoPromise) svgoPromise = import(vendorUrl('svgo.esm.js'));
  return svgoPromise;
}

/** smol-toml 也是 ESM，且拆成了多个相对模块 */
let tomlPromise = null;
export function loadToml() {
  if (!tomlPromise) tomlPromise = import(vendorUrl('smol-toml/dist/index.js'));
  return tomlPromise;
}

/** 提前把某个工具会用到的库预热（在工具 init 里调用，减少首次操作等待） */
export function preload(...loaders) {
  return Promise.all(loaders.map((f) => f().catch(() => null)));
}
