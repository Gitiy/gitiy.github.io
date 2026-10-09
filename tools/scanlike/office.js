/* ============================================================
   ScanLike — Office 文档解析与渲染
   Word(.docx) → docx-preview 渲染 DOM → html-to-image 栅格化
   Excel(.xlsx/.xls/.csv) → SheetJS 转表格 → 分页栅格化
   PowerPoint(.pptx) → 自研 DrawingML 渲染器，直接绘制到 Canvas
   ============================================================ */

import { makeCanvas } from './effects.js';

const EMU_PER_PT = 12700;          // 1 pt = 12700 EMU
const DOCX_CSS_W = 794;            // A4 @96dpi 的 CSS 像素宽
const CSS_DPI = 96;
const PAGE_MARGIN_PX = 26;         // xlsx 页边距（CSS px）

const docxLib = globalThis.docx;
const XLSXLib = globalThis.XLSX;
const h2i = globalThis.htmlToImage;
const JSZipLib = globalThis.JSZip;

export const isOfficeFile = (name) => /\.(docx|docm|dotx|xlsx|xlsm|xls|csv|tsv|pptx|pptm|potx)$/i.test(name);

/* ---------------------------------------------------------- 离屏渲染宿主 */

let hostEl = null;
function getHost() {
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.id = 'scanlike-office-host';
    // 必须在文档流里参与布局，但不能被用户看到，也不能影响主界面尺寸
    hostEl.style.cssText =
      'position:fixed;left:-40000px;top:0;width:1400px;z-index:-1;opacity:0;pointer-events:none;overflow:visible;';
    document.body.appendChild(hostEl);
  }
  return hostEl;
}

/* ---------------------------------------------------------- XML 小工具 */

const px = (emu, scale) => (emu / EMU_PER_PT) * scale;

function childrenOf(node, localName) {
  if (!node) return [];
  return [...node.children].filter((e) => e.localName === localName);
}
function childOf(node, localName) {
  return childrenOf(node, localName)[0] || null;
}
function attr(el, name) {
  if (!el) return null;
  return el.getAttribute(name) ?? el.getAttribute('r:' + name) ?? null;
}
/** 在 xfrm 中取位置与尺寸 */
function readXfrm(spPr) {
  const xfrm = childOf(spPr, 'xfrm');
  if (!xfrm) return null;
  const off = childOf(xfrm, 'off');
  const ext = childOf(xfrm, 'ext');
  return {
    x: parseInt(attr(off, 'x') || '0', 10),
    y: parseInt(attr(off, 'y') || '0', 10),
    cx: parseInt(attr(ext, 'cx') || '0', 10),
    cy: parseInt(attr(ext, 'cy') || '0', 10),
    rot: parseInt(attr(xfrm, 'rot') || '0', 10) / 60000,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1',
  };
}

const THEME_COLORS = {
  dk1: '#000000', lt1: '#FFFFFF', dk2: '#44546A', lt2: '#E7E6E6',
  accent1: '#4472C4', accent2: '#ED7D31', accent3: '#A5A5A5', accent4: '#FFC000',
  accent5: '#5B9BD5', accent6: '#70AD47', hlink: '#0563C1', folHlink: '#954F72',
  tx1: '#000000', bg1: '#FFFFFF', tx2: '#44546A', bg2: '#E7E6E6',
};

/** 解析 a:solidFill / a:noFill 之类的填充，返回 CSS 颜色或 null */
function readFill(container) {
  if (!container) return null;
  if (childOf(container, 'noFill')) return 'none';
  const sf = childOf(container, 'solidFill');
  if (sf) {
    const srgb = childOf(sf, 'srgbClr');
    if (srgb) return '#' + attr(srgb, 'val');
    const scheme = childOf(sf, 'schemeClr');
    if (scheme) return THEME_COLORS[attr(scheme, 'val')] || '#888888';
    const prst = childOf(sf, 'prstClr');
    if (prst) return attr(prst, 'val') || '#888888';
  }
  const grad = childOf(container, 'gradFill');
  if (grad) {
    const gs = childrenOf(childOf(grad, 'gsLst'), 'gs');
    if (gs.length) {
      const c = childOf(gs[0], 'srgbClr');
      if (c) return '#' + attr(c, 'val');
    }
  }
  return null;
}

