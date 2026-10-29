import { toolPage, fileZone, el, button, select, textInput, rangeInput, colorInput, note, toast, fieldset, progress, row } from '../ui.js';
import { openPdf, renderPage } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, fmtBytes } from '../lib/files.js';

/**
 * PDF 批注标注。
 *
 * 坐标一律存「归一化 + 左上原点」（0..1），跟画布尺寸解耦；
 * 导出时再换算成 PDF 用户空间（左下原点），并按页面的 /Rotate 做旋转补偿。
 *
 * 与「涂黑」的区别：批注是叠加在页面内容之上的，文字层保留、仍可选中复制。
 */

const TOOLS = [
  ['highlight', '高亮'],
  ['underline', '下划线'],
  ['strike', '删除线'],
  ['box', '方框'],
  ['text', '文字批注'],
  ['ink', '手绘'],
];

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 1, g: 0.2, b: 0.2 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

/**
 * 把「显示空间」的归一化坐标换成 PDF 用户空间坐标。
 * rot 是页面 /Rotate（顺时针角度）。推导见 PDF 规范：/Rotate 表示显示时顺时针转多少度。
 */
function toUser(nx, ny, pw, ph, rot) {
  const swap = rot === 90 || rot === 270;
  const dw = swap ? ph : pw;
  const dh = swap ? pw : ph;
  const u = nx * dw;
  const v = ny * dh;
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x: v, y: u };
    case 180: return { x: pw - u, y: v };
    case 270: return { x: pw - v, y: ph - u };
    default: return { x: u, y: ph - v };
  }
}

