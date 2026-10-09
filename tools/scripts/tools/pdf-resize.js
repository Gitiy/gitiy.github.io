import {
  toolPage, fileZone, el, button, select, textInput, rangeInput,
  note, toast, grid, fieldset, previewPane,
} from '../ui.js';
import { openPdf, renderPage, parsePageRange } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName } from '../lib/files.js';

/** 标准纸张尺寸（pt） */
const SIZES = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
  b5: [498.9, 708.66],
};

export const tool = {
  init(app) {
    let src = null;
    let previewUrl = null;
    let timer = null;

    const page = toolPage({
      title: 'PDF 页面尺寸',
      icon: '📐',
      desc: '把页面统一改成 A4 / A3 / Letter 等标准尺寸，或按边距裁掉白边。改尺寸时文字仍可选中，不会被栅格化。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const modeSel = select({
      label: '操作', value: 'standard',
      options: [['standard', '改成标准尺寸'], ['crop', '按边距裁剪']],
      onChange: () => { sync(); schedule(); },
    });

    const sizeSel = select({
      label: '目标尺寸', value: 'a4',
      options: [
        ['a4', 'A4（210×297mm）'], ['a3', 'A3（297×420mm）'], ['a5', 'A5（148×210mm）'],
        ['letter', 'Letter（8.5×11in）'], ['legal', 'Legal（8.5×14in）'], ['b5', 'B5（176×250mm）'],
        ['keep', '保持原尺寸'],
      ],
      onChange: schedule,
    });
    const orientSel = select({
      label: '方向', value: 'auto',
      options: [['auto', '按页面自动'], ['portrait', '纵向'], ['landscape', '横向']],
      onChange: schedule,
    });
    const fitSel = select({
      label: '缩放方式', value: 'contain',
      options: [['contain', '等比缩放，四周留白'], ['stretch', '拉伸铺满'], ['none', '不缩放，居中裁切']],
      onChange: schedule,
    });
    const marginRange = rangeInput({
      label: '四周留白', value: 0, min: 0, max: 120, step: 2,
      format: (v) => v + ' pt', onChange: schedule,
    });

    const cropTop = rangeInput({ label: '上边距', value: 0, min: 0, max: 300, step: 2, format: (v) => v + ' pt', onChange: schedule });
    const cropBottom = rangeInput({ label: '下边距', value: 0, min: 0, max: 300, step: 2, format: (v) => v + ' pt', onChange: schedule });
    const cropLeft = rangeInput({ label: '左边距', value: 0, min: 0, max: 300, step: 2, format: (v) => v + ' pt', onChange: schedule });
    const cropRight = rangeInput({ label: '右边距', value: 0, min: 0, max: 300, step: 2, format: (v) => v + ' pt', onChange: schedule });

    const rangeInput1 = textInput({ label: '处理页面', placeholder: '留空=全部', onChange: schedule });

    const preview = previewPane('选择 PDF 后这里会显示第 1 页的效果');
    const btnExport = button('导出', doExport, { primary: true });
    btnExport.disabled = true;

    const standardBox = fieldset('目标尺寸', grid(sizeSel, orientSel), grid(fitSel, marginRange));
    const cropBox = fieldset('裁剪边距', grid(cropTop, cropBottom), grid(cropLeft, cropRight));

    page.add(dz, info, fieldset('操作方式', modeSel), standardBox, cropBox, fieldset('范围', rangeInput1), preview);
    page.setActions(btnExport);
    app.main.append(page.root);
    sync();

    /* ---------------- 逻辑 ---------------- */

    function sync() {
      const m = modeSel.get();
      standardBox.classList.toggle('hidden', m !== 'standard');
      cropBox.classList.toggle('hidden', m !== 'crop');
    }

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await openPdf(bytes);
        src = { name: file.name, bytes, numPages: doc.numPages };
        doc.destroy?.();
        info.textContent = `${file.name} · ${src.numPages} 页`;
        info.className = 'hint';
        btnExport.disabled = false;
        schedule();
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => doPreview().catch((e) => console.error(e)), 400);
    }

    function targetSize(pageW, pageH) {
      const key = sizeSel.get();
      let w, h;
      if (key === 'keep') { w = pageW; h = pageH; }
      else { [w, h] = SIZES[key]; }
      const o = orientSel.get();
      const landscape = o === 'landscape' || (o === 'auto' && pageW > pageH);
      if (landscape !== w > h) [w, h] = [h, w];
      return [w, h];
    }

    /**
     * 生成新的 PDF 文档。
     * 用「新建文档 + embedPage」而不是原地改源页：原地改需要清空内容流，容易把资源搞坏。
     */
    async function build(PDFLib, srcDoc, pageNums) {
      const inRange = new Set(pageNums);
      const out = await PDFLib.PDFDocument.create();
      const margin = marginRange.get();
      const crop = modeSel.get() === 'crop';

      for (let i = 0; i < srcDoc.getPageCount(); i++) {
        const srcPage = srcDoc.getPage(i);

        if (!inRange.has(i + 1)) {
          const [copied] = await out.copyPages(srcDoc, [i]);
          out.addPage(copied);
          continue;
        }

        if (crop) {
          const [copied] = await out.copyPages(srcDoc, [i]);
          const p = out.addPage(copied);
          const l = cropLeft.get(), r = cropRight.get(), t = cropTop.get(), b = cropBottom.get();
          const w = Math.max(10, p.getWidth() - l - r);
          const h = Math.max(10, p.getHeight() - t - b);
          p.setCropBox(l, b, w, h);
          continue;
        }

        const sw = srcPage.getWidth(), sh = srcPage.getHeight();
        const [tw, th] = targetSize(sw, sh);
        const availW = Math.max(1, tw - margin * 2);
        const availH = Math.max(1, th - margin * 2);

        const fit = fitSel.get();
        let sx, sy;
        if (fit === 'stretch') { sx = availW / sw; sy = availH / sh; }
        else if (fit === 'none') { sx = sy = 1; }
        else { sx = sy = Math.min(availW / sw, availH / sh); }

        const dw = sw * sx, dh = sh * sy;
        const embedded = await out.embedPage(srcPage);
        const np = out.addPage([tw, th]);
        np.drawPage(embedded, { x: (tw - dw) / 2, y: (th - dh) / 2, xScale: sx, yScale: sy });
      }
      return out;
    }

    async function doPreview() {
      if (!src) return;
      const PDFLib = await loadPdfLib();
      const srcDoc = await PDFLib.PDFDocument.load(src.bytes);
      const out = await build(PDFLib, srcDoc, [1]);
      const bytes = await out.save({ updateMetadata: false });

      const doc = await openPdf(bytes);
      const { canvas, widthPt, heightPt } = await renderPage(doc, 1, 1.1);
      doc.destroy?.();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.set(
        el('img', { src: previewUrl, alt: '页面尺寸预览' }),
        el('p', {
          class: 'hint',
          text: `处理后页面：${widthPt.toFixed(0)} × ${heightPt.toFixed(0)} pt（${(widthPt / 72 * 25.4).toFixed(0)} × ${(heightPt / 72 * 25.4).toFixed(0)} mm）`,
        }),
      );
    }

    async function doExport() {
      const PDFLib = await loadPdfLib();
      const srcDoc = await PDFLib.PDFDocument.load(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), srcDoc.getPageCount());
      if (!pages.length) throw new Error('页范围里没有有效页面');

      const out = await build(PDFLib, srcDoc, pages);
      out.setProducer('Tools · PDF 页面尺寸');
      out.setModificationDate(new Date());
      const bytes = await out.save({ updateMetadata: false });

      const name = `${baseName(src.name)}_${modeSel.get() === 'crop' ? '裁剪' : '尺寸'}.pdf`;
      download(new Blob([bytes], { type: 'application/pdf' }), name);
      toast(`已处理 ${pages.length} 页 → ${name}`, 'ok');
    }

    return () => {
      clearTimeout(timer);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      src = null;
    };
  },
};
