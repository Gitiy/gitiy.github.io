import { toolPage, fileZone, el, button, select, note, toast, fieldset, progress, row } from '../ui.js';
import { openPdf, renderPage } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, fmtBytes } from '../lib/files.js';

/**
 * PDF 涂黑（Redaction）。
 *
 * 关键点：**只画黑框是不安全的** —— 底层文字还在，复制粘贴或提取文字就能拿到。
 * 所以有涂黑的页会被整页栅格化成图片再盖黑块，文字层彻底消失。
 * 没有涂黑的页保持原样（矢量文字不损失）。
 */

const DPI_OPTIONS = [[150, '150 DPI（够用，体积小）'], [200, '200 DPI（推荐）'], [300, '300 DPI（清晰，体积大）']];

export const tool = {
  init(app) {
    let src = null;
    let pdfjs = null;
    let pageNo = 1;
    let total = 1;
    /** @type {Map<number, Array<{x:number,y:number,w:number,h:number}>>} 归一化坐标 0..1 */
    let marks = new Map();
    let baseCanvas = null;
    let overCanvas = null;
    let dragging = null;

    const page = toolPage({
      title: 'PDF 涂黑',
      icon: '⬛',
      desc: '把敏感内容真正抹掉。涂黑过的页面会被转成图片，底层文字一并消失 —— 不是盖一块黑布那种假涂黑。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf',
      multiple: false,
      icon: '📄',
      title: '拖入要涂黑的 PDF，或点击选择',
      hint: '在页面上拖出方框即可标记',
      onFiles: (files) => load(files[0]),
    });

    const warn = note(
      '涂黑过的页面会整页转成图片：文字不能再被选中或复制（这正是涂黑的意义），同时该页体积会变大。没有涂黑的页面保持原样。',
      'warn',
    );
    warn.classList.add('hidden');

    /* ---- 画布区 ---- */
    const stage = el('div', { class: 'redact-stage hidden' });
    const pager = el('div', { class: 'row', style: { alignItems: 'center', gap: '.5rem' } });
    const pageLabel = el('span', { class: 'hint', text: '' });
    const btnPrev = button('‹ 上一页', () => go(-1), { small: true });
    const btnNext = button('下一页 ›', () => go(1), { small: true });
    const markInfo = el('span', { class: 'hint', text: '' });
    pager.append(btnPrev, pageLabel, btnNext, markInfo);

    const canvasWrap = el('div', { class: 'redact-canvas-wrap' });

    const btnUndo = button('撤销本页最后一处', undo, { small: true });
    const btnClearPage = button('清空本页', () => { marks.delete(pageNo); drawOverlay(); }, { small: true });
    const btnClearAll = button('清空全部', () => { marks.clear(); drawOverlay(); }, { small: true, danger: true });

    const dpiSel = select({
      label: '栅格化分辨率',
      options: DPI_OPTIONS,
      value: 200,
      hint: '越高越清晰，但文件越大',
    });

    const bar = progress();
    const btnExport = button('导出涂黑后的 PDF', doExport, { primary: true });
    btnExport.disabled = true;

    stage.append(pager, canvasWrap, row(btnUndo, btnClearPage, btnClearAll));
    page.add(dz, info, warn, bar.root, stage, fieldset('输出', dpiSel));
    page.setActions(btnExport);
    app.main.appendChild(page.root);

    /* ---------------- 加载 ---------------- */

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        pdfjs = await openPdf(bytes);
        src = { name: file.name, bytes };
        total = pdfjs.numPages;
        pageNo = 1;
        marks = new Map();

        info.textContent = `${file.name} · ${total} 页 · ${fmtBytes(bytes.length)}`;
        info.className = 'hint';
        warn.classList.remove('hidden');
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
      const { canvas, widthPt, heightPt } = await renderPage(pdfjs, pageNo, 1.35);
      baseCanvas = canvas;
      baseCanvas.className = 'redact-base';

      overCanvas = el('canvas', { class: 'redact-over' });
      overCanvas.width = canvas.width;
      overCanvas.height = canvas.height;

      canvasWrap.replaceChildren(
        el('div', { class: 'redact-stack' },
          baseCanvas,
          overCanvas,
          el('div', { class: 'redact-hint', text: '在页面上按住拖动，框出要涂黑的区域' }),
        ),
      );

      bindDrawing();
      updatePager();
      drawOverlay();

      // 记住页面尺寸，导出时用来换算
      src.pageSizes ||= new Map();
      src.pageSizes.set(pageNo, { widthPt, heightPt });
    }

    function updatePager() {
      pageLabel.textContent = `第 ${pageNo} / ${total} 页`;
      btnPrev.disabled = pageNo <= 1;
      btnNext.disabled = pageNo >= total;
      const n = (marks.get(pageNo) || []).length;
      markInfo.textContent = n ? `本页已标记 ${n} 处` : '本页还没有标记';
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
        dragging = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        drawOverlay();
      });

      overCanvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const p = pos(e);
        dragging.x1 = p.x;
        dragging.y1 = p.y;
        drawOverlay();
      });

      const finish = () => {
        if (!dragging) return;
        const { x0, y0, x1, y1 } = dragging;
        const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        dragging = null;
        // 太小的框大概率是误触，忽略
        if (w < 0.008 || h < 0.004) { drawOverlay(); return; }
        const rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w, h };
        if (!marks.has(pageNo)) marks.set(pageNo, []);
        marks.get(pageNo).push(rect);
        drawOverlay();
        updatePager();
      };
      overCanvas.addEventListener('pointerup', finish);
      overCanvas.addEventListener('pointercancel', () => { dragging = null; drawOverlay(); });
    }

    function drawOverlay() {
      if (!overCanvas) return;
      const ctx = overCanvas.getContext('2d');
      const W = overCanvas.width, H = overCanvas.height;
      ctx.clearRect(0, 0, W, H);

      const paint = (r, alpha) => {
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
      };

      for (const r of marks.get(pageNo) || []) paint(r, 0.92);

      if (dragging) {
        const { x0, y0, x1, y1 } = dragging;
        const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        paint(r, 0.5);
        ctx.strokeStyle = 'rgba(255, 60, 60, .95)';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
      }
    }

    function undo() {
      const list = marks.get(pageNo);
      if (!list || !list.length) return;
      list.pop();
      if (!list.length) marks.delete(pageNo);
      drawOverlay();
      updatePager();
    }

    /* ---------------- 导出 ---------------- */

    async function doExport() {
      const markedPages = [...marks.entries()].filter(([, v]) => v.length);
      if (!markedPages.length) {
        toast('还没有标记任何要涂黑的区域', 'error');
        return;
      }

      const dpi = dpiSel.get();
      const scale = dpi / 72;
      const PDFLib = await loadPdfLib();
      const srcDoc = await PDFLib.PDFDocument.load(src.bytes);
      const out = await PDFLib.PDFDocument.create();

      btnExport.disabled = true;
      bar.show(0, '正在处理…');

      try {
        for (let i = 1; i <= total; i++) {
          bar.set((i - 1) / total, `第 ${i}/${total} 页`);
          const rects = marks.get(i);

          if (!rects || !rects.length) {
            // 没涂黑：保留原始矢量页面
            const [copied] = await out.copyPages(srcDoc, [i - 1]);
            out.addPage(copied);
            continue;
          }

          // 有涂黑：整页栅格化 → 盖黑块 → 作为图片放进新页
          const { canvas, widthPt, heightPt } = await renderPage(pdfjs, i, scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#000000';
          for (const r of rects) {
            ctx.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
          }

          const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
          const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const p = out.addPage([widthPt, heightPt]);
          p.drawImage(img, { x: 0, y: 0, width: widthPt, height: heightPt });
        }

        out.setProducer('Tools · PDF 涂黑');
        out.setModificationDate(new Date());
        const bytes = await out.save({ updateMetadata: false });

        const name = `${baseName(src.name)}_已涂黑.pdf`;
        download(new Blob([bytes], { type: 'application/pdf' }), name);
        bar.set(1, `完成：${markedPages.length} 页被涂黑 → ${name}`);
        toast(`已导出 ${name}（${markedPages.length} 页涂黑，其余保持原样）`, 'ok');
      } catch (err) {
        bar.hide?.();
        toast('导出失败：' + err.message, 'error');
      } finally {
        btnExport.disabled = false;
      }
    }

    return () => {
      src = null;
      pdfjs?.destroy?.();
      pdfjs = null;
      marks = new Map();
      baseCanvas = null;
      overCanvas = null;
    };
  },
};
