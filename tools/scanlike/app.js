/* ============================================================
   ScanLike — 本地 PDF / 图片 扫描效果生成器
   pdf.js 渲染 + Canvas 像素处理 + pdf-lib 导出
   无水印 · 无页数/体积限制 · 可完全离线运行
   ============================================================ */

import * as pdfjsLib from './vendor/pdf.min.mjs';
import {
  MAX_PIXELS, clamp, round, makeCanvas, fmtSize, download, canvasToBlob,
  parsePageRange, zipStore, processCanvas, pageSeed,
  overlayGeometry, overlayApplies, rotationAngle,
} from './effects.js';
import { isOfficeFile, loadOffice } from './office.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const CMAP_URL = new URL('./vendor/cmaps/', import.meta.url).href;
const STD_FONT_URL = new URL('./vendor/standard_fonts/', import.meta.url).href;
const { PDFDocument } = PDFLib;

const LS_SETTINGS = 'scanlike.settings.v1';
const LS_PRESETS = 'scanlike.presets.v1';
const LS_OVERLAYS = 'scanlike.overlays.v1';
const LS_THEME = 'scanlike.theme.v1';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------- 主题 */

const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
const THEME_LABEL = { auto: '跟随系统', light: '亮色', dark: '暗色' };
const THEME_COLOR = { light: '#ffffff', dark: '#09090b' };
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const effectiveTheme = () =>
  state.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.theme;

function applyTheme() {
  const root = document.documentElement;
  // 交给 CSS 的 color-scheme 决定 light-dark() 取哪一套色值
  if (state.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.theme;

  const btn = $('btnTheme');
  if (btn) {
    btn.textContent = THEME_ICON[state.theme];
    btn.title = `主题：${THEME_LABEL[state.theme]}（点击切换）`;
    btn.setAttribute('aria-label', `主题：${THEME_LABEL[state.theme]}`);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[effectiveTheme()]);

  // 画布上的选中框等用的是脚本里取的色值，主题变了要重画
  schedulePreview();
}

function cycleTheme() {
  const i = THEMES.indexOf(state.theme);
  state.theme = THEMES[(i + 1) % THEMES.length];
  try { localStorage.setItem(LS_THEME, state.theme); } catch {}
  applyTheme();
  setStatus(`主题：${THEME_LABEL[state.theme]}`);
}

// 跟随系统时，系统切换主题要实时响应
darkQuery.addEventListener('change', () => { if (state.theme === 'auto') applyTheme(); });

/* ---------------------------------------------------------- 本地持久化 */

const IDB_NAME = 'scanlike';
const IDB_STORE = 'assets';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 把签名/印章图片存到 IndexedDB，刷新后不丢 */
async function persistAsset(id, name, canvas) {
  try {
    await idbPut({ id, name, dataUrl: canvas.toDataURL('image/png') });
    renderAssetsLine();
    await pool.syncAssets(state.assets);   // 同步给效果线程
  } catch (err) {
    console.warn('签名资源保存失败', err);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function restoreAssets() {
  let records = [];
  try {
    records = await idbAll();
  } catch (err) {
    console.warn('读取已保存的签名资源失败', err);
    return;
  }
  for (const r of records) {
    try {
      const img = await loadImage(r.dataUrl);
      const c = makeCanvas(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, 0, 0);
      state.assets.set(r.id, { name: r.name, canvas: c });
    } catch { /* 单条损坏就跳过 */ }
  }
  renderAssetsLine();
  await pool.syncAssets(state.assets);   // 恢复出来的签名也要同步给效果线程
}

function renderAssetsLine() {
  const el = $('assetsInfo');
  if (!el) return;
  const n = state.assets.size;
  el.textContent = n ? `已保存 ${n} 个签名 / 印章（刷新不丢）` : '签名与印章会自动保存，刷新后仍可用';
}

let overlaySaveTimer = 0;
function saveOverlays() {
  clearTimeout(overlaySaveTimer);
  overlaySaveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_OVERLAYS, JSON.stringify(state.overlays)); } catch {}
  }, 400);
}

function loadOverlays() {
  try {
    const raw = localStorage.getItem(LS_OVERLAYS);
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    // 引用的签名资源如果已被清空，就丢掉这条覆盖层，避免出现画不出来的空条目
    state.overlays = list.filter((o) => o.type === 'text' || state.assets.has(o.assetId));
    const maxId = state.overlays.reduce((a, o) => Math.max(a, Number(o.id) || 0), 0);
    ovUid = Math.max(ovUid, maxId);   // 防止新加的覆盖层 id 撞车
  } catch {}
}

/* ---------------------------------------------------------- 设置模型 */

const DEFAULTS = {
  rotate: 1.2,
  rotateVariance: 0.6,
  border: true,
  borderWidth: 1.6,
  edgeShadow: 35,
  noise: 24,
  blur: 0.3,
  yellowish: 22,
  brightness: 101,
  contrast: 106,
  saturation: 100,
  colorMode: 'color',
  bwThreshold: 50,
  dpi: 150,
  format: 'pdf',
  quality: 0.85,
  keepSize: true,
  pageRange: '',
  seed: 20261008,
  // PDF 元数据
  metaTitle: '',
  metaAuthor: '',
  metaSubject: '',
  metaKeywords: '',
  metaCreator: '',
  metaProducer: '',
};

const SCHEMA = [
  {
    group: '纸张与姿态',
    open: true,
    items: [
      { key: 'rotate', label: '旋转角度', type: 'range', min: 0, max: 15, step: 0.1, unit: '°' },
      { key: 'rotateVariance', label: '旋转随机抖动', type: 'range', min: 0, max: 8, step: 0.1, unit: '°' },
      { key: 'edgeShadow', label: '边缘阴影', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'border', label: '扫描边框', type: 'toggle' },
      { key: 'borderWidth', label: '边框粗细', type: 'range', min: 0.5, max: 6, step: 0.1, unit: 'px' },
    ],
  },
  {
    group: '质感与噪点',
    open: true,
    items: [
      { key: 'noise', label: '噪点强度', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'blur', label: '模糊', type: 'range', min: 0, max: 3, step: 0.05, unit: 'px' },
      { key: 'yellowish', label: '纸张泛黄', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'brightness', label: '亮度', type: 'range', min: 50, max: 150, step: 1, unit: '%' },
      { key: 'contrast', label: '对比度', type: 'range', min: 50, max: 220, step: 1, unit: '%' },
      { key: 'saturation', label: '饱和度', type: 'range', min: 0, max: 200, step: 1, unit: '%' },
    ],
  },
  {
    group: '输出设置',
    open: false,
    items: [
      {
        key: 'colorMode', label: '色彩模式', type: 'select',
        options: [['color', '彩色'], ['grayscale', '灰度'], ['bw', '黑白（传真）'], ['sepia', '复古']],
      },
      {
        key: 'bwThreshold', label: '黑白阈值', type: 'range', min: 25, max: 75, step: 1, unit: '%',
        hint: '高于此亮度的算白纸，其余压成纯黑；调高会保留更多笔迹',
        when: (s) => s.colorMode === 'bw',   // 只在黑白模式下出现
      },
      {
        key: 'dpi', label: '输出分辨率', type: 'select',
        options: [[72, '72 DPI（最小体积）'], [96, '96 DPI'], [150, '150 DPI（推荐）'], [200, '200 DPI'], [300, '300 DPI（印刷级）'], [400, '400 DPI（超大）']],
      },
      {
        key: 'format', label: '导出格式', type: 'select',
        options: [['pdf', 'PDF 文档'], ['png', 'PNG 图片（打包 zip）'], ['jpg', 'JPG 图片（打包 zip）']],
      },
      { key: 'quality', label: 'JPG 质量', type: 'range', min: 0.4, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'keepSize', label: '保持原始页面尺寸', type: 'toggle' },
      { key: 'pageRange', label: '页面范围', type: 'text', placeholder: '留空=全部，如 1-3,5,8-' },
      { key: 'seed', label: '随机种子', type: 'number', hint: '相同种子 = 相同噪点效果' },
    ],
  },
  {
    group: 'PDF 元数据',
    open: false,
    items: [
      { key: 'metaTitle', label: '标题', type: 'text', placeholder: '留空则用原文件名' },
      { key: 'metaAuthor', label: '作者', type: 'text', placeholder: '如：张三' },
      { key: 'metaSubject', label: '主题', type: 'text', placeholder: '如：合同 / 报销单' },
      { key: 'metaKeywords', label: '关键词', type: 'text', placeholder: '逗号分隔' },
      { key: 'metaCreator', label: '创建者', type: 'text', placeholder: '生成该文档的程序' },
      { key: 'metaProducer', label: '生产者', type: 'text', placeholder: '默认 ScanLike' },
    ],
  },
];

