/**
 * PDF 公共能力：打开文档、解析页范围、渲染成位图、提取文字。
 * pdf.js 负责读/渲染，pdf-lib 负责写出。
 */
import { loadPdfJs, loadPdfLib, vendorUrl } from './scripts.js';

/** 单页像素上限，防止超高 DPI 把浏览器内存打爆 */
export const MAX_PIXELS = 40e6;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 打开一份 PDF（bytes: Uint8Array / ArrayBuffer） */
export async function openPdf(bytes, onPassword) {
  const pdfjs = await loadPdfJs();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return pdfjs.getDocument({
    data: data.slice(0),
    cMapUrl: vendorUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: vendorUrl('standard_fonts/'),
    ...(onPassword ? { onPassword } : {}),
  }).promise;
}

export const pdfLib = loadPdfLib;

/**
 * 解析页范围表达式。空 = 全部。
 * 支持：1-3,5,8-  , odd  , even  , 以及 r1-3 表示倒序
 */
export function parsePageRange(spec, total) {
  const all = () => Array.from({ length: total }, (_, i) => i + 1);
  let s = String(spec || '').trim();
  if (!s) return all();

  let reverse = false;
  if (/^r(everse)?\s*:/i.test(s)) {
    reverse = true;
    s = s.replace(/^r(everse)?\s*:/i, '');
  }

  let parity = null;
  if (/^(odd|even)$/i.test(s)) {
    parity = s.toLowerCase();
    s = '';
  }

  const set = new Set();
  if (!s && parity) {
    for (const n of all()) {
      if (parity === 'odd' ? n % 2 === 1 : n % 2 === 0) set.add(n);
    }
  } else {
    for (const raw of s.split(/[,，]/)) {
      const part = raw.trim();
      if (!part) continue;
      let m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = +m[1], b = +m[2];
        if (a > b) [a, b] = [b, a];
        for (let i = a; i <= b; i++) if (i >= 1 && i <= total) set.add(i);
        continue;
      }
      m = part.match(/^(\d+)\s*-$/);
      if (m) {
        for (let i = +m[1]; i <= total; i++) if (i >= 1) set.add(i);
        continue;
      }
      m = part.match(/^-\s*(\d+)$/);
      if (m) {
        for (let i = 1; i <= +m[1] && i <= total; i++) set.add(i);
        continue;
      }
      if (/^odd$/i.test(part)) { all().filter((n) => n % 2 === 1).forEach((n) => set.add(n)); continue; }
      if (/^even$/i.test(part)) { all().filter((n) => n % 2 === 0).forEach((n) => set.add(n)); continue; }
      const n = parseInt(part, 10);
      if (!isNaN(n) && n >= 1 && n <= total) set.add(n);
    }
  }

  const list = [...set].sort((a, b) => a - b);
  return reverse ? list.reverse() : list;
}

/** [1,2,3,7] -> '1-3,7' */
export function formatPageRange(pages) {
  if (!pages.length) return '';
  const out = [];
  let start = pages[0], prev = pages[0];
  for (let i = 1; i <= pages.length; i++) {
    const cur = pages[i];
    if (cur !== prev + 1) {
      out.push(start === prev ? String(start) : `${start}-${prev}`);
      start = cur;
    }
    prev = cur;
  }
  return out.join(',');
}

/** 单页尺寸（PDF 点，1pt = 1/72 inch） */
export async function pageSize(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const size = { widthPt: vp.width, heightPt: vp.height, rotate: page.rotate || 0 };
  page.cleanup();
  return size;
}

/**
 * 把某页渲染成 canvas。
 * scale 会按 MAX_PIXELS 自动收缩，避免超大页面崩内存。
 */
export async function renderPage(pdf, pageNum, scale = 1) {
  const page = await pdf.getPage(pageNum);
  const vp1 = page.getViewport({ scale: 1 });
  let s = scale;
  if (vp1.width * s * vp1.height * s > MAX_PIXELS) {
    s = Math.sqrt(MAX_PIXELS / (vp1.width * vp1.height));
  }
  const vp = page.getViewport({ scale: s });
  const canvas = makeCanvas(vp.width, vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return { canvas, widthPt: vp1.width, heightPt: vp1.height, scale: s };
}

/**
 * 提取一页的文字。
 * 返回 { text, items }，items 里带坐标（PDF 用户空间，y 自下而上）。
 */
export async function pageText(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    items.push({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width,
      height: it.height || Math.abs(it.transform[3]) || 10,
      fontName: it.fontName,
      hasEOL: !!it.hasEOL,
    });
  }
  // 按阅读顺序（自上而下、自左而右）拼成纯文本
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  let text = '';
  let lastY = null;
  for (const it of sorted) {
    if (lastY !== null && Math.abs(it.y - lastY) > Math.max(2, it.height * 0.5)) text += '\n';
    text += it.str;
    if (it.hasEOL) text += '\n';
    lastY = it.y;
  }
  page.cleanup();
  return { text: text.replace(/[ \t]+\n/g, '\n').trim(), items, widthPt: vp.width, heightPt: vp.height };
}

/** 逐页提取文字，onProgress(ratio, pageNum) */
export async function allText(pdf, pages, onProgress) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i / pages.length, pages[i]);
    const { text, items, widthPt, heightPt } = await pageText(pdf, pages[i]);
    out.push({ page: pages[i], text, items, widthPt, heightPt });
  }
  onProgress?.(1, pages[pages.length - 1]);
  return out;
}

/**
 * 判断这份 PDF 有没有文字层（抽样若干页）。
 * 扫描件没有文字层，转 Word/Excel/HTML 会得到空结果，必须提前告诉用户。
 */
export async function hasTextLayer(pdf, sample = 3) {
  const total = pdf.numPages;
  const picks = new Set();
  for (let i = 1; i <= Math.min(sample, total); i++) picks.add(i);
  if (total > sample) {
    picks.add(Math.ceil(total / 2));
    picks.add(total);
  }
  let chars = 0;
  for (const p of picks) {
    const { text } = await pageText(pdf, p);
    chars += text.replace(/\s/g, '').length;
  }
  return { hasText: chars >= 10, chars };
}

/** 把 pdf-lib 的页尺寸（点）换算成像素 */
export const ptToPx = (pt, dpi) => (pt / 72) * dpi;

export function createOutputPdf(PDFLib, opts = {}) {
  return PDFLib.PDFDocument.create(opts);
}
