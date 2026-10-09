import {
  toolPage, fileZone, el, button, select, textInput, rangeInput, toggle,
  note, toast, grid, fieldset, previewPane, progress,
} from '../ui.js';
import { openPdf, renderPage, parsePageRange } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, fmtBytes } from '../lib/files.js';

const PRESETS = {
  extreme: { dpi: 72, quality: 0.55, label: '极限压缩' },
  balanced: { dpi: 120, quality: 0.72, label: '平衡' },
  high: { dpi: 200, quality: 0.85, label: '高质量' },
  imageonly: { dpi: 150, quality: 0.9, label: '纯图防复制' },
};

export const tool = {
  init(app) {
    let src = null;
    let previewUrl = null;

    const page = toolPage({
      title: 'PDF 瘦身 / 转纯图',
      icon: '🪶',
      desc: '把每页栅格化后重新压缩，可大幅减小体积；也用于转成纯图片版、防止文字被复制篡改。代价是文字不再可选中。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const presetSel = select({
      label: '压缩档位', value: 'balanced',
      options: Object.entries(PRESETS).map(([k, v]) => [k, `${v.label}（${v.dpi} DPI）`]),
      onChange: () => { applyPreset(); schedulePreview(); },
    });
    const dpiRange = rangeInput({
      label: '分辨率', value: 120, min: 50, max: 400, step: 10,
      format: (v) => v + ' DPI', onChange: schedulePreview,
    });
    const qualityRange = rangeInput({
      label: 'JPEG 质量', value: 72, min: 20, max: 100, step: 1,
      format: (v) => v + '%', onChange: schedulePreview,
    });
    const grayToggle = toggle({ label: '转灰度（体积更小）', value: false, onChange: schedulePreview });
    const rangeInput1 = textInput({ label: '处理页面', placeholder: '留空=全部', onChange: () => { } });

    const preview = previewPane('选择 PDF 后这里会显示第 1 页压缩后的效果');
    const bar = progress();
    const btnExport = button('压缩并下载', doExport, { primary: true });
    btnExport.disabled = true;

    page.add(
      dz, info,
      fieldset('压缩参数', grid(presetSel, dpiRange), grid(qualityRange, grayToggle), rangeInput1),
      bar.root,
      preview,
    );
    page.setActions(btnExport);
    app.main.append(page.root);

    applyPreset(true);

    /* ---------------- 逻辑 ---------------- */

    function applyPreset(silent) {
      const p = PRESETS[presetSel.get()];
      if (!p) return;
      dpiRange.set(p.dpi);
      qualityRange.set(Math.round(p.quality * 100));
      if (!silent) toast(`已套用「${p.label}」`);
    }

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await openPdf(bytes);
        src = { name: file.name, bytes, numPages: doc.numPages };
        doc.destroy?.();
        info.textContent = `${file.name} · ${src.numPages} 页 · ${fmtBytes(bytes.length)}`;
        info.className = 'hint';
        btnExport.disabled = false;
        schedulePreview();
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    let timer = null;
    function schedulePreview() {
      clearTimeout(timer);
      timer = setTimeout(() => doPreview().catch((e) => console.error(e)), 420);
    }

    async function rasterize(pdf, n, dpi, quality, gray) {
      const { canvas, widthPt, heightPt } = await renderPage(pdf, n, dpi / 72);
      let outCanvas = canvas;
      if (gray) {
        const c2 = document.createElement('canvas');
        c2.width = canvas.width;
        c2.height = canvas.height;
        const ctx = c2.getContext('2d');
        ctx.filter = 'grayscale(1)';
        ctx.drawImage(canvas, 0, 0);
        outCanvas = c2;
      }
      const blob = await new Promise((r) => outCanvas.toBlob(r, 'image/jpeg', quality));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), widthPt, heightPt, px: outCanvas.width };
    }

    async function doPreview() {
      if (!src) return;
      const dpi = dpiRange.get(), q = qualityRange.get() / 100, gray = grayToggle.get();
      const doc = await openPdf(src.bytes);
      const { canvas, widthPt, heightPt, px } = await renderPage(doc, 1, dpi / 72);
      doc.destroy?.();

      let outCanvas = canvas;
      if (gray) {
        const c2 = document.createElement('canvas');
        c2.width = canvas.width; c2.height = canvas.height;
        const ctx = c2.getContext('2d');
        ctx.filter = 'grayscale(1)';
        ctx.drawImage(canvas, 0, 0);
        outCanvas = c2;
      }
      const blob = await new Promise((r) => outCanvas.toBlob(r, 'image/jpeg', q));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);

      preview.set(
        el('img', { src: previewUrl, alt: '压缩效果预览' }),
        el('p', { class: 'hint', text: `第 1 页渲染为 ${canvas.width}×${canvas.height} 像素，单页约 ${fmtBytes(blob.size)}` }),
      );
    }

    async function doExport() {
      const PDFLib = await loadPdfLib();
      const dpi = dpiRange.get(), q = qualityRange.get() / 100, gray = grayToggle.get();
      const pdf = await openPdf(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), pdf.numPages);
      if (!pages.length) throw new Error('页范围里没有有效页面');

      const out = await PDFLib.PDFDocument.create();
      let total = 0;
      for (let i = 0; i < pages.length; i++) {
        bar.show(i / pages.length, `正在处理第 ${pages[i]} 页（${i + 1}/${pages.length}）`);
        const r = await rasterize(pdf, pages[i], dpi, q, gray);
        const img = await out.embedJpg(r.bytes);
        const pg = out.addPage([r.widthPt, r.heightPt]);
        pg.drawImage(img, { x: 0, y: 0, width: r.widthPt, height: r.heightPt });
        total += r.bytes.length;
      }
      pdf.destroy?.();

      out.setProducer('Tools · PDF 瘦身');
      out.setModificationDate(new Date());
      bar.set(1, '正在写出文件…');
      const bytes = await out.save({ updateMetadata: false });

      const name = `${baseName(src.name)}_压缩_${dpi}dpi.pdf`;
      download(new Blob([bytes], { type: 'application/pdf' }), name);

      const ratio = bytes.length / src.bytes.length;
      const saved = ratio < 1 ? `减小 ${Math.round((1 - ratio) * 100)}%` : `增大 ${Math.round((ratio - 1) * 100)}%`;
      bar.set(1, `完成：${fmtBytes(src.bytes.length)} → ${fmtBytes(bytes.length)}（${saved}），共 ${pages.length} 页`);
      toast(`已导出 ${name}，体积${saved}`, ratio < 1 ? 'ok' : 'error');
      info.textContent = `${src.name} · ${src.numPages} 页 · ${fmtBytes(src.bytes.length)} → ${fmtBytes(bytes.length)}（${saved}）`;
    }

    return () => {
      clearTimeout(timer);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      src = null;
    };
  },
};