const BUILTIN_PRESETS = [
  {
    // 一键清掉全部扫描效果：页面保持原样，只做栅格化
    name: '清除所有效果',
    v: {
      rotate: 0, rotateVariance: 0, edgeShadow: 0, border: false, borderWidth: 1,
      noise: 0, blur: 0, yellowish: 0,
      brightness: 100, contrast: 100, saturation: 100,
      colorMode: 'color',
    },
  },
  { name: '轻度扫描', v: { rotate: 0.8, rotateVariance: 0.4, edgeShadow: 20, border: true, borderWidth: 1.2, noise: 14, blur: 0.2, yellowish: 12, brightness: 100, contrast: 103, saturation: 100, colorMode: 'color' } },
  { name: '标准扫描件', v: { rotate: 1.2, rotateVariance: 0.6, edgeShadow: 35, border: true, borderWidth: 1.6, noise: 24, blur: 0.3, yellowish: 22, brightness: 101, contrast: 106, saturation: 98, colorMode: 'color' } },
  { name: '老旧复印件', v: { rotate: 2.2, rotateVariance: 1.2, edgeShadow: 60, border: true, borderWidth: 2.4, noise: 46, blur: 0.55, yellowish: 62, brightness: 98, contrast: 96, saturation: 82, colorMode: 'color' } },
  { name: '复印机黑白', v: { rotate: 1.6, rotateVariance: 0.8, edgeShadow: 40, border: true, borderWidth: 2, noise: 32, blur: 0.4, yellowish: 0, brightness: 106, contrast: 165, saturation: 0, colorMode: 'grayscale' } },
  { name: '黑白传真', v: { rotate: 1.4, rotateVariance: 0.7, edgeShadow: 35, border: true, borderWidth: 2, noise: 26, blur: 0.45, yellowish: 0, brightness: 104, contrast: 210, saturation: 0, colorMode: 'bw', bwThreshold: 52 } },
  { name: '重度噪点', v: { rotate: 2.6, rotateVariance: 1.4, edgeShadow: 70, border: true, borderWidth: 2.6, noise: 72, blur: 0.75, yellowish: 40, brightness: 99, contrast: 98, saturation: 90, colorMode: 'color' } },
  { name: '复古泛黄', v: { rotate: 1.4, rotateVariance: 0.7, edgeShadow: 45, border: true, borderWidth: 1.6, noise: 30, blur: 0.4, yellowish: 85, brightness: 100, contrast: 100, saturation: 90, colorMode: 'sepia' } },
];

/* ---------------------------------------------------------- 状态 */

const state = {
  settings: { ...DEFAULTS },
  entries: [],
  currentId: null,
  page: 1,
  viewMode: 'side',
  zoom: 100,
  customPresets: [],
  theme: 'auto',         // auto | light | dark
  overlays: [],          // 签名 / 印章 / 水印
  assets: new Map(),     // id -> { name, canvas, bitmap }
  selectedOverlay: null,
  thumbsOpen: null,      // null = 自动（长文档才展开）
  thumbEntryId: null,
  thumbCache: { entryId: null, map: new Map() },
  preview: { key: '', base: null, raf: 0 },
  cancel: false,
};

const current = () => state.entries.find((e) => e.id === state.currentId) || null;

function setStatus(text, warn) {
  const el = $('statusText');
  el.textContent = text;
  el.style.color = warn ? 'var(--warning)' : '';
}

/* ---------- 消息提示 ---------- */

const TOAST_ICON = { ok: '✓', warn: '!', err: '✕' };
function toast(kind, text, detail, ms) {
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const ic = document.createElement('span');
  ic.className = 'ti';
  ic.textContent = TOAST_ICON[kind] || '!';
  const tx = document.createElement('div');
  tx.className = 'tx';
  const b = document.createElement('b');
  b.textContent = text;
  tx.appendChild(b);
  if (detail) {
    const d = document.createElement('div');
    d.style.cssText = 'color:var(--fg-2);font-size:11.5px;margin-top:3px;';
    d.textContent = detail;
    tx.appendChild(d);
  }
  const close = document.createElement('button');
  close.className = 'tclose';
  close.textContent = '✕';
  el.append(ic, tx, close);
  const kill = () => {
    el.style.transition = 'opacity .18s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  };
  close.addEventListener('click', kill);
  box.appendChild(el);
  // 同时只留最近 3 条
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(kill, ms || (kind === 'ok' ? 3200 : 9000));
}

/* ---------- 文件类型判定 ---------- */

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif)$/i;

/** 返回 'pdf' | 'office' | 'image' | null（null 表示不支持） */
function classifyFile(file) {
  const name = file.name || '';
  const type = file.type || '';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (isOfficeFile(name)) return 'office';
  if (/^image\/(png|jpeg|webp|bmp|gif)$/.test(type) || IMAGE_EXT.test(name)) return 'image';
  return null;
}

/* ---------------------------------------------------------- 文档渲染 */

async function renderSource(entry, pageNum, scale) {
  if (entry.kind === 'image') {
    const bmp = entry.bitmap;
    let w = bmp.width * scale, h = bmp.height * scale;
    if (w * h > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (w * h)); w *= k; h *= k; }
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return { canvas: c, widthPt: bmp.width * 0.75, heightPt: bmp.height * 0.75 };
  }

  if (entry.kind === 'office') {
    const o = entry.office;
    const targetW = Math.min(o.widthPt * scale, Math.sqrt(MAX_PIXELS * (o.widthPt / o.heightPt)));
    const c = await o.renderPage(pageNum - 1, targetW);
    return { canvas: c, widthPt: o.widthPt, heightPt: o.heightPt };
  }

  const page = await entry.doc.getPage(pageNum);
  const vp1 = page.getViewport({ scale: 1 });
  let s = scale;
  if (vp1.width * s * vp1.height * s > MAX_PIXELS) {
    s = Math.sqrt(MAX_PIXELS / (vp1.width * vp1.height));
  }
  const vp = page.getViewport({ scale: s });
  const c = makeCanvas(vp.width, vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return { canvas: c, widthPt: vp1.width, heightPt: vp1.height };
}

const probeCache = new Map();
async function probeSize(entry, pageNum) {
  const k = `${entry.id}|${pageNum}`;
  if (probeCache.has(k)) return probeCache.get(k);
  let info;
  if (entry.kind === 'image') {
    info = { widthPt: entry.bitmap.width * 0.75, heightPt: entry.bitmap.height * 0.75 };
  } else if (entry.kind === 'office') {
    info = { widthPt: entry.office.widthPt, heightPt: entry.office.heightPt };
  } else {
    const page = await entry.doc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    info = { widthPt: vp.width, heightPt: vp.height };
  }
  probeCache.set(k, info);
  return info;
}

/* ---------------------------------------------------------- 文件管理 */

let uid = 0;

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) {
    toast('warn', '没有检测到文件', '请拖入本机文件，而不是网页链接或选中的文字。');
    return;
  }

  // 先分类，不支持的文件立刻给出提示，不要等到最后被汇总信息盖掉
  const supported = [];
  const rejected = [];
  for (const f of files) (classifyFile(f) ? supported : rejected).push(f);
  if (rejected.length) {
    toast(
      'warn',
      `已跳过 ${rejected.length} 个不支持的文件`,
      rejected.map((f) => f.name).join('、') +
        '\n支持的格式：PDF、Word(.docx)、Excel(.xlsx/.xls/.csv)、PPT(.pptx)、PNG / JPG / WebP / BMP / GIF'
    );
  }
  if (!supported.length) {
    setStatus(`没有可添加的文件（${rejected.length} 个格式不支持）`, true);
    return;
  }

  setStatus(`正在读取 ${supported.length} 个文件…`);
  const failed = [];
  let i = 0;
  for (const file of supported) {
    i++;
    try {
      const kind = classifyFile(file);
      if (kind === 'pdf') {
        const buf = await file.arrayBuffer();
        const doc = await openPdfDocument(buf, file.name);
        state.entries.push({
          id: ++uid, kind: 'pdf', name: file.name, size: file.size,
          bytes: buf, doc, numPages: doc.numPages,
        });
      } else if (kind === 'office') {
        setStatus(`正在解析 ${file.name}（${i}/${supported.length}）…`);
        const buf = await file.arrayBuffer();
        const office = await loadOffice(buf, file.name);
        state.entries.push({
          id: ++uid, kind: 'office', name: file.name, size: file.size,
          office, numPages: office.numPages,
        });
      } else {
        const bitmap = await createImageBitmap(file);
        state.entries.push({
          id: ++uid, kind: 'image', name: file.name, size: file.size,
          bitmap, numPages: 1,
        });
      }
      if (!state.currentId) state.currentId = state.entries[0].id;
    } catch (err) {
      if (err.__cancelled) {
        setStatus(`${file.name}：${err.message}`);
        continue;
      }
      console.error(err);
      failed.push({ name: file.name, msg: err.message });
    }
  }

  if (failed.length) {
    toast(
      'err',
      `${failed.length} 个文件读取失败`,
      failed.map((f) => `${f.name}：${f.msg}`).join('\n')
    );
  }

  if (state.entries.length && !current()) state.currentId = state.entries[0].id;
  renderFileList();
  state.page = 1;
  state.preview.key = '';
  await renderPreview();

  const added = supported.length - failed.length;
  const parts = [`已加载 ${state.entries.length} 个文件`];
  if (added > 0) parts[0] = `本次新增 ${added} 个，队列共 ${state.entries.length} 个`;
  if (rejected.length) parts.push(`跳过 ${rejected.length} 个不支持`);
  if (failed.length) parts.push(`${failed.length} 个读取失败`);
  setStatus(parts.join(' · '), rejected.length > 0 || failed.length > 0);
}

function renderFileList() {
  const box = $('fileList');
  box.innerHTML = '';
  $('dropHint').style.display = state.entries.length ? 'none' : '';
  for (const e of state.entries) {
    const item = document.createElement('div');
    item.className = 'file-item' + (e.id === state.currentId ? ' on' : '');
    const nameEl = document.createElement('div');
    nameEl.className = 'fi-name';
    nameEl.title = e.name;
    nameEl.textContent = e.name;
    const metaEl = document.createElement('div');
    metaEl.className = 'fi-meta';
    metaEl.textContent = `${e.numPages} 页 · ${fmtSize(e.size)}`;
    const xEl = document.createElement('button');
    xEl.className = 'fi-x';
    xEl.title = '移除';
    xEl.textContent = '✕';
    item.append(nameEl, metaEl, xEl);

    item.addEventListener('click', async () => {
      if (state.currentId === e.id) return;
      state.currentId = e.id;
      state.page = 1;
      state.preview.key = '';
      state.thumbEntryId = null;
      renderFileList();
      await renderPreview();
    });
    xEl.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      state.entries.splice(state.entries.indexOf(e), 1);
      if (e.kind === 'image') e.bitmap.close?.();
      if (state.currentId === e.id) {
        state.currentId = state.entries[0]?.id ?? null;
        state.page = 1;
        state.preview.key = '';
        state.thumbEntryId = null;
        state.thumbCache = { entryId: null, map: new Map() };
      }
      renderFileList();
      await renderPreview();
    });
    box.appendChild(item);
  }
}

