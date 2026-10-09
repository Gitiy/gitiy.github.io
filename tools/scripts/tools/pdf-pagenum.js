import {
  toolPage, fileZone, el, button, select, textInput, rangeInput, colorInput,
  note, toast, grid, fieldset, previewPane,
} from '../ui.js';
import { openPdf, renderPage, parsePageRange } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { makeTextImage } from '../lib/draw.js';
import { download, baseName } from '../lib/files.js';

const POSITIONS = [
  ['bottom-center', '底部居中'],
  ['bottom-right', '右下角'],
  ['bottom-left', '左下角'],
  ['top-center', '顶部居中'],
  ['top-right', '右上角'],
  ['top-left', '左上角'],
];

const FORMATS = [
  ['n', '1'],
  ['n-of-m', '1 / 10'],
  ['cn-n', '第 1 页'],
  ['cn-full', '第 1 页 / 共 10 页'],
  ['dash', '— 1 —'],
];

function labelText(fmt, n, total, offset) {
  const cur = n + offset - 1;
  switch (fmt) {
    case 'n-of-m': return `${cur} / ${total}`;
    case 'cn-n': return `第 ${cur} 页`;
    case 'cn-full': return `第 ${cur} 页 / 共 ${total} 页`;
    case 'dash': return `— ${cur} —`;
    default: return String(cur);
  }
}

export const tool = {
  init(app) {
    let src = null;
    let previewUrl = null;
    let timer = null;

    const page = toolPage({
      title: 'PDF 加页码',
      icon: '🔢',
      desc: '批量添加页码。可设置位置、起始编号、字号、颜色和「第 N 页 / 共 M 页」等格式。中文用画布渲染，不依赖 PDF 字体。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const posSel = select({ label: '位置', value: 'bottom-center', options: POSITIONS, onChange: schedule });
    const fmtSel = select({ label: '格式', value: 'n-of-m', options: FORMATS, onChange: schedule });
    const startNum = rangeInput({
      label: '起始编号', value: 1, min: 1, max: 200, step: 1,
      format: (v) => '第 ' + v + ' 页起', onChange: schedule,
    });
    const sizeRange = rangeInput({
      label: '字号', value: 10, min: 5, max: 30, step: 1, format: (v) => v + ' pt', onChange: schedule,
    });
    const marginRange = rangeInput({
      label: '边距', value: 28, min: 8, max: 120, step: 2, format: (v) => v + ' pt', onChange: schedule,
    });
    const colorPick = colorInput({ label: '颜色', value: '#444444', onChange: schedule });
    const rangeInput1 = textInput({ label: '应用页面', placeholder: '留空=全部，如 2-', onChange: schedule });

    const preview = previewPane('选择 PDF 后这里会显示第 1 页的效果预览');
    const btnExport = button('导出带页码的 PDF', doExport, { primary: true });
    btnExport.disabled = true;

    page.add(
      dz, info,
      fieldset('位置与格式', grid(posSel, fmtSel), grid(startNum, sizeRange), grid(marginRange, colorPick)),
      fieldset('范围', rangeInput1),
      preview,
    );
    page.setActions(btnExport);
    app.main.append(page.root);

    /* ---------------- 逻辑 ---------------- */

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
      timer = setTimeout(() => doPreview().catch((e) => console.error(e)), 300);
    }

    const cache = new Map();
    /** 画布按 fontPx 渲染，画布高度里还含上下留白，所以要按比例反推出绘制高度 */
    function labelImage(text, sizePt) {
      const key = text + '|' + sizePt + '|' + colorPick.get();
      if (!cache.has(key)) {
        const fontPx = Math.round(sizePt * 6);
        cache.set(key, { ...makeTextImage(text, { color: colorPick.get(), fontPx, padding: 0.12 }), fontPx });
      }
      return cache.get(key);
    }

    /** 给 pdf-lib 文档的指定页画页码；返回实际处理的页数 */
    async function addPageNumbers(PDFLib, doc, pageNums, total) {
      const offset = startNum.get();
      const sizePt = sizeRange.get();
      const margin = marginRange.get();
      const pos = posSel.get();
      const fmt = fmtSel.get();
      const { degrees } = PDFLib;

      for (const n of pageNums) {
        const p = doc.getPage(n - 1);
        const pw = p.getWidth(), ph = p.getHeight();
        const text = labelText(fmt, n, total, offset);
        const { canvas, fontPx } = labelImage(text, sizePt);

        // 让文字的实际 em 尺寸等于设定的字号
        const h = (sizePt * canvas.height) / fontPx;
        const w = h * (canvas.width / canvas.height);

        const img = await doc.embedPng(canvas.toDataURL('image/png'));
        const [v, hh] = pos.split('-');
        const x = hh === 'center' ? (pw - w) / 2 : hh === 'right' ? pw - margin - w : margin;
        const y = v === 'bottom' ? margin : ph - margin - h;
        p.drawImage(img, { x, y, width: w, height: h, rotate: degrees(0) });
      }
      return pageNums.length;
    }

    async function doPreview() {
      if (!src) return;
      const PDFLib = await loadPdfLib();
      const full = await PDFLib.PDFDocument.load(src.bytes);
      const out = await PDFLib.PDFDocument.create();
      const [first] = await out.copyPages(full, [0]);
      out.addPage(first);
      await addPageNumbers(PDFLib, out, [1], src.numPages);

      const bytes = await out.save({ updateMetadata: false });
      const doc = await openPdf(bytes);
      const { canvas } = await renderPage(doc, 1, 1.2);
      doc.destroy?.();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.set(el('img', { src: previewUrl, alt: '页码效果预览' }));
    }

    async function doExport() {
      const PDFLib = await loadPdfLib();
      const doc = await PDFLib.PDFDocument.load(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), doc.getPageCount());
      if (!pages.length) throw new Error('页范围里没有有效页面');
      await addPageNumbers(PDFLib, doc, pages, doc.getPageCount());

      doc.setProducer('Tools · PDF 加页码');
      doc.setModificationDate(new Date());
      const bytes = await doc.save({ updateMetadata: false });
      const name = `${baseName(src.name)}_页码.pdf`;
      download(new Blob([bytes], { type: 'application/pdf' }), name);
      toast(`已给 ${pages.length} 页加页码 → ${name}`, 'ok');
    }

    return () => {
      clearTimeout(timer);
      cache.clear();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      src = null;
    };
  },
};
