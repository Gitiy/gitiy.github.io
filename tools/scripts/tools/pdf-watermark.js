import {
  toolPage, fileZone, el, button, select, textInput, rangeInput, colorInput,
  note, toast, grid, fieldset, previewPane, actions, fileList,
} from '../ui.js';
import { openPdf, renderPage, parsePageRange } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, stamp } from '../lib/files.js';
import { makeTextImage, centerRotatedBox } from '../lib/draw.js';

export const tool = {
  init(app) {
    let src = null;
    let markBytes = null;      // 图片水印的原始字节
    let previewTimer = null;
    let previewUrl = null;

    const page = toolPage({
      title: 'PDF 加水印',
      icon: '💧',
      desc: '给 PDF 加文字或图片水印。支持平铺整页或居中单个，可调大小、颜色、透明度和角度。文字水印用画布渲染，中文没问题。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const typeSel = select({
      label: '水印类型', value: 'text',
      options: [['text', '文字水印'], ['image', '图片水印']],
      onChange: () => { syncType(); schedulePreview(); },
    });
    const textInput1 = textInput({ label: '文字', value: '机密 · 内部资料', onChange: schedulePreview });
    const sizeRange = rangeInput({
      label: '大小', value: 14, min: 3, max: 60, step: 1,
      format: (v) => v + '% 页宽', onChange: schedulePreview,
    });
    const colorPick = colorInput({ label: '颜色', value: '#e11d48', onChange: schedulePreview });
    const opacityRange = rangeInput({
      label: '透明度', value: 22, min: 2, max: 100, step: 1,
      format: (v) => v + '%', onChange: schedulePreview,
    });
    const rotateRange = rangeInput({
      label: '旋转', value: 45, min: -90, max: 90, step: 1,
      format: (v) => v + '°', onChange: schedulePreview,
    });
    const layoutSel = select({
      label: '排布', value: 'tile',
      options: [['tile', '平铺整页'], ['center', '居中单个'], ['corner', '右下角']],
      onChange: () => { syncType(); schedulePreview(); },
    });
    const gapRange = rangeInput({
      label: '平铺间距', value: 40, min: 0, max: 200, step: 5,
      format: (v) => v + 'pt', onChange: schedulePreview,
    });
    const rangeInput1 = textInput({
      label: '应用页面', placeholder: '留空=全部，如 1-3,5',
      onChange: schedulePreview,
    });

    const imgZone = fileZone({
      accept: 'image/png,image/jpeg,image/webp', multiple: false, icon: '🖼️',
      title: '选择水印图片（建议透明底 PNG）',
      onFiles: async (files) => {
        const f = files[0];
        markBytes = new Uint8Array(await f.arrayBuffer());
        toast(`水印图片：${f.name}`);
        schedulePreview();
      },
    });

    const preview = previewPane('选择 PDF 后这里会显示第 1 页的效果预览');
    const btnExport = button('应用到全部并下载', doExport, { primary: true });
    btnExport.disabled = true;

    page.add(
      dz, info,
      fieldset('水印内容', typeSel, textInput1, imgZone),
      fieldset('样式', grid(sizeRange, colorPick, opacityRange, rotateRange), grid(layoutSel, gapRange)),
      fieldset('范围', rangeInput1),
      preview,
    );
    page.setActions(btnExport);
    app.main.append(page.root);

    syncType();

    /* ---------------- 逻辑 ---------------- */

    function syncType() {
      const isText = typeSel.get() === 'text';
      textInput1.root.classList.toggle('hidden', !isText);
      colorPick.root.classList.toggle('hidden', !isText);
      imgZone.root.classList.toggle('hidden', isText);
      gapRange.root.classList.toggle('hidden', layoutSel.get() !== 'tile');
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
        schedulePreview();
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => doPreview().catch((e) => console.error(e)), 320);
    }

    /** 只处理第 1 页，用真实产物渲染，保证预览与导出一致 */
    async function doPreview() {
      if (!src) return;
      const PDFLib = await loadPdfLib();
      const full = await PDFLib.PDFDocument.load(src.bytes);
      const out = await PDFLib.PDFDocument.create();
      const [first] = await out.copyPages(full, [0]);
      out.addPage(first);

      const applied = await applyWatermark(PDFLib, out, [1]);
      if (!applied) {
        preview.set(el('p', { class: 'hint warn', text: '当前设置下第 1 页不会加水印' }));
        return;
      }

      const bytes = await out.save({ updateMetadata: false });
      const doc = await openPdf(bytes);
      const { canvas } = await renderPage(doc, 1, 1.2);
      doc.destroy?.();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.set(el('img', { src: previewUrl, alt: '水印效果预览' }));
    }

    /** 把水印画到 pdf-lib 文档上；返回是否真的画了 */
    async function applyWatermark(PDFLib, doc, pageNums) {
      const isText = typeSel.get() === 'text';
      let image = null;
      let aspect = 1;

      if (isText) {
        const text = textInput1.get().trim();
        if (!text) return false;
        const { canvas, aspect: a } = makeTextImage(text, { color: colorPick.get() });
        aspect = a;
        image = await doc.embedPng(canvas.toDataURL('image/png'));
      } else {
        if (!markBytes) return false;
        const isPng = markBytes[0] === 0x89 && markBytes[1] === 0x50;
        image = isPng ? await doc.embedPng(markBytes) : await doc.embedJpg(markBytes);
        aspect = image.height / image.width;
      }

      const opacity = opacityRange.get() / 100;
      const rot = rotateRange.get();
      const layout = layoutSel.get();
      const { degrees } = PDFLib;

      for (const n of pageNums) {
        const p = doc.getPage(n - 1);
        const pw = p.getWidth(), ph = p.getHeight();
        const w = (sizeRange.get() / 100) * pw;
        const h = w * aspect;

        if (layout === 'tile') {
          const gap = gapRange.get();
          const stepX = w + gap;
          const stepY = h + gap * 0.6;
          let row = 0;
          for (let y = -h; y < ph + h; y += stepY, row++) {
            const offset = row % 2 ? stepX / 2 : 0;
            for (let x = -w + offset; x < pw + w; x += stepX) {
              const box = centerRotatedBox(x + w / 2, y + h / 2, w, h, rot);
              p.drawImage(image, { x: box.x, y: box.y, width: w, height: h, opacity, rotate: degrees(rot) });
            }
          }
        } else if (layout === 'center') {
          const box = centerRotatedBox(pw / 2, ph / 2, w, h, rot);
          p.drawImage(image, { x: box.x, y: box.y, width: w, height: h, opacity, rotate: degrees(rot) });
        } else {
          const pad = Math.max(12, pw * 0.03);
          const box = centerRotatedBox(pw - pad - w / 2, pad + h / 2, w, h, rot);
          p.drawImage(image, { x: box.x, y: box.y, width: w, height: h, opacity, rotate: degrees(rot) });
        }
      }
      return true;
    }

    async function doExport() {
      const PDFLib = await loadPdfLib();
      const doc = await PDFLib.PDFDocument.load(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), doc.getPageCount());
      if (!pages.length) throw new Error('页范围里没有有效页面');
      const ok = await applyWatermark(PDFLib, doc, pages);
      if (!ok) throw new Error('请先填写水印内容');

      doc.setProducer('Tools · PDF 加水印');
      doc.setModificationDate(new Date());
      const bytes = await doc.save({ updateMetadata: false });
      const name = `${baseName(src.name)}_水印.pdf`;
      download(new Blob([bytes], { type: 'application/pdf' }), name);
      toast(`已给 ${pages.length} 页加水印 → ${name}`, 'ok');
    }

    return () => {
      clearTimeout(previewTimer);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      src = null; markBytes = null;
    };
  },
};