/* ---------------------------------------------------------- 效果处理线程池 */

const SCAN_WORKER_URL = new URL('./scan-worker.js', import.meta.url);

class ScanPool {
  constructor() {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.seq = 0;
    this.pending = new Map();
    this.assetBitmaps = new Map();
    this.assetPayload = {};
    this.assetVersion = 0;
    this.broken = false;
    try {
      // 留一个核给主线程，最多开 3 个，导出时可并行处理多页
      const n = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 3);
      for (let i = 0; i < n; i++) {
        const w = new Worker(SCAN_WORKER_URL, { type: 'module' });
        w.onmessage = (e) => this._done(w, e.data);
        w.onerror = (e) => {
          console.warn('效果线程异常，回退主线程：', e.message || e);
          this.broken = true;
          this._failAll();
        };
        w.__ver = -1;
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch (err) {
      console.warn('无法创建效果线程，回退主线程：', err);
      this.broken = true;
    }
  }

  get available() { return !this.broken && this.workers.length > 0; }

  /** 把签名/印章同步给各 worker（同一份 ImageBitmap 可结构化克隆给多个 worker） */
  async syncAssets(assetsMap) {
    if (!this.available) return;
    const payload = {};
    for (const [id, a] of assetsMap) {
      let bmp = this.assetBitmaps.get(id);
      if (!bmp) {
        try {
          bmp = await createImageBitmap(a.canvas);
          this.assetBitmaps.set(id, bmp);
        } catch { continue; }
      }
      payload[id] = bmp;
    }
    this.assetPayload = payload;
    this.assetVersion++;   // 推进版本，各 worker 下次领任务时会重新收到
  }

  process({ sourceCanvas, settings, scale, seed, page, overlays, fast, want, mime, quality }) {
    return new Promise(async (resolve, reject) => {
      if (!this.available) return reject(new Error('__worker_unavailable__'));
      let bitmap;
      try {
        bitmap = await createImageBitmap(sourceCanvas);
      } catch (err) {
        return reject(err);
      }
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, bitmap, settings, scale, seed, page, overlays, fast, want, mime, quality });
      this._drain();
    });
  }

  _drain() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      if (w.__ver !== this.assetVersion) {
        w.postMessage({ type: 'assets', assets: this.assetPayload });
        w.__ver = this.assetVersion;
      }
      w.postMessage({ type: 'process', ...job }, [job.bitmap]);
    }
  }

  _done(w, data) {
    this.idle.push(w);
    const p = this.pending.get(data.id);
    this.pending.delete(data.id);
    if (p) {
      if (data.ok) p.resolve(data);
      else p.reject(new Error(data.error));
    }
    this._drain();
  }

  _failAll() {
    for (const [, p] of this.pending) p.reject(new Error('__worker_unavailable__'));
    this.pending.clear();
    this.queue = [];
  }
}

const pool = new ScanPool();

/**
 * 走效果管线。返回 { bitmap | blob, meta, w, h, isCanvas? }
 * worker 不可用时自动回退到主线程同步处理。
 */
async function applyEffects(sourceCanvas, settings, scale, seed, opts = {}) {
  const want = opts.want || 'bitmap';
  if (pool.available) {
    try {
      return await pool.process({
        sourceCanvas, settings, scale, seed,
        page: opts.page, overlays: opts.overlays, fast: opts.fast,
        want, mime: opts.mime, quality: opts.quality,
      });
    } catch (err) {
      if (err.message !== '__worker_unavailable__') throw err;
    }
  }
  const out = processCanvas(sourceCanvas, settings, scale, seed, {
    overlays: opts.overlays,
    page: opts.page,
    fast: opts.fast,
    resolveImage: resolveAsset,
  });
  if (want === 'blob') {
    return {
      blob: await canvasToBlob(out, opts.mime || 'image/jpeg', opts.quality),
      meta: out.__meta, w: out.width, h: out.height,
    };
  }
  return { bitmap: out, meta: out.__meta, w: out.width, h: out.height, isCanvas: true };
}

/** 把 applyEffects 的结果统一成画布（预览要往上面画选中框） */
function effectResultToCanvas(res) {
  if (res.isCanvas) return res.bitmap;
  const c = makeCanvas(res.w, res.h);
  c.getContext('2d').drawImage(res.bitmap, 0, 0);
  res.bitmap.close?.();
  return c;
}

/* ---------------------------------------------------------- 预览 */

function computePreviewScale(baseW) {
  const stage = $('stage');
  const avail = Math.max(240, stage.clientWidth - (window.innerWidth <= 900 ? 22 : 46));
  const narrow = window.innerWidth <= 900;
  const per = state.viewMode === 'side' && !narrow ? (avail - 16) / 2 : avail;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.min(per, 1500) * (state.zoom / 100);
  return { scale: clamp((cssW / baseW) * dpr, 0.05, 4), dpr };
}

const resolveAsset = (id) => {
  const a = state.assets.get(id);
  return a ? a.canvas : null;
};
const assetRatio = (ov) => {
  const c = resolveAsset(ov.assetId);
  return c ? c.height / c.width : 1;
};

/** 页面坐标 → 合成画布坐标（含旋转） */
function pageToCanvas(px, py, canvas, meta) {
  const rad = (meta.angle * Math.PI) / 180;
  const dx = px - meta.pageW / 2, dy = py - meta.pageH / 2;
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: canvas.width / 2 + dx * c - dy * s, y: canvas.height / 2 + dx * s + dy * c };
}
/** 合成画布坐标 → 页面坐标（含反向旋转） */
function canvasToPage(cx, cy, canvas, meta) {
  const rad = (-meta.angle * Math.PI) / 180;
  const dx = cx - canvas.width / 2, dy = cy - canvas.height / 2;
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: meta.pageW / 2 + dx * c - dy * s, y: meta.pageH / 2 + dx * s + dy * c };
}

function overlayHit(ov, pageX, pageY, pageW, pageH) {
  const g = overlayGeometry(ov, pageW, pageH, ov.type === 'text' ? 1 : assetRatio(ov));
  const rad = (-g.rot * Math.PI) / 180;
  const dx = pageX - g.cx, dy = pageY - g.cy;
  const c = Math.cos(rad), s = Math.sin(rad);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  const padX = ov.type === 'text' ? g.fontPx * 0.4 : 0;
  return Math.abs(lx) <= g.w / 2 + padX && Math.abs(ly) <= g.h / 2 + padX;
}

/** 取当前主题的主色，让画布上的选中框跟着亮/暗主题走 */
function accentColor() {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2563eb';
  } catch {
    return '#2563eb';
  }
}

/** 在预览画布上画出选中覆盖层的虚线框与缩放手柄 */
function drawSelection(canvas, ov, meta) {
  if (!ov) return;
  const accent = accentColor();
  const g = overlayGeometry(ov, meta.pageW, meta.pageH, ov.type === 'text' ? 1 : assetRatio(ov));
  const ctx = canvas.getContext('2d');
  const rad = (g.rot * Math.PI) / 180;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = (sx * g.w) / 2, ly = (sy * g.h) / 2;
    const x = g.cx + lx * Math.cos(rad) - ly * Math.sin(rad);
    const y = g.cy + lx * Math.sin(rad) + ly * Math.cos(rad);
    return pageToCanvas(x, y, canvas, meta);
  });
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.beginPath();
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const h = corners[2];
  ctx.fillStyle = accent;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(h.x - 7, h.y - 7, 14, 14);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

let previewToken = 0;

async function renderPreview(opts = {}) {
  const token = ++previewToken;
  const entry = current();
  if (!entry) {
    $('empty').classList.remove('hidden');
    $('panes').classList.add('hidden');
    $('sliderCompare').classList.add('hidden');
    $('pageTotal').textContent = '/ 0';
    $('statusRight').textContent = '';
    $('pageInput').value = 1;
    $('thumbs').classList.add('hidden');
    return;
  }
  $('empty').classList.add('hidden');
  state.page = clamp(state.page, 1, entry.numPages);
  $('pageInput').value = state.page;
  $('pageTotal').textContent = `/ ${entry.numPages}`;
  $('statusRight').textContent = `${entry.name} · 第 ${state.page}/${entry.numPages} 页`;

  const info = await probeSize(entry, state.page);
  const { scale, dpr } = computePreviewScale(info.widthPt);
  const key = `${entry.id}|${state.page}|${round(scale, 4)}`;
  if (state.preview.key !== key || !state.preview.base) {
    const r = await renderSource(entry, state.page, scale);
    if (token !== previewToken) return;
    state.preview.key = key;
    state.preview.base = r.canvas;
  }

  const base = state.preview.base;
  const o = state.settings;
  const res = await applyEffects(base, o, scale, pageSeed(o, state.page), {
    overlays: state.overlays,
    page: state.page,
    fast: !!opts.fast,
  });
  if (token !== previewToken) { res.bitmap?.close?.(); return; }   // 已有更新的渲染在路上
  const processed = effectResultToCanvas(res);
  state.preview.meta = res.meta;
  state.preview.canvas = processed;

  const cssW = base.width / dpr;
  const cssH = base.height / dpr;
  const place = (canvas, host, isOriginal) => {
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.className = isOriginal ? 'compare-original' : '';
    host.replaceChildren(canvas);
  };

  const mode = state.viewMode;
  const single = mode === 'processed' || mode === 'original';
  $('panes').classList.toggle('hidden', mode !== 'side');
  $('sliderCompare').classList.toggle('hidden', mode === 'side');

  if (mode === 'side') {
    place(base, $('wrapOriginal'), true);
    place(processed, $('wrapProcessed'), false);
    $('wrapProcessed').style.cursor = 'default';
  } else if (single) {
    place(mode === 'original' ? base : processed, $('wrapSliderOriginal'), mode === 'original');
    $('clipProcessed').style.display = 'none';
    $('compareDivider').style.display = 'none';
    $('sliderCompare').style.width = '';
    $('sliderCompare').style.height = '';
  } else {
    place(base, $('wrapSliderOriginal'), true);
    place(processed, $('wrapSliderProcessed'), false);
    $('clipProcessed').style.display = '';
    $('compareDivider').style.display = '';
    $('sliderCompare').style.width = cssW + 'px';
    $('sliderCompare').style.height = cssH + 'px';
  }

  // 选中的覆盖层：画虚线框（只在可编辑的视图里）
  const editable = mode === 'side' || mode === 'processed';
  const sel = state.overlays.find((x) => x.id === state.selectedOverlay);
  const showSel = !!(sel && editable && overlayApplies(sel, state.page) && !sel.hidden);
  if (showSel) {
    drawSelection(processed, sel, state.preview.meta);
    $('wrapProcessed').style.cursor = 'move';
  }
  // 触屏设备：只有选中覆盖层时才把画布变成拖拽面，否则用户无法滚动长页面
  for (const w of [$('wrapProcessed'), $('wrapSliderOriginal')]) {
    w.classList.toggle('editing', showSel);
  }
  const count = state.overlays.filter((x) => !x.hidden && overlayApplies(x, state.page)).length;
  $('statusText').textContent = `预览 ${Math.round((scale / dpr) * 100)}% · 导出按 ${o.dpi} DPI 渲染` +
    (count ? ` · 本页 ${count} 个覆盖层` : '');

  // 缩略图条：只在切换文件时重建，翻页只更新高亮
  if (state.thumbEntryId !== entry.id) {
    state.thumbEntryId = entry.id;
    renderThumbs();
  } else {
    updateThumbActive();
  }
}

