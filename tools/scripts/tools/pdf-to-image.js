import {
  toolPage, fileZone, el, button, select, textInput, rangeInput, toggle,
  note, toast, grid, fieldset, previewPane, progress,
} from '../ui.js';
import { openPdf, renderPage, parsePageRange } from '../lib/pdfkit.js';
import { download, makeZip, baseName, fmtBytes } from '../lib/files.js';

export const tool = {
  init(app) {
    let src = null;

    const page = toolPage({
      title: 'PDF 转图片',
      icon: '🖼️',
      desc: '把 PDF 逐页导出成 PNG 或 JPG。可自定分辨率与质量，多页结果自动打包成 zip。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const fmtSel = select({
      label: '图片格式', value: 'png',
      options: [['png', 'PNG（无损，体积大）'], ['jpeg', 'JPG（有损，体积小）']],
      onChange: () => { qualityRange.root.classList.toggle('hidden', fmtSel.get() !== 'jpeg'); schedulePreview(); },
    });
    const dpiRange = rangeInput({
      label: '分辨率', value: 150, min: 50, max: 400, step: 10,
      format: (v) => v + ' DPI', onChange: schedulePreview,
    });
    const qualityRange = rangeInput({
      label: 'JPG 质量', value: 85, min: 30, max: 100, step: 1,
      format: (v) => v + '%', onChange: schedulePreview,
    });
    const grayToggle = toggle({ label: '转灰度', value: false, onChange: schedulePreview });
    const rangeInput1 = textInput({ label: '导出页面', placeholder: '留空=全部，如 1-3,5', onChange: schedulePreview });

    const preview = previewPane('选择 PDF 后这里会显示第 1 页的导出效果');
    const bar = progress();
    const btnExport = button('导出图片', doExport, { primary: true });
    btnExport.disabled = true;

    page.add(dz, info, fieldset('输出参数', grid(fmtSel, dpiRange), grid(qualityRange, grayToggle), rangeInput1), bar.root, preview);
    page.setActions(btnExport);
    app.main.append(page.root);
    qualityRange.root.classList.add('hidden');

    let timer = null, previewUrl = null;

    /* ---------------- 逻辑 ---------------- */

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

    function schedulePreview() {
      clearTimeout(timer);
      timer = setTimeout(() => doPreview().catch((e) => console.error(e)), 420);
    }

    async function renderToBlob(pdf, n, dpi, type, quality, gray) {
      const { canvas } = await renderPage(pdf, n, dpi / 72);
      let c = canvas;
      if (gray) {
        const c2 = document.createElement('canvas');
        c2.width = canvas.width; c2.height = canvas.height;
        const ctx = c2.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c2.width, c2.height);
        ctx.filter = 'grayscale(1)';
        ctx.drawImage(canvas, 0, 0);
        c = c2;
      }
      const mime = type === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((r) => c.toBlob(r, mime, type === 'png' ? undefined : quality));
      return { blob, width: c.width, height: c.height };
    }

    async function doPreview() {
      if (!src) return;
      const pdf = await openPdf(src.bytes);
      const { blob, width, height } = await renderToBlob(
        pdf, 1, dpiRange.get(), fmtSel.get(), qualityRange.get() / 100, grayToggle.get());
      pdf.destroy?.();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.set(
        el('img', { src: previewUrl, alt: '导出预览' }),
        el('p', { class: 'hint', text: `第 1 页：${width}×${height} 像素，约 ${fmtBytes(blob.size)}` }),
      );
    }

    async function doExport() {
      const pdf = await openPdf(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), pdf.numPages);
      if (!pages.length) throw new Error('页范围里没有有效页面');

      const type = fmtSel.get();
      const ext = type === 'png' ? 'png' : 'jpg';
      const base = baseName(src.name);
      const outputs = [];
      let bytesTotal = 0;

      for (let i = 0; i < pages.length; i++) {
        bar.show(i / pages.length, `正在渲染第 ${pages[i]} 页（${i + 1}/${pages.length}）`);
        const { blob } = await renderToBlob(pdf, pages[i], dpiRange.get(), type, qualityRange.get() / 100, grayToggle.get());
        const data = new Uint8Array(await blob.arrayBuffer());
        bytesTotal += data.length;
        outputs.push({
          name: pages.length > 1 ? `${base}_${String(pages[i]).padStart(3, '0')}.${ext}` : `${base}.${ext}`,
          data,
        });
      }
      pdf.destroy?.();

      if (outputs.length === 1) {
        download(new Blob([outputs[0].data], { type: type === 'png' ? 'image/png' : 'image/jpeg' }), outputs[0].name);
        toast(`已导出 ${outputs[0].name}`, 'ok');
        bar.set(1, `完成：${outputs[0].name}（${fmtBytes(bytesTotal)}）`);
      } else {
        bar.set(0.9, '正在打包 zip…');
        const zip = await makeZip(outputs);
        const name = `${base}_图片_${outputs.length}张.zip`;
        download(zip, name);
        toast(`已导出 ${name}`, 'ok');
        bar.set(1, `完成：${outputs.length} 张图片，共 ${fmtBytes(bytesTotal)}`);
      }
    }

    return () => {
      clearTimeout(timer);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      src = null;
    };
  },
};
