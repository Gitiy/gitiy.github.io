import { toolPage, fileZone, el, button, note, toast, actions, progress } from '../ui.js';
import { openPdf, renderPage } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName } from '../lib/files.js';

const MAX_THUMBS = 300;

export const tool = {
  init(app) {
    let src = null;
    let pages = [];          // [{ n, rot, removed }] 按显示顺序
    let thumbUrls = [];
    let observer = null;

    const page = toolPage({
      title: 'PDF 页面管理',
      icon: '🗂️',
      desc: '在缩略图上直接旋转、删除、调整页面顺序，然后导出成新的 PDF。原文件不会被改动。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      hint: '页数较多时缩略图会按需加载',
      onFiles: (files) => load(files[0]),
    });

    const stat = el('p', { class: 'hint', 'data-role': 'page-stat' });
    const grid = el('div', { class: 'thumb-grid' });
    const bar = progress();
    const btnExport = button('导出新 PDF', doExport, { primary: true });
    btnExport.disabled = true;

    page.add(dz, info, bar.root, stat, grid);
    page.setActions(
      btnExport,
      button('全部左转 90°', () => { pages.forEach((p) => (p.rot = (p.rot - 90) % 360)); render(); }),
      button('重置', () => { pages.forEach((p) => { p.rot = 0; p.removed = false; }); render(); }),
    );
    app.main.append(page.root);

    /* ---------------- 逻辑 ---------------- */

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const PDFLib = await loadPdfLib();
        const libDoc = await PDFLib.PDFDocument.load(bytes);
        const total = libDoc.getPageCount();

        const doc = await openPdf(bytes);
        src = { name: file.name, bytes, numPages: total, pdfjs: doc };
        pages = Array.from({ length: total }, (_, i) => ({ n: i + 1, rot: 0, removed: false }));

        info.textContent = `${file.name} · ${total} 页` +
          (total > MAX_THUMBS ? `（只预览前 ${MAX_THUMBS} 页，导出仍是全部）` : '');
        info.className = 'hint' + (total > MAX_THUMBS ? ' warn' : '');
        btnExport.disabled = false;
        render();
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    function releaseThumbs() {
      observer?.disconnect();
      observer = null;
      for (const u of thumbUrls) URL.revokeObjectURL(u);
      thumbUrls = [];
    }

    function render() {
      releaseThumbs();
      grid.replaceChildren();

      const kept = pages.filter((p) => !p.removed).length;
      const rot = pages.filter((p) => p.rot % 360 !== 0).length;
      stat.textContent = `共 ${pages.length} 页 · 保留 ${kept} 页 · 已旋转 ${rot} 页`;
      stat.className = 'hint' + (kept === 0 ? ' error' : '');

      observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            observer.unobserve(e.target);
            drawThumb(e.target).catch(() => { });
          }
        }
      }, { rootMargin: '200px' });

      pages.forEach((p, i) => {
        const cell = el('div', {
          class: 'thumb-item' + (p.removed ? ' removed' : ''),
          dataset: { n: String(p.n) },
        },
          el('div', { class: 'thumb-canvas', style: { minHeight: '90px' } }),
          el('span', { class: 'thumb-label', text: `第 ${p.n} 页${p.rot % 360 ? ` · ${((p.rot % 360) + 360) % 360}°` : ''}` }),
          el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '.3rem' } },
            button('⟲', () => { p.rot -= 90; render(); }, { small: true, title: '左转 90°' }),
            button('⟳', () => { p.rot += 90; render(); }, { small: true, title: '右转 90°' }),
            button('←', () => move(i, -1), { small: true, disabled: i === 0, title: '前移' }),
            button('→', () => move(i, 1), { small: true, disabled: i === pages.length - 1, title: '后移' }),
            button(p.removed ? '恢复' : '删除', () => { p.removed = !p.removed; render(); }, { small: true, danger: !p.removed }),
          ),
        );
        grid.append(cell);
        if (i < MAX_THUMBS) observer.observe(cell);
        else cell.querySelector('.thumb-canvas').textContent = '（未预览）';
      });
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= pages.length) return;
      [pages[i], pages[j]] = [pages[j], pages[i]];
      render();
    }

    async function drawThumb(cell) {
      const n = Number(cell.dataset.n);
      const { canvas } = await renderPage(src.pdfjs, n, 0.24);
      const holder = cell.querySelector('.thumb-canvas');
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const url = URL.createObjectURL(blob);
      thumbUrls.push(url);
      holder.replaceChildren(el('img', { src: url, alt: `第 ${n} 页缩略图`, loading: 'lazy' }));
    }

    async function doExport() {
      const kept = pages.filter((p) => !p.removed);
      if (!kept.length) throw new Error('所有页面都被删除了，至少要保留一页');

      bar.show(0, '正在生成新文档…');
      const PDFLib = await loadPdfLib();
      const srcDoc = await PDFLib.PDFDocument.load(src.bytes);
      const out = await PDFLib.PDFDocument.create();
      const { degrees } = PDFLib;

      for (let i = 0; i < kept.length; i++) {
        const p = kept[i];
        bar.set(i / kept.length, `正在写入第 ${i + 1}/${kept.length} 页（原第 ${p.n} 页）`);
        const [copied] = await out.copyPages(srcDoc, [p.n - 1]);
        const orig = copied.getRotation().angle || 0;
        copied.setRotation(degrees(((orig + p.rot) % 360 + 360) % 360));
        out.addPage(copied);
      }

      out.setProducer('Tools · PDF 页面管理');
      out.setModificationDate(new Date());
      const bytes = await out.save({ updateMetadata: false });

      const name = `${baseName(src.name)}_整理.pdf`;
      download(new Blob([bytes], { type: 'application/pdf' }), name);
      bar.set(1, `完成：保留 ${kept.length} 页 → ${name}`);
      toast(`已导出 ${name}（${kept.length} 页）`, 'ok');
    }

    return () => {
      releaseThumbs();
      src?.pdfjs?.destroy?.();
      src = null;
      pages = [];
    };
  },
};