function schedulePreview(fast) {
  state.preview.fast = !!fast;
  saveOverlays();     // 覆盖层任何改动都会走到这里，防抖后落盘
  if (state.preview.raf) cancelAnimationFrame(state.preview.raf);
  state.preview.raf = requestAnimationFrame(() => {
    state.preview.raf = 0;
    const f = state.preview.fast;
    state.preview.fast = false;
    renderPreview({ fast: f }).catch((e) => console.error(e));
  });
}

/* ---------------------------------------------------------- 覆盖层 UI */

let ovUid = 0;
const OV_META = {
  sign: { icon: '✍', label: '签名' },
  stamp: { icon: '🔖', label: '印章' },
  text: { icon: 'T', label: '水印' },
};

function addOverlay(type, extra = {}) {
  const n = state.overlays.filter((o) => o.type === type).length + 1;
  const ov = {
    id: ++ovUid,
    type,
    name: `${OV_META[type].label} ${n}`,
    x: 0.5,
    y: 0.5,
    w: type === 'sign' ? 0.28 : 0.22,
    size: 0.06,
    rot: 0,
    opacity: type === 'text' ? 0.35 : 0.95,
    pages: 'all',
    page: state.page,
    pageRange: '',
    hidden: false,
    color: 'rgba(0,0,0,0.5)',
    text: '内部资料 禁止外传',
    tile: false,
    ...extra,
  };
  state.overlays.push(ov);
  state.selectedOverlay = ov.id;
  renderOverlayList();
  schedulePreview();
  return ov;
}

function selectOverlay(id) {
  state.selectedOverlay = id;
  renderOverlayList();
  schedulePreview();
}

function renderOverlayList() {
  const box = $('overlayList');
  if (!box) return;
  box.innerHTML = '';
  if (!state.overlays.length) {
    const hint = document.createElement('p');
    hint.className = 'tip';
    hint.textContent = '还没有签名或印章。可在预览图上直接拖动调整位置。';
    box.appendChild(hint);
  }
  for (const ov of state.overlays) {
    const row = document.createElement('div');
    row.className = 'ov-item' + (ov.id === state.selectedOverlay ? ' on' : '');
    const ico = document.createElement('span');
    ico.className = 'ov-ico';
    ico.textContent = OV_META[ov.type].icon;
    const nm = document.createElement('span');
    nm.className = 'ov-name';
    nm.textContent = ov.type === 'text' ? ov.text.slice(0, 10) || '水印' : ov.name;
    nm.title = nm.textContent;
    const eye = document.createElement('button');
    eye.className = 'ov-btn';
    eye.title = ov.hidden ? '显示' : '隐藏';
    eye.textContent = ov.hidden ? '◌' : '◉';
    const del = document.createElement('button');
    del.className = 'ov-btn danger';
    del.title = '删除';
    del.textContent = '✕';
    row.append(ico, nm, eye, del);
    row.addEventListener('click', (e) => {
      if (e.target === eye) { ov.hidden = !ov.hidden; renderOverlayList(); schedulePreview(); return; }
      if (e.target === del) { state.overlays = state.overlays.filter((x) => x.id !== ov.id); if (state.selectedOverlay === ov.id) state.selectedOverlay = null; renderOverlayList(); schedulePreview(); return; }
      selectOverlay(ov.id);
    });
    box.appendChild(row);
  }
  renderOverlayParams();
}

function mkSlider(label, value, min, max, step, fmt, onInput) {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  const head = document.createElement('div');
  head.className = 'ctl-head';
  const l = document.createElement('span');
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'val';
  v.textContent = fmt(value);
  head.append(l, v);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.addEventListener('input', () => {
    const nv = parseFloat(input.value);
    v.textContent = fmt(nv);
    onInput(nv);
  });
  wrap.append(head, input);
  return wrap;
}

function renderOverlayParams() {
  const box = $('overlayParams');
  if (!box) return;
  const ov = state.overlays.find((x) => x.id === state.selectedOverlay);
  if (!ov) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'ov-title';
  title.textContent = '调整：' + (ov.type === 'text' ? '文字水印' : ov.name);
  box.appendChild(title);

  if (ov.type === 'text') {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const head = document.createElement('div');
    head.className = 'ctl-head';
    const l = document.createElement('span');
    l.textContent = '文字内容';
    head.appendChild(l);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = ov.text;
    input.addEventListener('input', () => {
      ov.text = input.value;
      schedulePreview();
      const nm = $('overlayList').querySelector('.ov-item.on .ov-name');
      if (nm) nm.textContent = ov.text.slice(0, 10) || '水印';
    });
    wrap.append(head, input);
    box.appendChild(wrap);

    const colorRow = document.createElement('div');
    colorRow.className = 'ctl-row';
    const cl = document.createElement('span');
    cl.textContent = '颜色';
    const color = document.createElement('input');
    color.type = 'color';
    color.value = '#888888';
    color.addEventListener('input', () => {
      const r = parseInt(color.value.slice(1, 3), 16);
      const g = parseInt(color.value.slice(3, 5), 16);
      const b = parseInt(color.value.slice(5, 7), 16);
      ov.color = `rgba(${r},${g},${b},0.55)`;
      schedulePreview();
    });
    colorRow.append(cl, color);
    box.appendChild(colorRow);

    const tileRow = document.createElement('div');
    tileRow.className = 'ctl-row';
    const tl = document.createElement('span');
    tl.textContent = '平铺整页';
    const sw = document.createElement('label');
    sw.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!ov.tile;
    cb.addEventListener('change', () => { ov.tile = cb.checked; schedulePreview(); });
    const tr = document.createElement('span');
    tr.className = 'track';
    sw.append(cb, tr);
    tileRow.append(tl, sw);
    box.appendChild(tileRow);
  }

  box.appendChild(mkSlider('水平位置', ov.x, -0.2, 1.2, 0.005, (v) => (v * 100).toFixed(0) + '%', (v) => { ov.x = v; schedulePreview(true); }));
  box.appendChild(mkSlider('垂直位置', ov.y, -0.2, 1.2, 0.005, (v) => (v * 100).toFixed(0) + '%', (v) => { ov.y = v; schedulePreview(true); }));
  if (ov.type === 'text') {
    box.appendChild(mkSlider('字号', ov.size, 0.01, 0.3, 0.002, (v) => (v * 100).toFixed(1) + '%页宽', (v) => { ov.size = v; schedulePreview(true); }));
  } else {
    box.appendChild(mkSlider('大小', ov.w, 0.03, 1.2, 0.005, (v) => (v * 100).toFixed(0) + '%页宽', (v) => { ov.w = v; schedulePreview(true); }));
  }
  box.appendChild(mkSlider('旋转', ov.rot, -180, 180, 1, (v) => v + '°', (v) => { ov.rot = v; schedulePreview(true); }));
  box.appendChild(mkSlider('不透明度', ov.opacity, 0.05, 1, 0.01, (v) => Math.round(v * 100) + '%', (v) => { ov.opacity = v; schedulePreview(true); }));

  const pageRow = document.createElement('div');
  pageRow.className = 'ctl-row';
  const pl = document.createElement('span');
  pl.textContent = '应用页面';
  const sel = document.createElement('select');
  [['all', '全部页'], ['current', '仅当前页'], ['custom', '自定义']].forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (ov.pages === v) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { ov.pages = sel.value; renderOverlayParams(); schedulePreview(); });
  pageRow.append(pl, sel);
  box.appendChild(pageRow);

  if (ov.pages === 'custom') {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const head = document.createElement('div');
    head.className = 'ctl-head';
    const l = document.createElement('span');
    l.textContent = '页码（如 1,3-5）';
    head.appendChild(l);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = ov.pageRange;
    input.addEventListener('input', () => { ov.pageRange = input.value; schedulePreview(); });
    wrap.append(head, input);
    box.appendChild(wrap);
  }
}

/* ---------- 弹窗 ---------- */