function readLine(spPr) {
  const ln = childOf(spPr, 'ln');
  if (!ln) return null;
  const fill = readFill(ln);
  if (fill === 'none') return null;          // 显式 noFill：无描边
  if (!fill && !attr(ln, 'w')) return null;  // 既没颜色也没宽度：视为无描边
  return { color: fill || '#000000', widthEmu: parseInt(attr(ln, 'w') || '12700', 10) };
}

/* ---------------------------------------------------------- DOCX */

async function loadDocx(buffer) {
  const box = document.createElement('div');
  box.style.cssText = `width:${DOCX_CSS_W}px;background:#fff;color:#000;`;
  getHost().appendChild(box);

  await docxLib.renderAsync(buffer, box, null, {
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
  });

  let sections = [...box.querySelectorAll('.docx-wrapper > section.docx')];
  if (!sections.length) sections = [...box.querySelectorAll('section.docx')];
  if (!sections.length) sections = [box];

  // 让页面之间不叠加阴影，栅格化时更干净
  for (const s of sections) {
    s.style.boxShadow = 'none';
    s.style.margin = '0';
    s.style.background = '#fff';
  }
  box.style.width = 'auto';

  const rect = sections[0].getBoundingClientRect();
  const cssW = Math.round(rect.width) || DOCX_CSS_W;
  const cssH = Math.round(rect.height) || 1123;

  return {
    type: 'docx',
    numPages: sections.length,
    widthPt: cssW * (72 / CSS_DPI),
    heightPt: cssH * (72 / CSS_DPI),
    async renderPage(i, targetWpx) {
      const el = sections[i];
      const r = el.getBoundingClientRect();
      return h2i.toCanvas(el, {
        pixelRatio: targetWpx / r.width,
        backgroundColor: '#ffffff',
        width: Math.round(r.width),
        height: Math.round(r.height),
        skipFonts: false,
      });
    },
  };
}

/* ---------------------------------------------------------- XLSX / CSV */

function sheetToPageTable(ws, sheetName, cols, rows, rowHeights) {
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;table-layout:fixed;width:100%;font-family:"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;';
  const cg = document.createElement('colgroup');
  for (const c of cols) {
    const col = document.createElement('col');
    col.style.width = Math.max(28, c) + 'px';
    cg.appendChild(col);
  }
  table.appendChild(cg);

  // 用 SheetJS 生成单元格 HTML（保留数字格式），再按行裁剪
  const full = XLSXLib.utils.sheet_to_html(ws, { header: '', footer: '', id: 'scanlike-sheet' });
  const tmp = document.createElement('table');
  tmp.innerHTML = full;
  const srcRows = [...tmp.querySelectorAll('tr')];

  const tb = document.createElement('tbody');
  for (const idx of rows) {
    const tr = srcRows[idx];
    if (!tr) continue;
    const clone = tr.cloneNode(true);
    if (rowHeights[idx]) clone.style.height = rowHeights[idx] + 'px';
    tb.appendChild(clone);
  }
  table.appendChild(tb);
  return table;
}