/** 归一化矩形 → 用户空间的轴对齐包围盒 */
function rectToUser(r, pw, ph, rot) {
  const a = toUser(r.x, r.y, pw, ph, rot);
  const b = toUser(r.x + r.w, r.y + r.h, pw, ph, rot);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export const tool = {
  init(app) {
    let src = null;
    let pdfjs = null;
    let pageNo = 1;
    let total = 1;
    /** @type {Map<number, Array<object>>} */
    let anns = new Map();
    let overCanvas = null;
    let dragging = null;

    const page = toolPage({
      title: 'PDF 批注标注',
      icon: '🖍️',
      desc: '在 PDF 上做高亮、下划线、删除线、方框、文字批注和手绘。导出后直接烧进页面，任何阅读器都能看到，文字层不受影响。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf',
      multiple: false,
      icon: '📄',
      title: '拖入要批注的 PDF，或点击选择',
      hint: '支持鼠标与触屏拖拽',
      onFiles: (files) => load(files[0]),
    });

    const toolSel = select({ label: '标注类型', options: TOOLS, value: 'highlight', onChange: syncToolUi });
    const color = colorInput({ label: '颜色', value: '#facc15', onChange: () => drawOverlay() });
    const opacity = rangeInput({
      label: '不透明度', value: 35, min: 10, max: 100, step: 5,
      format: (v) => v + '%', onChange: () => drawOverlay(),
    });
    const textVal = textInput({ label: '批注文字', value: '请注意', placeholder: '输入要标注的文字' });
    const fontSize = rangeInput({
      label: '文字大小', value: 14, min: 8, max: 48, step: 1,
      format: (v) => v + ' pt', onChange: () => { },
    });
    const textBox = fieldset('文字内容', textVal, fontSize);
    textBox.classList.add('hidden');

    const stage = el('div', { class: 'redact-stage hidden' });
    const pager = el('div', { class: 'row', style: { alignItems: 'center', gap: '.5rem' } });
    const pageLabel = el('span', { class: 'hint', text: '' });
    const btnPrev = button('‹ 上一页', () => go(-1), { small: true });
    const btnNext = button('下一页 ›', () => go(1), { small: true });
    const markInfo = el('span', { class: 'hint', text: '' });
    pager.append(btnPrev, pageLabel, btnNext, markInfo);

    const canvasWrap = el('div', { class: 'redact-canvas-wrap' });
    const btnUndo = button('撤销', undo, { small: true });
    const btnClearPage = button('清空本页', () => { anns.delete(pageNo); drawOverlay(); }, { small: true });
    const btnClearAll = button('清空全部', () => { anns.clear(); drawOverlay(); }, { small: true, danger: true });

    const bar = progress();
    const btnExport = button('导出带批注的 PDF', doExport, { primary: true });
    btnExport.disabled = true;

    stage.append(pager, canvasWrap, row(btnUndo, btnClearPage, btnClearAll));
    page.add(dz, info, bar.root, fieldset('标注样式', toolSel, color, opacity), textBox, stage);
    page.setActions(btnExport);
    app.main.appendChild(page.root);

    function syncToolUi() {
      textBox.classList.toggle('hidden', toolSel.get() !== 'text');
    }

    /* ---------------- 加载 ---------------- */

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        pdfjs = await openPdf(bytes);
        src = { name: file.name, bytes };
        total = pdfjs.numPages;
        pageNo = 1;
        anns = new Map();

        info.textContent = `${file.name} · ${total} 页 · ${fmtBytes(bytes.length)}`;
        info.className = 'hint';
        stage.classList.remove('hidden');
        btnExport.disabled = false;
        await renderCurrent();
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    /* ---------------- 渲染 ---------------- */

    async function renderCurrent() {
      if (!pdfjs) return;
      const { canvas } = await renderPage(pdfjs, pageNo, 1.35);
      canvas.className = 'redact-base';

      overCanvas = el('canvas', { class: 'redact-over' });
      overCanvas.width = canvas.width;
      overCanvas.height = canvas.height;

      canvasWrap.replaceChildren(
        el('div', { class: 'redact-stack' },
          canvas,
          overCanvas,
          el('div', { class: 'redact-hint', text: '按住拖动；「文字批注」是点一下落点' }),
        ),
      );

      bindDrawing();
      updatePager();
      drawOverlay();
    }

    function updatePager() {
      pageLabel.textContent = `第 ${pageNo} / ${total} 页`;
      btnPrev.disabled = pageNo <= 1;
      btnNext.disabled = pageNo >= total;
      const n = (anns.get(pageNo) || []).length;
      markInfo.textContent = n ? `本页 ${n} 处批注` : '本页还没有批注';
      markInfo.className = 'hint' + (n ? ' warn' : '');
    }

    function go(d) {
      const n = pageNo + d;
      if (n < 1 || n > total) return;
      pageNo = n;
      renderCurrent();
    }

    function bindDrawing() {
      const pos = (e) => {
        const r = overCanvas.getBoundingClientRect();
        return {
          x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
          y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
        };
      };

      overCanvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // 合成事件或个别浏览器会抛 NotFoundError，忽略即可，不影响拖拽
        try { overCanvas.setPointerCapture(e.pointerId); } catch { }
        const p = pos(e);
        const t = toolSel.get();

        if (t === 'text') {
          const str = textVal.get().trim();
          if (!str) { toast('先输入批注文字', 'error'); return; }
          push({ type: 'text', x: p.x, y: p.y, text: str, size: fontSize.get(), color: color.get() });
          return;
        }
        if (t === 'ink') {
          dragging = { type: 'ink', pts: [[p.x, p.y]] };
          drawOverlay();
          return;
        }
        dragging = { type: 'rect', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        drawOverlay();
      });

      overCanvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const p = pos(e);
        if (dragging.type === 'ink') {
          const last = dragging.pts[dragging.pts.length - 1];
          if (Math.abs(p.x - last[0]) + Math.abs(p.y - last[1]) > 0.0015) dragging.pts.push([p.x, p.y]);
        } else {
          dragging.x1 = p.x;
          dragging.y1 = p.y;
        }
        drawOverlay();
      });

      const finish = () => {
        if (!dragging) return;
        const d = dragging;
        dragging = null;

        if (d.type === 'ink') {
          if (d.pts.length >= 2) {
            push({ type: 'ink', pts: d.pts, color: color.get(), width: Math.max(1.2, opacity.get() / 25) });
          }
          drawOverlay();
          return;
        }

        const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
        if (w < 0.006 || h < 0.003) { drawOverlay(); return; }
        const rect = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w, h };
        push({ type: toolSel.get(), ...rect, color: color.get(), opacity: opacity.get() / 100 });
      };
      overCanvas.addEventListener('pointerup', finish);
      overCanvas.addEventListener('pointercancel', () => { dragging = null; drawOverlay(); });
    }

    function push(a) {
      if (!anns.has(pageNo)) anns.set(pageNo, []);
      anns.get(pageNo).push(a);
      drawOverlay();
      updatePager();
    }

    function undo() {
      const list = anns.get(pageNo);
      if (!list || !list.length) return;
      list.pop();
      if (!list.length) anns.delete(pageNo);
      drawOverlay();
      updatePager();
    }

    function drawOverlay() {
      if (!overCanvas) return;
      const ctx = overCanvas.getContext('2d');
      const W = overCanvas.width, H = overCanvas.height;
      ctx.clearRect(0, 0, W, H);

      const paint = (a, alpha) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = a.color;
        ctx.fillStyle = a.color;

        if (a.type === 'highlight') {
          ctx.fillRect(a.x * W, a.y * H, a.w * W, a.h * H);
        } else if (a.type === 'box') {
          ctx.lineWidth = 2;
          ctx.strokeRect(a.x * W, a.y * H, a.w * W, a.h * H);
        } else if (a.type === 'underline') {
          ctx.lineWidth = Math.max(1.5, a.h * H * 0.12);
          const y = (a.y + a.h) * H;
          ctx.beginPath();
          ctx.moveTo(a.x * W, y);
          ctx.lineTo((a.x + a.w) * W, y);
          ctx.stroke();
        } else if (a.type === 'strike') {
          ctx.lineWidth = Math.max(1.5, a.h * H * 0.1);
          const y = (a.y + a.h / 2) * H;
          ctx.beginPath();
          ctx.moveTo(a.x * W, y);
          ctx.lineTo((a.x + a.w) * W, y);
          ctx.stroke();
        } else if (a.type === 'text') {
          const px = Math.max(9, a.size * (H / 800));
          ctx.font = `600 ${px}px "Microsoft YaHei", "PingFang SC", sans-serif`;
          ctx.textBaseline = 'top';
          ctx.fillText(a.text, a.x * W, a.y * H);
        } else if (a.type === 'ink') {
          ctx.lineWidth = Math.max(1.5, a.width * (H / 800) * 2);
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          a.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * W, py * H) : ctx.moveTo(px * W, py * H)));
          ctx.stroke();
        }
        ctx.restore();
      };

      for (const a of anns.get(pageNo) || []) paint(a, a.type === 'highlight' ? (a.opacity ?? 0.35) : 1);

      if (dragging) {
        if (dragging.type === 'ink') {
          paint({ type: 'ink', pts: dragging.pts, color: color.get(), width: 2 }, 1);
        } else {
          const r = {
            type: toolSel.get(),
            x: Math.min(dragging.x0, dragging.x1),
            y: Math.min(dragging.y0, dragging.y1),
            w: Math.abs(dragging.x1 - dragging.x0),
            h: Math.abs(dragging.y1 - dragging.y0),
            color: color.get(),
            opacity: 0.5,
          };
          paint(r, 0.55);
        }
      }
    }

    /* ---------------- 导出 ---------------- */

    async function doExport() {
      const pagesWith = [...anns.entries()].filter(([, v]) => v.length);
      if (!pagesWith.length) { toast('还没有添加任何批注', 'error'); return; }

      const PDFLib = await loadPdfLib();
      const srcDoc = await PDFLib.PDFDocument.load(src.bytes);
      const out = await PDFLib.PDFDocument.create();
      const { rgb } = PDFLib;

      btnExport.disabled = true;
      bar.show(0, '正在写入批注…');

      try {
        for (let i = 1; i <= total; i++) {
          bar.set((i - 1) / total, `第 ${i}/${total} 页`);
          const [copied] = await out.copyPages(srcDoc, [i - 1]);
          out.addPage(copied);

          const list = anns.get(i);
          if (!list || !list.length) continue;

          const pw = copied.getWidth();
          const ph = copied.getHeight();
          const rot = ((copied.getRotation().angle % 360) + 360) % 360;

          for (const a of list) {
            const c = hexToRgb(a.color);

            if (a.type === 'text') {
              // 文字用画布渲染成 PNG 再贴上去 —— 免去嵌入中文字体的麻烦
              const img = await textToImage(out, a);
              const p = toUser(a.x, a.y, pw, ph, rot);
              const wPt = img.width * (a.size / img.height);
              const hPt = a.size;
              // 旋转页面上文字方向会跟着转，这里按 0° 贴，够用
              copied.drawImage(img, { x: p.x, y: p.y - hPt, width: wPt, height: hPt });
              continue;
            }

            if (a.type === 'ink') {
              const pts = a.pts.map(([nx, ny]) => toUser(nx, ny, pw, ph, rot));
              const th = Math.max(1, a.width || 2);
              for (let k = 1; k < pts.length; k++) {
                copied.drawLine({
                  start: pts[k - 1], end: pts[k],
                  thickness: th, color: rgb(c.r, c.g, c.b), opacity: 0.95,
                });
              }
              continue;
            }

            const r = rectToUser(a, pw, ph, rot);

            if (a.type === 'highlight') {
              copied.drawRectangle({
                x: r.x, y: r.y, width: r.w, height: r.h,
                color: rgb(c.r, c.g, c.b), opacity: a.opacity ?? 0.35,
              });
            } else if (a.type === 'box') {
              copied.drawRectangle({
                x: r.x, y: r.y, width: r.w, height: r.h,
                borderColor: rgb(c.r, c.g, c.b), borderWidth: 1.5, opacity: 0,
                borderOpacity: 1,
              });
            } else if (a.type === 'underline') {
              copied.drawLine({
                start: { x: r.x, y: r.y }, end: { x: r.x + r.w, y: r.y },
                thickness: Math.max(1, r.h * 0.1), color: rgb(c.r, c.g, c.b),
              });
            } else if (a.type === 'strike') {
              copied.drawLine({
                start: { x: r.x, y: r.y + r.h / 2 }, end: { x: r.x + r.w, y: r.y + r.h / 2 },
                thickness: Math.max(1, r.h * 0.08), color: rgb(c.r, c.g, c.b),
              });
            }
          }
        }

        out.setProducer('Tools · PDF 批注标注');
        out.setModificationDate(new Date());
        const bytes = await out.save({ updateMetadata: false });

        const name = `${baseName(src.name)}_已批注.pdf`;
        download(new Blob([bytes], { type: 'application/pdf' }), name);
        bar.set(1, `完成：${pagesWith.length} 页有批注 → ${name}`);
        toast(`已导出 ${name}`, 'ok');
      } catch (err) {
        bar.hide?.();
        toast('导出失败：' + err.message, 'error');
      } finally {
        btnExport.disabled = false;
      }
    }

    /** 把一段文字画成透明底 PNG，再交给 pdf-lib 嵌入（绕开中文字体问题） */
    async function textToImage(doc, a) {
      const dpr = 3;
      const size = a.size;
      const font = `600 ${size * dpr}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      const probe = document.createElement('canvas').getContext('2d');
      probe.font = font;
      const w = Math.max(8, probe.measureText(a.text).width);
      const h = size * dpr * 1.35;

      const c = document.createElement('canvas');
      c.width = Math.ceil(w) + 8;
      c.height = Math.ceil(h);
      const ctx = c.getContext('2d');
      ctx.font = font;
      ctx.textBaseline = 'top';
      ctx.fillStyle = a.color;
      ctx.fillText(a.text, 4, 2);

      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    }

    return () => {
      src = null;
      pdfjs?.destroy?.();
      pdfjs = null;
      anns = new Map();
      overCanvas = null;
    };
  },
};