function openModal(title, bodyEl, actions, opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const modal = document.createElement('div');
  modal.className = 'modal wide';
  const h = document.createElement('h3');
  h.textContent = title;
  modal.append(h, bodyEl);
  const row = document.createElement('div');
  row.className = 'row end';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn small' + (a.primary ? ' primary' : ' ghost');
    b.textContent = a.label;
    b.addEventListener('click', () => a.onClick(() => overlay.remove()));
    row.appendChild(b);
  }
  modal.appendChild(row);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      opts.onDismiss?.();     // 点遮罩关闭也要通知调用方，否则 await 的 Promise 永远不结束
    }
  });
  document.body.appendChild(overlay);
  return { overlay, modal };
}

/** 询问 PDF 密码（返回 null 表示用户放弃） */
function askPassword(fileName, wrong) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    const tip = document.createElement('p');
    tip.className = 'tip';
    tip.style.margin = '0 0 10px';
    tip.textContent = `「${fileName}」受密码保护，请输入打开密码。`;
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = '文档密码';
    input.autocomplete = 'off';
    wrap.appendChild(input);
    const err = document.createElement('p');
    err.className = 'err-line';
    if (!wrong) err.style.display = 'none';
    err.textContent = '密码不正确，请重新输入。';
    body.append(tip, wrap, err);

    let settled = false;
    const finish = (v, close) => {
      if (settled) return;
      settled = true;
      close?.();
      resolve(v);
    };
    const { overlay } = openModal('需要密码', body, [
      { label: '跳过此文件', onClick: (close) => finish(null, close) },
      { label: '打开文档', primary: true, onClick: (close) => finish(input.value, close) },
    ], { onDismiss: () => finish(null) });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value, () => overlay.remove()); }
    });
    setTimeout(() => input.focus(), 30);
  });
}

/** 打开 PDF，遇到加密文档时弹窗要密码 */
async function openPdfDocument(buf, fileName) {
  let cancelled = false;
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buf.slice(0)),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STD_FONT_URL,
  });
  const INCORRECT = pdfjsLib.PasswordResponses?.INCORRECT_PASSWORD ?? 2;
  task.onPassword = async (updatePassword, reason) => {
    const pwd = await askPassword(fileName, reason === INCORRECT);
    if (pwd === null) {
      cancelled = true;
      task.destroy();
      return;
    }
    updatePassword(pwd);
  };
  try {
    return await task.promise;
  } catch (err) {
    if (cancelled) {
      const e = new Error('已取消打开加密文档');
      e.__cancelled = true;
      throw e;
    }
    if (err && /password/i.test(err.name || '')) {
      const e = new Error('密码不正确，未能打开该文档');
      e.__cancelled = true;
      throw e;
    }
    throw err;
  }
}

function openSignaturePad() {
  const body = document.createElement('div');
  const pad = makeCanvas(700, 260);
  pad.className = 'sig-pad';
  pad.style.width = '100%';
  body.appendChild(pad);
  const tip = document.createElement('p');
  tip.className = 'tip';
  tip.textContent = '用鼠标或手指在框内签名，确定后会作为覆盖层加到页面上（可拖动、缩放、旋转）。';
  body.appendChild(tip);

  const ctx = pad.getContext('2d');
  let drawing = false;
  let dirty = false;
  const pos = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
  };
  pad.addEventListener('pointerdown', (e) => {
    drawing = true;
    dirty = true;
    pad.setPointerCapture(e.pointerId);
    const p = pos(e);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  ['pointerup', 'pointercancel'].forEach((t) => pad.addEventListener(t, () => (drawing = false)));

  openModal('手写签名', body, [
    { label: '清除', onClick: (close) => { ctx.clearRect(0, 0, pad.width, pad.height); dirty = false; close(); openSignaturePad(); } },
    { label: '取消', onClick: (close) => close() },
    {
      label: '确定', primary: true, onClick: (close) => {
        if (!dirty) return;
        const trimmed = trimCanvas(pad);
        const id = 'sig' + ++ovUid;
        state.assets.set(id, { name: '手写签名', canvas: trimmed });
        persistAsset(id, '手写签名', trimmed);
        close();
        addOverlay('sign', { assetId: id, w: 0.26 });
      },
    },
  ]);
}

/** 裁掉四周空白，让签名贴合 */
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (d[(y * canvas.width + x) * 4 + 3] > 8) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return canvas;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(canvas.width - 1, maxX + pad); maxY = Math.min(canvas.height - 1, maxY + pad);
  const out = makeCanvas(maxX - minX + 1, maxY - minY + 1);
  out.getContext('2d').drawImage(canvas, -minX, -minY);
  return out;
}

function openSealMaker() {
  const body = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'seal-form';
  const mk = (label, value, placeholder) => {
    const w = document.createElement('div');
    w.className = 'ctl';
    const h = document.createElement('div');
    h.className = 'ctl-head';
    const l = document.createElement('span');
    l.textContent = label;
    h.appendChild(l);
    const i = document.createElement('input');
    i.type = 'text';
    i.value = value;
    i.placeholder = placeholder || '';
    w.append(h, i);
    grid.appendChild(w);
    return i;
  };
  const l1 = mk('环形文字（公司/单位名）', '示例科技有限公司');
  const l2 = mk('下方文字', '合同专用章');
  body.appendChild(grid);
  const preview = makeCanvas(220, 220);
  preview.className = 'seal-preview';
  body.appendChild(preview);
  const redraw = () => {
    const c = makeSeal({ line1: l1.value, line2: l2.value });
    preview.width = c.width; preview.height = c.height;
    preview.getContext('2d').drawImage(c, 0, 0);
  };
  l1.addEventListener('input', redraw);
  l2.addEventListener('input', redraw);
  redraw();

  openModal('生成印章', body, [
    { label: '取消', onClick: (close) => close() },
    {
      label: '确定', primary: true, onClick: (close) => {
        const c = makeSeal({ line1: l1.value, line2: l2.value });
        const id = 'seal' + ++ovUid;
        const nm = l1.value.slice(0, 8) + '印章';
        state.assets.set(id, { name: nm, canvas: c });
        persistAsset(id, nm, c);
        close();
        addOverlay('stamp', { assetId: id, w: 0.2 });
      },
    },
  ]);
}

/** 生成圆形印章（上方环形文字 + 五角星 + 下方横排文字） */
function makeSeal({ line1, line2, color = '#c8281e', size = 440 }) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2, R = size * 0.44;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.032;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // 五角星
  const sr = size * 0.145;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? sr * 0.42 : sr;
    const x = cx + Math.cos(ang) * rr, y = cy - size * 0.03 + Math.sin(ang) * rr;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // 上弧文字
  const chars = [...(line1 || '')];
  if (chars.length) {
    const fontPx = size * (chars.length > 11 ? 0.082 : 0.098);
    ctx.font = `700 ${fontPx}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const arcR = R * 0.78;
    const total = chars.length * (fontPx * 1.12);
    const start = -Math.PI / 2 - (total / arcR) / 2 + (fontPx * 1.12) / arcR / 2;
    chars.forEach((ch, i) => {
      const a = start + (i * (fontPx * 1.12)) / arcR;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * arcR, cy + Math.sin(a) * arcR);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  }

  // 下方横排
  if (line2) {
    const fs = size * 0.1;
    ctx.font = `700 ${fs}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(line2, cx, cy + R * 0.56);
    const w = ctx.measureText(line2).width;
    ctx.fillRect(cx - w / 2 - size * 0.03, cy + R * 0.56 + fs * 0.62, w + size * 0.06, size * 0.012);
  }
  return c;
}

function importMarkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = makeCanvas(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------------------------------------------------------- 覆盖层拖拽 */

function attachOverlayDrag(wrap) {
  let drag = null;
  const toPage = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * canvas.width;
    const cy = ((e.clientY - r.top) / r.height) * canvas.height;
    return { p: canvasToPage(cx, cy, canvas, state.preview.meta), rect: r, cx, cy };
  };

  wrap.addEventListener('pointerdown', (e) => {
    const canvas = wrap.querySelector('canvas');
    const meta = state.preview.meta;
    if (!canvas || !meta) return;
    if (state.viewMode === 'original' || state.viewMode === 'slider') return;
    const { p, rect } = toPage(e, canvas);
    let hit = null;
    for (let i = state.overlays.length - 1; i >= 0; i--) {
      const ov = state.overlays[i];
      if (ov.hidden || !overlayApplies(ov, state.page)) continue;
      if (overlayHit(ov, p.x, p.y, meta.pageW, meta.pageH)) { hit = ov; break; }
    }
    if (!hit) {
      if (state.selectedOverlay) selectOverlay(null);
      return;
    }
    if (state.selectedOverlay !== hit.id) selectOverlay(hit.id);

    // 判断是否按在右下角手柄上
    const g = overlayGeometry(hit, meta.pageW, meta.pageH, hit.type === 'text' ? 1 : assetRatio(hit));
    const rad = (g.rot * Math.PI) / 180;
    const hx = g.cx + (g.w / 2) * Math.cos(rad) - (g.h / 2) * Math.sin(rad);
    const hy = g.cy + (g.w / 2) * Math.sin(rad) + (g.h / 2) * Math.cos(rad);
    const hp = pageToCanvas(hx, hy, canvas, meta);
    const hcss = { x: rect.left + (hp.x / canvas.width) * rect.width, y: rect.top + (hp.y / canvas.height) * rect.height };
    const mode = Math.hypot(e.clientX - hcss.x, e.clientY - hcss.y) < 16 ? 'resize' : 'move';

    drag = {
      ov: hit, mode, canvas,
      start: p, x0: hit.x, y0: hit.y, w0: hit.w, size0: hit.size,
      d0: Math.hypot(p.x - g.cx, p.y - g.cy),
    };
    try { wrap.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const meta = state.preview.meta;
    const { p } = toPage(e, drag.canvas);
    if (drag.mode === 'move') {
      drag.ov.x = clamp(drag.x0 + (p.x - drag.start.x) / meta.pageW, -0.3, 1.3);
      drag.ov.y = clamp(drag.y0 + (p.y - drag.start.y) / meta.pageH, -0.3, 1.3);
    } else {
      const g = overlayGeometry(drag.ov, meta.pageW, meta.pageH, drag.ov.type === 'text' ? 1 : assetRatio(drag.ov));
      const d1 = Math.hypot(p.x - g.cx, p.y - g.cy);
      const k = drag.d0 > 2 ? d1 / drag.d0 : 1;
      if (drag.ov.type === 'text') drag.ov.size = clamp(drag.size0 * k, 0.008, 0.5);
      else drag.ov.w = clamp(drag.w0 * k, 0.02, 2);
    }
    schedulePreview(true);
  });

  const end = () => {
    if (!drag) return;
    drag = null;
    renderOverlayParams();
    schedulePreview(false);
  };
  ['pointerup', 'pointercancel'].forEach((t) => wrap.addEventListener(t, end));
}

/* ---------------------------------------------------------- 设置面板 */

function buildSettingsUI() {
  const root = $('settingsRoot');
  root.innerHTML = '';
  for (const g of SCHEMA) {
    const d = document.createElement('details');
    d.className = 'group';
    if (g.open) d.open = true;
    const sum = document.createElement('summary');
    sum.textContent = g.group;
    d.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'group-body';

    for (const it of g.items) {
      if (it.when && !it.when(state.settings)) continue;   // 条件项：不满足就整条不渲染
      const v = state.settings[it.key];
      if (it.type === 'range') {
        const wrap = document.createElement('div');
        wrap.className = 'ctl';
        const head = document.createElement('div');
        head.className = 'ctl-head';
        const lab = document.createElement('span');
        lab.textContent = it.label;
        const val = document.createElement('span');
        val.className = 'val';
        val.id = 'v_' + it.key;
        val.textContent = (it.fmt ? it.fmt(v) : round(v, 2)) + (it.unit || '');
        head.append(lab, val);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = it.min; input.max = it.max; input.step = it.step; input.value = v;
        input.addEventListener('input', () => {
          state.settings[it.key] = parseFloat(input.value);
          val.textContent = (it.fmt ? it.fmt(input.value) : round(input.value, 2)) + (it.unit || '');
          saveSettings();
          schedulePreview();
        });
        wrap.append(head, input);
        if (it.hint) {
          const hint = document.createElement('div');
          hint.className = 'ctl-hint';
          hint.textContent = it.hint;
          wrap.appendChild(hint);
        }
        body.appendChild(wrap);
      } else if (it.type === 'toggle') {
        const row = document.createElement('div');
        row.className = 'ctl-row';
        const lab = document.createElement('span');
        lab.textContent = it.label;
        const sw = document.createElement('label');
        sw.className = 'switch';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!v;
        cb.addEventListener('change', () => {
          state.settings[it.key] = cb.checked;
          saveSettings();
          schedulePreview();
        });
        const tr = document.createElement('span');
        tr.className = 'track';
        sw.append(cb, tr);
        row.append(lab, sw);
        body.appendChild(row);
      } else if (it.type === 'select') {
        const row = document.createElement('div');
        row.className = 'ctl-row';
        const lab = document.createElement('span');
        lab.textContent = it.label;
        const sel = document.createElement('select');
        for (const [val, text] of it.options) {
          const opt = document.createElement('option');
          opt.value = String(val);
          opt.textContent = text;
          if (String(val) === String(v)) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => {
          const prev = state.settings[it.key];
          state.settings[it.key] = it.key === 'dpi' ? parseInt(sel.value, 10) : sel.value;
          saveSettings();
          // 色彩模式决定"黑白阈值"这一项是否出现，需要重建面板
          if (it.key === 'colorMode' && prev !== sel.value) rebuildSettingsUI();
          schedulePreview();
        });
        row.append(lab, sel);
        body.appendChild(row);
      } else if (it.type === 'text') {
        const wrap = document.createElement('div');
        wrap.className = 'ctl';
        const head = document.createElement('div');
        head.className = 'ctl-head';
        const lab = document.createElement('span');
        lab.textContent = it.label;
        head.appendChild(lab);
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = it.placeholder || '';
        input.value = v || '';
        input.addEventListener('input', () => {
          state.settings[it.key] = input.value;
          saveSettings();
        });
        wrap.append(head, input);
        body.appendChild(wrap);
      } else if (it.type === 'number') {
        const row = document.createElement('div');
        row.className = 'ctl-row';
        const lab = document.createElement('span');
        lab.textContent = it.label;
        if (it.hint) lab.title = it.hint;
        const input = document.createElement('input');
        input.type = 'number';
        input.value = v;
        input.addEventListener('input', () => {
          state.settings[it.key] = parseInt(input.value, 10) || 0;
          saveSettings();
          schedulePreview();
        });
        row.append(lab, input);
        body.appendChild(row);
      }
    }
    d.appendChild(body);
    root.appendChild(d);
  }
}

function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch {}
}

/** 重建设置面板，同时保留各分组的展开/收起状态 */
function rebuildSettingsUI() {
  const open = [...document.querySelectorAll('#settingsRoot details.group')].map((d) => d.open);
  buildSettingsUI();
  [...document.querySelectorAll('#settingsRoot details.group')].forEach((d, i) => {
    if (open[i] !== undefined) d.open = open[i];
  });
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch {}
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    if (raw) state.customPresets = JSON.parse(raw);
  } catch {}
  try {
    const t = localStorage.getItem(LS_THEME);
    if (THEMES.includes(t)) state.theme = t;
  } catch {}
}

function renderPresets() {
  const sel = $('presetSelect');
  sel.innerHTML = '<option value="">— 选择预设 —</option>';
  for (const p of BUILTIN_PRESETS) {
    const o = document.createElement('option');
    o.value = 'b:' + p.name;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  for (const p of state.customPresets) {
    const o = document.createElement('option');
    o.value = 'c:' + p.name;
    o.textContent = '★ ' + p.name + (p.overlays?.length ? ` ⊕${p.overlays.length}` : '');
    o.title = p.overlays?.length ? `包含 ${p.overlays.length} 个签名 / 印章 / 水印` : '';
    sel.appendChild(o);
  }
}

/* ---------------------------------------------------------- 页面缩略图 */

const THUMB_W = 66, THUMB_H = 92, THUMB_DPR = 2;
let thumbToken = 0;
let thumbObserver = null;

function thumbsWanted() {
  const entry = current();
  if (!entry) return false;
  if (state.thumbsOpen === null || state.thumbsOpen === undefined) return entry.numPages > 8;   // 长文档默认展开
  return !!state.thumbsOpen;
}

function updateThumbActive() {
  const strip = $('thumbs');
  const inner = $('thumbsInner');
  if (!inner || strip.classList.contains('hidden')) return;
  for (const el of inner.children) {
    const on = Number(el.dataset.page) === state.page;
    el.classList.toggle('on', on);
    if (on) el.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

async function renderThumbs() {
  const entry = current();
  const strip = $('thumbs');
  const inner = $('thumbsInner');
  if (!entry) { strip.classList.add('hidden'); return; }
  const show = thumbsWanted();
  strip.classList.toggle('hidden', !show);
  $('btnThumbs').classList.toggle('on', show);
  if (!show) return;

  const token = ++thumbToken;
  thumbObserver?.disconnect();
  inner.innerHTML = '';
  if (state.thumbCache.entryId !== entry.id) {
    state.thumbCache = { entryId: entry.id, map: new Map() };
  }

  const items = [];
  for (let p = 1; p <= entry.numPages; p++) {
    const el = document.createElement('button');
    el.className = 'thumb';
    el.dataset.page = p;
    el.style.cssText = `width:${THUMB_W}px;height:${THUMB_H}px`;
    const ph = document.createElement('div');
    ph.className = 'thumb-ph';
    ph.style.cssText = `width:${THUMB_W}px;height:${THUMB_H}px`;
    const n = document.createElement('span');
    n.className = 'thumb-n';
    n.textContent = p;
    el.append(ph, n);
    el.addEventListener('click', () => {
      if (state.page === p) return;
      state.page = p;
      renderPreview();
    });
    inner.appendChild(el);
    items.push(el);
  }

  // 只渲染滚进可视范围的缩略图，几百页也不会一次性卡住
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      thumbObserver.unobserve(en.target);
      paintThumb(entry, Number(en.target.dataset.page), en.target, token);
    }
  }, { root: inner, rootMargin: '300px' });
  items.forEach((el) => thumbObserver.observe(el));
  updateThumbActive();
}

async function paintThumb(entry, page, el, token) {
  try {
    let c = state.thumbCache.map.get(page);
    if (!c) {
      const info = await probeSize(entry, page);
      const { canvas: src } = await renderSource(entry, page, (THUMB_H * THUMB_DPR) / info.heightPt);
      if (token !== thumbToken) { src.width = src.height = 1; return; }
      c = makeCanvas(THUMB_W * THUMB_DPR, THUMB_H * THUMB_DPR);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / src.width, c.height / src.height);
      const w = src.width * s, h = src.height * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
      src.width = src.height = 1;
      state.thumbCache.map.set(page, c);
    }
    if (token !== thumbToken) return;
    const disp = c.cloneNode(true);
    disp.style.cssText = `width:${THUMB_W}px;height:${THUMB_H}px`;
    const ph = el.querySelector('.thumb-ph');
    if (ph) ph.replaceWith(disp);
  } catch (err) {
    console.warn('缩略图渲染失败 第' + page + '页', err);
  }
}

/* ---------------------------------------------------------- 导出 */