async function loadXlsx(buffer, fileName) {
  const isCsv = /\.(csv|tsv)$/i.test(fileName || '');
  const wb = isCsv
    ? XLSXLib.read(new TextDecoder().decode(buffer), { type: 'string' })
    : XLSXLib.read(new Uint8Array(buffer), { type: 'array', cellStyles: true });

  const sheets = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) { sheets.push({ name, ws, empty: true }); continue; }
    const range = XLSXLib.utils.decode_range(ws['!ref']);
    const nCols = range.e.c - range.s.c + 1;
    const cols = [];
    for (let c = 0; c < nCols; c++) {
      const info = (ws['!cols'] || [])[c] || {};
      cols.push(info.wpx || Math.round((info.wch || 10) * 8) || 90);
    }
    const nRows = range.e.r - range.s.r + 1;
    const rowHeights = [];
    for (let r = 0; r < nRows; r++) {
      const info = (ws['!rows'] || [])[r] || {};
      rowHeights.push(info.hpx || (info.hpt ? Math.round(info.hpt * (96 / 72)) : 0));
    }
    sheets.push({ name, ws, cols, rowHeights, nRows });
  }

  // 决定纸张方向：内容偏宽就用横向 A4
  const widest = Math.max(...sheets.map((s) => (s.cols ? s.cols.reduce((a, b) => a + Math.max(28, b), 0) : 0)), 0);
  const landscape = widest > DOCX_CSS_W - PAGE_MARGIN_PX * 2;
  const pageCssW = landscape ? 1123 : DOCX_CSS_W;
  const pageCssH = landscape ? DOCX_CSS_W : 1123;

  const measure = document.createElement('div');
  measure.style.cssText = `position:absolute;left:0;top:0;width:${pageCssW - PAGE_MARGIN_PX * 2}px;visibility:hidden;`;
  getHost().appendChild(measure);

  // 逐表分页：按行高累积，行不跨页
  const pages = [];
  const headerH = 46;
  for (const s of sheets) {
    if (s.empty) { pages.push({ sheet: s.name, rows: [], empty: true, landscape }); continue; }
    measure.innerHTML = '';
    const t = sheetToPageTable(s.ws, s.name, s.cols, Array.from({ length: s.nRows }, (_, i) => i), s.rowHeights);
    measure.appendChild(t);
    const trs = [...t.querySelectorAll('tr')];
    const heights = trs.map((tr) => tr.getBoundingClientRect().height || 22);
    const usable = pageCssH - PAGE_MARGIN_PX * 2 - headerH;
    let cur = [];
    let used = 0;
    const push = () => { if (cur.length) pages.push({ sheet: s.name, rows: cur, landscape }); cur = []; used = 0; };
    for (let i = 0; i < heights.length; i++) {
      if (i === 0) { cur.push(i); used += heights[i]; continue; }   // 表头每页重复
      if (used + heights[i] > usable && cur.length > 1) push();
      cur.push(i);
      used += heights[i];
    }
    push();
  }
  measure.remove();

  // 页面上真正渲染的容器（每次按页新建，保证不串页）
  const cache = new Map();

  async function buildPage(p, targetWpx) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${pageCssW}px;height:${pageCssH}px;background:#fff;color:#000;padding:${PAGE_MARGIN_PX}px;box-sizing:border-box;font-family:"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden;`;
    const title = document.createElement('div');
    title.style.cssText = 'font-size:12px;color:#666;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:10px;display:flex;justify-content:space-between;';
    title.innerHTML = `<span>${escapeHtml(p.sheet)}</span><span>ScanLike</span>`;
    wrap.appendChild(title);
    const s = sheets.find((x) => x.name === p.sheet);
    if (p.empty) {
      const e = document.createElement('div');
      e.style.cssText = 'color:#999;font-size:14px;padding:20px 0;';
      e.textContent = '（空工作表）';
      wrap.appendChild(e);
    } else {
      wrap.appendChild(sheetToPageTable(s.ws, p.sheet, s.cols, p.rows, s.rowHeights));
    }
    const style = document.createElement('style');
    style.textContent = '#scanlike-office-host table td{border:1px solid #b8b8b8;padding:3px 6px;font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}';
    wrap.appendChild(style);
    getHost().appendChild(wrap);
    return wrap;
  }

  return {
    type: 'xlsx',
    numPages: pages.length,
    widthPt: pageCssW * (72 / CSS_DPI),
    heightPt: pageCssH * (72 / CSS_DPI),
    landscape,
    async renderPage(i, targetWpx) {
      const p = pages[i];
      const wrap = await buildPage(p, targetWpx);
      const canvas = await h2i.toCanvas(wrap, {
        pixelRatio: targetWpx / pageCssW,
        backgroundColor: '#ffffff',
        width: pageCssW,
        height: pageCssH,
      });
      wrap.remove();
      return canvas;
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------------------------------------------------- PPTX */

function readSlideSize(zipText) {
  const pres = new DOMParser().parseFromString(zipText, 'application/xml');
  const sldSz = pres.getElementsByTagName('*');
  for (const el of sldSz) {
    if (el.localName === 'sldSz') {
      return { cx: parseInt(el.getAttribute('cx'), 10), cy: parseInt(el.getAttribute('cy'), 10) };
    }
  }
  return { cx: 12192000, cy: 6858000 };   // 16:9 默认
}

function readBg(xmlDoc) {
  const all = xmlDoc.getElementsByTagName('*');
  for (const el of all) {
    if (el.localName === 'bg') {
      const bgPr = childOf(el, 'bgPr');
      const c = readFill(bgPr);
      if (c && c !== 'none') return c;
      const bgRef = childOf(el, 'bgRef');
      if (bgRef) {
        const scheme = childOf(bgRef, 'schemeClr');
        if (scheme) return THEME_COLORS[attr(scheme, 'val')] || null;
      }
    }
  }
  return null;
}

/** 解析一个 txBody，返回可直接绘制的段落数组 */
function readTextBody(txBody, scale) {
  const paras = [];
  for (const p of childrenOf(txBody, 'p')) {
    const pPr = childOf(p, 'pPr');
    const runs = [];
    for (const node of p.children) {
      if (node.localName === 'r' || node.localName === 'fld') {
        const rPr = childOf(node, 'rPr');
        const t = childOf(node, 't');
        const br = childOf(node, 'br');
        if (br) { runs.push({ text: '\n', size: 18, bold: false, italic: false, color: '#000' }); continue; }
        if (!t) continue;
        const sz = parseInt(attr(rPr, 'sz') || '1800', 10) / 100;
        runs.push({
          text: t.textContent || '',
          size: sz,
          bold: attr(rPr, 'b') === '1',
          italic: attr(rPr, 'i') === '1',
          underline: attr(rPr, 'u') && attr(rPr, 'u') !== 'none',
          color: readFill(rPr) || '#000000',
          font: (() => {
            const latin = childOf(rPr, 'latin') || childOf(rPr, 'ea');
            return latin ? attr(latin, 'typeface') : null;
          })(),
        });
      } else if (node.localName === 'br') {
        runs.push({ text: '\n', size: 18, bold: false, italic: false, color: '#000' });
      }
    }
    if (!runs.length) runs.push({ text: '', size: 18, bold: false, italic: false, color: '#000' });
    const lnSpc = childOf(childOf(pPr, 'lnSpc'), 'spcPct');
    paras.push({
      runs,
      align: attr(pPr, 'algn') || 'l',
      linePct: lnSpc ? parseInt(attr(lnSpc, 'val') || '100000', 10) / 100000 : 1.0,
      bullet: !!(childOf(pPr, 'buChar') || childOf(pPr, 'buAutoNum')),
      indent: parseInt(attr(pPr, 'marL') || '0', 10),
    });
  }
  return paras;
}

function readBodyPr(txBody) {
  const bodyPr = childOf(txBody, 'bodyPr');
  const num = (name, def) => {
    const v = attr(bodyPr, name);
    return v == null ? def : parseInt(v, 10);
  };
  return {
    anchor: attr(bodyPr, 'anchor') || 't',
    lIns: num('lIns', 91440),
    tIns: num('tIns', 45720),
    rIns: num('rIns', 91440),
    bIns: num('bIns', 45720),
    wrap: attr(bodyPr, 'wrap') !== 'none',
    vert: attr(bodyPr, 'vert') || 'horz',
  };
}

function drawTextBody(ctx, txBody, box, scale, defaults) {
  const bp = readBodyPr(txBody);
  const paras = readTextBody(txBody, scale);
  const x = box.x + px(bp.lIns, scale);
  const y = box.y + px(bp.tIns, scale);
  const w = Math.max(4, box.w - px(bp.lIns + bp.rIns, scale));
  const h = Math.max(4, box.h - px(bp.tIns + bp.bIns, scale));

  // 先做排版测量
  const lines = [];
  for (const para of paras) {
    const bulletIndent = para.bullet ? 16 * scale : 0;
    const maxW = w - bulletIndent;
    let line = [];
    let lineW = 0;
    const flush = () => { lines.push({ runs: line, para }); line = []; lineW = 0; };
    for (const run of para.runs) {
      if (run.text === '\n') { flush(); continue; }
      const chunks = run.text.split(/(\s+)/).filter((s) => s !== '');
      for (const ch of chunks) {
        ctx.font = `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : '400 '}${Math.max(1, run.size * scale)}px ${run.font ? '"' + run.font + '",' : ''}"Segoe UI","Microsoft YaHei",sans-serif`;
        const cw = ctx.measureText(ch).width;
        if (lineW + cw > maxW && line.length) flush();
        const last = line[line.length - 1];
        if (last && last.run.size === run.size && last.run.bold === run.bold && last.run.italic === run.italic && last.run.color === run.color && last.run.font === run.font) {
          last.text += ch;
          last.w += cw;
        } else {
          line.push({ text: ch, w: cw, run });
        }
        lineW += cw;
      }
    }
    flush();
  }

  // 计算总高度以决定垂直对齐
  let total = 0;
  for (const l of lines) {
    const size = Math.max(...l.runs.map((r) => r.run.size), 12);
    total += size * scale * 1.22 * (l.para.linePct || 1);
  }
  let cy = y;
  if (bp.anchor === 'ctr') cy = y + (h - total) / 2;
  else if (bp.anchor === 'b') cy = y + h - total;

  ctx.textBaseline = 'top';
  for (const l of lines) {
    const size = Math.max(...l.runs.map((r) => r.run.size), 12);
    const lineH = size * scale * 1.22 * (l.para.linePct || 1);
    const bulletIndent = l.para.bullet ? 16 * scale : 0;
    const contentW = l.runs.reduce((a, r) => a + r.w, 0);
    let cx = x + bulletIndent;
    if (l.para.align === 'ctr') cx = x + (w - contentW) / 2;
    else if (l.para.align === 'r') cx = x + w - contentW;

    if (l.para.bullet) {
      ctx.fillStyle = l.runs[0]?.run.color || '#000';
      ctx.font = `${Math.max(1, size * scale)}px "Segoe UI","Microsoft YaHei",sans-serif`;
      ctx.fillText('•', x + 4 * scale, cy + lineH * 0.06);
    }
    for (const r of l.runs) {
      ctx.font = `${r.run.italic ? 'italic ' : ''}${r.run.bold ? '700 ' : '400 '}${Math.max(1, r.run.size * scale)}px ${r.run.font ? '"' + r.run.font + '",' : ''}"Segoe UI","Microsoft YaHei",sans-serif`;
      ctx.fillStyle = r.run.color;
      ctx.fillText(r.text, cx, cy);
      if (r.run.underline) {
        const uy = cy + r.run.size * scale * 1.1;
        ctx.fillRect(cx, uy, r.w, Math.max(1, r.run.size * scale * 0.06));
      }
      cx += r.w;
    }
    cy += lineH;
  }
}

function shapePath(ctx, prst, x, y, w, h) {
  const r = Math.min(w, h) * 0.18;
  ctx.beginPath();
  switch (prst) {
    case 'ellipse':
    case 'circle':
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'roundRect':
    case 'round1Rect':
    case 'round2SameRect':
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
      break;
    case 'rtTriangle':
      ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath();
      break;
    case 'line':
    case 'straightConnector1':
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
      break;
    default:
      ctx.rect(x, y, w, h);
  }
}

async function loadPptx(buffer) {
  const zip = await JSZipLib.loadAsync(buffer);
  const presXml = await zip.file('ppt/presentation.xml').async('string');
  const size = readSlideSize(presXml);

  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10)));

  const bitmapCache = new Map();
  async function loadRelTarget(slidePath, rId) {
    const relPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    const relFile = zip.file(relPath);
    if (!relFile) return null;
    const relXml = await relFile.async('string');
    const doc = new DOMParser().parseFromString(relXml, 'application/xml');
    for (const rel of doc.getElementsByTagName('*')) {
      if (rel.localName === 'Relationship' && (rel.getAttribute('Id') === rId)) {
        const target = rel.getAttribute('Target');
        const base = 'ppt/slides/';
        const norm = target.startsWith('/') ? target.slice(1) : base + target;
        return norm.replace(/ppt\/slides\/\.\.\//g, 'ppt/').replace(/[^/]+\/\.\.\//g, '');
      }
    }
    return null;
  }

  async function getBitmap(path) {
    if (!path) return null;
    if (bitmapCache.has(path)) return bitmapCache.get(path);
    const f = zip.file(path);
    if (!f) { bitmapCache.set(path, null); return null; }
    const blob = await f.async('blob');
    try {
      const bmp = await createImageBitmap(blob);
      bitmapCache.set(path, bmp);
      return bmp;
    } catch {
      bitmapCache.set(path, null);
      return null;
    }
  }

  // 预解析每张幻灯片
  const slides = [];
  for (const sf of slideFiles) {
    const xml = await zip.file(sf).async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const spTree = (() => {
      for (const el of doc.getElementsByTagName('*')) if (el.localName === 'spTree') return el;
      return null;
    })();
    slides.push({ path: sf, doc, spTree, bg: readBg(doc) });
  }

  const W = px(size.cx, 1), H = px(size.cy, 1);

  return {
    type: 'pptx',
    numPages: slides.length,
    widthPt: size.cx / EMU_PER_PT,
    heightPt: size.cy / EMU_PER_PT,
    async renderPage(i, targetWpx) {
      const slide = slides[i];
      const scale = targetWpx / W;
      const canvas = makeCanvas(W * scale, H * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = slide.bg || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textBaseline = 'top';

      const drawNode = async (node, ox, oy) => {
        const ln = node.localName;
        if (ln === 'grpSp') {
          const gxfrm = readXfrm(childOf(node, 'grpSpPr'));
          const gx = gxfrm ? ox + px(gxfrm.x, scale) : ox;
          const gy = gxfrm ? oy + px(gxfrm.y, scale) : oy;
          for (const c of node.children) await drawNode(c, gx, gy);
          return;
        }
        if (ln === 'pic') {
          const spPr = childOf(node, 'spPr');
          const xfrm = readXfrm(spPr);
          const blip = (() => {
            for (const el of node.getElementsByTagName('*')) if (el.localName === 'blip') return el;
            return null;
          })();
          const rid = blip ? (blip.getAttribute('r:embed') || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')) : null;
          const bmp = await getBitmap(await loadRelTarget(slide.path, rid));
          if (!bmp || !xfrm) return;
          const x = ox + px(xfrm.x, scale), y = oy + px(xfrm.y, scale);
          const w = px(xfrm.cx, scale), h = px(xfrm.cy, scale);
          ctx.save();
          if (xfrm.rot) {
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate((xfrm.rot * Math.PI) / 180);
            ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
          } else {
            ctx.drawImage(bmp, x, y, w, h);
          }
          ctx.restore();
          return;
        }
        if (ln === 'graphicFrame') {
          const xfrm = readXfrm(childOf(node, 'xfrm')) || readXfrm(node);
          const tbl = (() => {
            for (const el of node.getElementsByTagName('*')) if (el.localName === 'tbl') return el;
            return null;
          })();
          if (!tbl || !xfrm) return;
          const x0 = ox + px(xfrm.x, scale), y0 = oy + px(xfrm.y, scale);
          const grid = childrenOf(childOf(tbl, 'tblGrid'), 'gridCol').map((c) => px(parseInt(attr(c, 'w') || '0', 10), scale));
          const totalW = grid.reduce((a, b) => a + b, 0) || px(xfrm.cx, scale);
          let cy = y0;
          for (const tr of childrenOf(tbl, 'tr')) {
            const cells = childrenOf(tr, 'tc');
            const rowH = Math.max(...cells.map((tc) => {
              const tb = childOf(tc, 'txBody');
              const paras = tb ? readTextBody(tb, scale) : [];
              const lh = paras.reduce((a, p) => a + Math.max(...p.runs.map((r) => r.size), 12) * scale * 1.35, 0);
              return lh + 10 * scale;
            }), 20 * scale);
            let cx = x0;
            cells.forEach((tc, ci) => {
              const w = grid[ci] || totalW / cells.length;
              const tcPr = childOf(tc, 'tcPr');
              const fill = readFill(tcPr);
              if (fill && fill !== 'none') { ctx.fillStyle = fill; ctx.fillRect(cx, cy, w, rowH); }
              ctx.strokeStyle = 'rgba(0,0,0,0.35)';
              ctx.lineWidth = Math.max(1, 1 * scale);
              ctx.strokeRect(cx, cy, w, rowH);
              const tb = childOf(tc, 'txBody');
              if (tb) drawTextBody(ctx, tb, { x: cx, y: cy, w, h: rowH }, scale);
              cx += w;
            });
            cy += rowH;
          }
          return;
        }
        if (ln === 'sp' || ln === 'cxnSp') {
          const spPr = childOf(node, 'spPr');
          const xfrm = readXfrm(spPr);
          if (!xfrm) return;
          const x = ox + px(xfrm.x, scale), y = oy + px(xfrm.y, scale);
          const w = px(xfrm.cx, scale), h = px(xfrm.cy, scale);
          const prstEl = childOf(spPr, 'prstGeom');
          const prst = prstEl ? attr(prstEl, 'prst') : 'rect';
          const fill = readFill(spPr);
          const line = readLine(spPr);
          ctx.save();
          if (xfrm.rot) {
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate((xfrm.rot * Math.PI) / 180);
            ctx.translate(-(x + w / 2), -(y + h / 2));
          }
          shapePath(ctx, prst, x, y, w, h);
          if (fill && fill !== 'none') { ctx.fillStyle = fill; ctx.fill(); }
          if (line) {
            ctx.strokeStyle = line.color;
            ctx.lineWidth = Math.max(1, px(line.widthEmu, scale));
            ctx.stroke();
          }
          ctx.restore();
          const txBody = childOf(node, 'txBody');
          if (txBody && childrenOf(txBody, 'p').some((p) => p.textContent.trim())) {
            ctx.save();
            if (xfrm.rot) {
              ctx.translate(x + w / 2, y + h / 2);
              ctx.rotate((xfrm.rot * Math.PI) / 180);
              ctx.translate(-(x + w / 2), -(y + h / 2));
            }
            drawTextBody(ctx, txBody, { x, y, w, h }, scale);
            ctx.restore();
          }
        }
      };

      if (slide.spTree) {
        for (const node of slide.spTree.children) {
          if (['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'].includes(node.localName)) {
            await drawNode(node, 0, 0);
          }
        }
      }
      return canvas;
    },
  };
}

/* ---------------------------------------------------------- 统一入口 */

export async function loadOffice(buffer, fileName) {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  if (/^(docx|docm|dotx)$/.test(ext)) return loadDocx(buffer);
  if (/^(xlsx|xlsm|xls|csv|tsv)$/.test(ext)) return loadXlsx(buffer, fileName);
  if (/^(pptx|pptm|potx)$/.test(ext)) return loadPptx(buffer);
  throw new Error('不支持的 Office 格式：.' + ext);
}