function showOverlay(title) {
  $('overlay').classList.remove('hidden');
  $('ovTitle').textContent = title;
  $('ovBar').style.width = '0%';
  $('ovText').textContent = '';
  state.cancel = false;
}
const setProgress = (p, text) => {
  $('ovBar').style.width = clamp(p * 100, 0, 100).toFixed(1) + '%';
  if (text) $('ovText').textContent = text;
};
const hideOverlay = () => $('overlay').classList.add('hidden');

function checkCancel() {
  if (state.cancel) throw new Error('__cancelled__');
}

const mimeOf = (name) =>
  /\.png$/i.test(name) ? 'image/png'
  : /\.jpe?g$/i.test(name) ? 'image/jpeg'
  : /\.zip$/i.test(name) ? 'application/zip'
  : 'application/pdf';

/** 打包名带上格式、份数与时间，避免连续导出互相覆盖 */
function zipName(entries, count, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  if (entries.length === 1 && count > 1) {
    return `${entries[0].name.replace(/\.[^.]+$/, '')}_扫描图片_${String(ext || '').toUpperCase()}_${count}张.zip`;
  }
  return `扫描结果_${entries.length}份_${stamp}.zip`;
}

/**
 * 多页流水线：主线程渲染第 N+1 页的同时，让 worker 处理已提交的第 N 页，
 * 两者不再互相等待（原来是一页渲染完→等 worker→再渲染下一页）。
 * 同时按像素预算限制在内存里的页数，避免超大页面把内存吃满。
 * @returns 按页码顺序排列的结果数组
 */
async function runPagePipeline(entry, pages, onProgress, onEach) {
  const o = state.settings;
  const scale = o.dpi / 72;
  const info = await probeSize(entry, pages[0]);
  const pxPerPage = info.widthPt * scale * info.heightPt * scale;
  const maxWorkers = pool.available ? pool.workers.length : 1;
  const windowSize = Math.max(1, Math.min(maxWorkers, Math.floor(60e6 / Math.max(1, pxPerPage))));

  const results = new Array(pages.length);
  const running = new Set();
  let next = 0, done = 0;

  const start = () => {
    if (next >= pages.length) return;
    const idx = next++;
    const task = (async () => {
      const pageNum = pages[idx];
      const { canvas, widthPt, heightPt } = await renderSource(entry, pageNum, scale);
      const res = await applyEffects(canvas, o, scale, pageSeed(o, pageNum), {
        overlays: state.overlays,
        page: pageNum,
        want: 'blob',
        mime: o.format === 'png' ? 'image/png' : 'image/jpeg',
        quality: o.quality,
      });
      canvas.width = canvas.height = 1;
      const r = { idx, pageNum, res, widthPt, heightPt };
      results[idx] = r;
      if (onEach) await onEach(r);
      done++;
      onProgress?.(done / pages.length, `${entry.name} · 第 ${r.pageNum} 页`);
    })();
    const tracked = task.finally(() => running.delete(tracked));
    running.add(tracked);
  };

  for (let i = 0; i < windowSize; i++) start();
  while (running.size) {
    checkCancel();
    await Promise.race([...running]);
    start();
  }
  return results;
}

async function buildPdf(entry, pages, onProgress) {
  const o = state.settings;
  const out = await PDFDocument.create();
  const useJpg = o.quality < 1;

  const results = await runPagePipeline(entry, pages, onProgress, async (r) => {
    const bytes = new Uint8Array(await r.res.blob.arrayBuffer());
    r.img = useJpg ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    r.w = r.res.w;
    r.h = r.res.h;
    r.res = null;   // 及早释放 blob
  });

  for (const r of results) {
    if (!r || !r.img) continue;
    const pw = o.keepSize ? r.widthPt : (r.w * 72) / o.dpi;
    const ph = o.keepSize ? r.heightPt : (r.h * 72) / o.dpi;
    const page = out.addPage([pw, ph]);
    page.drawImage(r.img, { x: 0, y: 0, width: pw, height: ph });
  }
  const base = entry.name.replace(/\.[^.]+$/, '');
  out.setTitle(o.metaTitle.trim() || base + ' (scanned)');
  if (o.metaAuthor.trim()) out.setAuthor(o.metaAuthor.trim());
  if (o.metaSubject.trim()) out.setSubject(o.metaSubject.trim());
  if (o.metaKeywords.trim()) out.setKeywords(o.metaKeywords.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean));
  out.setCreator(o.metaCreator.trim() || 'ScanLike · local scanned-PDF generator');
  out.setProducer(o.metaProducer.trim() || 'ScanLike');
  out.setCreationDate(new Date());
  out.setModificationDate(new Date());
  return await out.save();
}

async function buildImages(entry, pages, onProgress) {
  const o = state.settings;
  const ext = o.format === 'png' ? 'png' : 'jpg';
  const base = entry.name.replace(/\.[^.]+$/, '');
  const files = [];
  const results = await runPagePipeline(entry, pages, onProgress, async (r) => {
    r.data = new Uint8Array(await r.res.blob.arrayBuffer());
    r.res = null;
  });
  for (const r of results) {
    if (!r || !r.data) continue;
    const name = pages.length > 1 ? `${base}_扫描_${r.pageNum}.${ext}` : `${base}_扫描.${ext}`;
    files.push({ name, data: r.data });
  }
  return files;
}

async function exportEntries(entries) {
  const o = state.settings;
  if (!entries.length) return;
  showOverlay(entries.length > 1 ? '正在导出全部文件…' : '正在导出…');
  const outputs = [];
  try {
    const totalPages = entries.reduce((a, e) => a + parsePageRange(o.pageRange, e.numPages).length, 0) || 1;
    let done = 0;
    for (const entry of entries) {
      const pages = parsePageRange(o.pageRange, entry.numPages);
      if (!pages.length) { setStatus(`${entry.name}：页面范围为空，已跳过`, true); continue; }
      const onP = (p, text) => setProgress((done + p * pages.length) / totalPages, text);
      if (o.format === 'pdf') {
        const bytes = await buildPdf(entry, pages, onP);
        outputs.push({ name: entry.name.replace(/\.[^.]+$/, '') + '_扫描.pdf', data: bytes });
      } else {
        outputs.push(...(await buildImages(entry, pages, onP)));
      }
      done += pages.length;
      setProgress(done / totalPages, entry.name + ' 完成');
    }
    checkCancel();
    setProgress(1, '正在写出文件…');
    if (outputs.length === 1) {
      download(new Blob([outputs[0].data], { type: mimeOf(outputs[0].name) }), outputs[0].name);
    } else if (outputs.length > 1) {
      download(zipStore(outputs), zipName(entries, outputs.length, o.format));
    }
    if (!outputs.length) setStatus('没有可导出的页面，请检查「页面范围」设置', true);
    else setStatus(`导出完成：${outputs.length} 个文件`);
  } catch (err) {
    if (err.message === '__cancelled__') setStatus('已取消导出');
    else { console.error(err); setStatus('导出失败：' + err.message, true); }
  } finally {
    hideOverlay();
  }
}

/* ---------------------------------------------------------- 事件绑定 */

function bind() {
  $('btnAdd').addEventListener('click', () => $('fileInput').click());
  $('btnAdd2').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });

  /* ---------- 拖拽添加 ---------- */
  const dropOverlay = $('dropOverlay');
  const dropReject = $('dropReject');
  let dragDepth = 0;

  // 拖动过程中就检查格式，提前告诉用户哪些会被跳过
  const inspectDrag = (e) => {
    let total = 0, bad = 0;
    const items = e.dataTransfer?.items;
    if (items && items.length) {
      for (const it of items) {
        if (it.kind !== 'file') continue;
        total++;
        let f = null;
        try { f = it.getAsFile(); } catch {}
        if (f && !classifyFile(f)) bad++;
      }
    }
    return { total, bad };
  };
  const showDropState = (e) => {
    const info = inspectDrag(e);
    if (info.total && info.bad === info.total) {
      dropReject.textContent = `这 ${info.total} 个文件格式都不支持，松开后会被跳过`;
      dropReject.style.display = '';
    } else if (info.bad) {
      dropReject.textContent = `其中 ${info.bad} 个格式不支持，会被跳过`;
      dropReject.style.display = '';
    } else {
      dropReject.style.display = 'none';
    }
  };

  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragDepth++;
    showDropState(e);
    dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dropOverlay.classList.contains('hidden')) {
      dragDepth = 1;
      showDropState(e);
      dropOverlay.classList.remove('hidden');
    }
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 || e.relatedTarget === null) {
      dragDepth = 0;
      dropOverlay.classList.add('hidden');
    }
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.add('hidden');
    const files = e.dataTransfer?.files;
    if (files && files.length) await addFiles(files);
    else toast('warn', '没有检测到文件', '请拖入本机文件，而不是网页链接或选中的文字。');
  });

  $('btnClearFiles').addEventListener('click', async () => {
    for (const e of state.entries) if (e.kind === 'image') e.bitmap.close?.();
    state.entries = [];
    state.currentId = null;
    state.page = 1;
    state.preview.key = '';
    state.thumbEntryId = null;
    state.thumbCache = { entryId: null, map: new Map() };
    thumbObserver?.disconnect();
    probeCache.clear();
    renderFileList();
    await renderPreview();
    setStatus('已清空');
  });

  $('viewMode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.viewMode = b.dataset.mode;
    [...$('viewMode').children].forEach((x) => x.classList.toggle('on', x === b));
    state.preview.key = '';
    schedulePreview();
  });

  $('prevPage').addEventListener('click', async () => {
    if (!current() || state.page <= 1) return;
    state.page--;
    await renderPreview();
  });
  $('nextPage').addEventListener('click', async () => {
    const entry = current();
    if (!entry || state.page >= entry.numPages) return;
    state.page++;
    await renderPreview();
  });
  $('pageInput').addEventListener('change', async () => {
    const entry = current();
    if (!entry) return;
    state.page = clamp(parseInt($('pageInput').value, 10) || 1, 1, entry.numPages);
    await renderPreview();
  });

  $('zoom').addEventListener('input', () => {
    state.zoom = parseInt($('zoom').value, 10);
    $('zoomVal').textContent = state.zoom + '%';
    state.preview.key = '';
    schedulePreview();
  });

  $('btnThumbs').addEventListener('click', () => {
    state.thumbsOpen = !thumbsWanted();
    renderThumbs();
  });

  const sc = $('sliderCompare');
  const divider = $('compareDivider');
  const clip = $('clipProcessed');
  let dragging = false;
  const moveTo = (clientX) => {
    const r = sc.getBoundingClientRect();
    const pct = clamp(((clientX - r.left) / r.width) * 100, 0, 100);
    clip.style.width = pct + '%';
    divider.style.left = pct + '%';
  };
  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { divider.setPointerCapture(e.pointerId); } catch {}
  });
  divider.addEventListener('pointermove', (e) => dragging && moveTo(e.clientX));
  divider.addEventListener('pointerup', () => (dragging = false));
  divider.addEventListener('pointercancel', () => (dragging = false));
  sc.addEventListener('pointerdown', (e) => {
    if (divider.contains(e.target)) return;
    moveTo(e.clientX);
  });

  $('btnExport').addEventListener('click', () => {
    const entry = current();
    if (!entry) return setStatus('请先添加文件', true);
    exportEntries([entry]);
  });
  $('btnExportAll').addEventListener('click', () => {
    if (!state.entries.length) return setStatus('请先添加文件', true);
    exportEntries([...state.entries]);
  });
  $('ovCancel').addEventListener('click', () => {
    state.cancel = true;
    $('ovText').textContent = '正在取消…';
  });

  $('btnReset').addEventListener('click', async () => {
    state.settings = { ...DEFAULTS };
    buildSettingsUI();
    $('presetSelect').value = '';
    saveSettings();
    await renderPreview();
  });

  /* ---------- 覆盖层 ---------- */
  $('btnSign').addEventListener('click', openSignaturePad);
  $('btnMakeSeal').addEventListener('click', openSealMaker);
  $('btnAddTextWm').addEventListener('click', () => addOverlay('text'));
  $('btnUploadMark').addEventListener('click', () => $('markInput').click());
  $('markInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const c = await importMarkImage(f);
      const id = 'mark' + ++ovUid;
      const nm = f.name.replace(/\.[^.]+$/, '').slice(0, 14) || '图片印章';
      state.assets.set(id, { name: nm, canvas: c });
      persistAsset(id, nm, c);
      addOverlay('stamp', { assetId: id });
      setStatus(`已添加印章/签名：${f.name}`);
    } catch (err) {
      setStatus('图片读取失败：' + err.message, true);
    }
  });

  $('btnClearAssets').addEventListener('click', async () => {
    if (!state.assets.size) return setStatus('没有已保存的签名或印章');
    if (!confirm(`确定清空已保存的 ${state.assets.size} 个签名 / 印章？\n引用了它们的覆盖层也会一并移除。`)) return;
    state.assets.clear();
    state.overlays = state.overlays.filter((o) => o.type === 'text');
    state.selectedOverlay = null;
    try { await idbClear(); } catch {}
    await pool.syncAssets(state.assets);
    renderAssetsLine();
    renderOverlayList();
    schedulePreview();
    setStatus('已清空保存的签名 / 印章');
  });
  attachOverlayDrag($('wrapProcessed'));
  attachOverlayDrag($('wrapSliderOriginal'));

  $('presetSelect').addEventListener('change', async (e) => {
    const val = e.target.value;
    if (!val) return;
    const name = val.slice(2);
    const p = val[0] === 'b'
      ? BUILTIN_PRESETS.find((x) => x.name === name)
      : state.customPresets.find((x) => x.name === name);
    if (!p) return;
    Object.assign(state.settings, p.v);
    if (p.overlays) {
      // 预设里带了签名/印章/水印就一并恢复
      state.overlays = JSON.parse(JSON.stringify(p.overlays));
      state.selectedOverlay = null;
      ovUid = Math.max(ovUid, state.overlays.reduce((a, o) => Math.max(a, Number(o.id) || 0), 0));
      renderOverlayList();
    }
    buildSettingsUI();
    saveSettings();
    await renderPreview();
    setStatus(`已应用预设「${name}」` + (p.overlays?.length ? ` · 含 ${p.overlays.length} 个覆盖层` : ''));
  });

  $('btnSavePreset').addEventListener('click', () => {
    const body = document.createElement('div');
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const head = document.createElement('div');
    head.className = 'ctl-head';
    const lab = document.createElement('span');
    lab.textContent = '预设名称';
    head.appendChild(lab);
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '如：我的合同模板';
    input.value = '我的预设';
    wrap.append(head, input);
    body.appendChild(wrap);

    const withOv = state.overlays.length > 0;
    const row = document.createElement('div');
    row.className = 'ctl-row';
    row.style.marginTop = '12px';
    const rl = document.createElement('span');
    rl.textContent = withOv
      ? `同时保存当前 ${state.overlays.length} 个签名 / 印章 / 水印`
      : '同时保存签名 / 印章 / 水印（当前没有）';
    const sw = document.createElement('label');
    sw.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = withOv;
    cb.disabled = !withOv;
    const tr = document.createElement('span');
    tr.className = 'track';
    sw.append(cb, tr);
    row.append(rl, sw);
    body.appendChild(row);

    const hint = document.createElement('p');
    hint.className = 'tip';
    hint.textContent = '预设只保存扫描效果参数；勾选后连签名、印章、水印的位置和样式一起保存。';
    body.appendChild(hint);

    openModal('保存预设', body, [
      { label: '取消', onClick: (close) => close() },
      {
        label: '保存', primary: true, onClick: (close) => {
          const name = (input.value || '').trim();
          if (!name) { input.focus(); return; }
          const v = { ...state.settings };
          delete v.pageRange;
          delete v.format;
          const preset = { name, v };
          if (withOv && cb.checked) preset.overlays = JSON.parse(JSON.stringify(state.overlays));
          const i = state.customPresets.findIndex((p) => p.name === name);
          if (i >= 0) state.customPresets[i] = preset;
          else state.customPresets.push(preset);
          try { localStorage.setItem(LS_PRESETS, JSON.stringify(state.customPresets)); } catch {}
          renderPresets();
          $('presetSelect').value = 'c:' + name;
          setStatus(`预设「${name}」已保存` + (preset.overlays ? ` · 含 ${preset.overlays.length} 个覆盖层` : ''));
          close();
        },
      },
    ]);
    setTimeout(() => input.select(), 30);
  });

  $('btnDelPreset').addEventListener('click', () => {
    const val = $('presetSelect').value;
    if (!val.startsWith('c:')) return setStatus('只能删除自己保存的预设', true);
    const name = val.slice(2);
    state.customPresets = state.customPresets.filter((p) => p.name !== name);
    try { localStorage.setItem(LS_PRESETS, JSON.stringify(state.customPresets)); } catch {}
    renderPresets();
    setStatus(`预设「${name}」已删除`);
  });

  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { state.preview.key = ''; schedulePreview(); }, 180);
  });

  /* ---------- 移动端抽屉 ---------- */
  const closeDrawer = () => document.body.classList.remove('drawer-open');
  $('btnMenu').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
  $('scrim').addEventListener('click', closeDrawer);
  $('stage').addEventListener('click', () => { if (document.body.classList.contains('drawer-open')) closeDrawer(); });

  /* ---------- 主题 ---------- */
  $('btnTheme').addEventListener('click', cycleTheme);

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') $('prevPage').click();
    if (e.key === 'ArrowRight') $('nextPage').click();
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedOverlay) {
      state.overlays = state.overlays.filter((x) => x.id !== state.selectedOverlay);
      state.selectedOverlay = null;
      renderOverlayList();
      schedulePreview();
      e.preventDefault();
    }
    if (e.key === 'Escape' && state.selectedOverlay) selectOverlay(null);
  });
}

/* ---------------------------------------------------------- 启动 */

loadSettings();
applyTheme();
buildSettingsUI();
renderPresets();
renderOverlayList();
bind();
renderFileList();
renderPreview();
setStatus('就绪 · 拖入 PDF / Word / Excel / PPT / 图片开始');

// 异步恢复上次保存的签名/印章与覆盖层（不阻塞首屏）
(async () => {
  await restoreAssets();
  loadOverlays();
  renderAssetsLine();
  renderOverlayList();
  if (state.overlays.length) {
    schedulePreview();
    toast('ok', `已恢复 ${state.overlays.length} 个签名 / 印章 / 水印`, '来自上次的编辑状态。', 4000);
  }
})();

/* ---------- 离线能力（Service Worker） ---------- */
const netBadge = $('netBadge');
function updateNetBadge() {
  if (!netBadge) return;
  netBadge.classList.remove('warn');
  if (!navigator.onLine) {
    netBadge.textContent = '离线运行中';
    netBadge.classList.add('warn');
  } else if (navigator.serviceWorker?.controller) {
    netBadge.textContent = '已缓存 · 可离线';
  } else {
    netBadge.textContent = '纯本地处理';
  }
}
window.addEventListener('online', updateNetBadge);
window.addEventListener('offline', updateNetBadge);

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(() => updateNetBadge()).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    updateNetBadge();
    // 首次加载时 SW 接管不算"更新"；之后接管说明有新版本
    if (hadController) {
      toast('ok', '已更新到新版本', '刷新页面即可使用最新代码。', 15000);
    }
  });
}
updateNetBadge();

// 供自测脚本使用
window.__scanlike = {
  state, renderPreview, addFiles, processCanvas, parsePageRange,
  addOverlay, makeSeal, renderOverlayList, selectOverlay,
  poolInfo: () => ({ available: pool.available, workers: pool.workers.length, queued: pool.queue.length, inflight: pool.pending.size }),
};
