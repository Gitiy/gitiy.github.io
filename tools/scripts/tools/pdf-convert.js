import {
  toolPage, fileZone, el, button, select, textInput, toggle, rangeInput,
  note, toast, grid, fieldset, progress, previewPane,
} from '../ui.js';
import { openPdf, hasTextLayer, parsePageRange, renderPage, pageText } from '../lib/pdfkit.js';
import { loadPdfLib, loadXLSX } from '../lib/scripts.js';
import { itemsToLines, itemsToGrid } from '../lib/table.js';
import { buildDocx, buildPptx, escapeXml } from '../lib/ooxml.js';
import { download, makeZip, baseName, fmtBytes } from '../lib/files.js';

/**
 * 五种目标格式合在一个入口里。
 * 之前 Word / Excel / PPT / HTML / 图片 各占一张卡片，同一份 PDF 想换个格式
 * 得先退出再进另一个工具；现在选格式即可，文件不用重新拖。
 */
const FORMATS = [
  {
    id: 'docx', label: 'Word 文档 (.docx)', short: 'Word', icon: '📘', ext: 'docx', needsText: true,
    note: '导出可编辑的文字与段落层级。复杂版式（分栏、表格线、图片位置）不会保留 —— 这是纯前端转换的固有限制。',
  },
  {
    id: 'xlsx', label: 'Excel 表格 (.xlsx)', short: 'Excel', icon: '📗', ext: 'xlsx', needsText: true,
    note: '按文字坐标还原成行列。表格型 PDF 效果好；整段文字会退化成单列。',
  },
  {
    id: 'pptx', label: 'PowerPoint (.pptx)', short: 'PPT', icon: '📙', ext: 'pptx', needsText: false,
    note: '每页渲染成一张图铺满一页幻灯片，外观与原版完全一致，但内容不可编辑。',
  },
  {
    id: 'html', label: '网页 (.html)', short: 'HTML', icon: '🌐', ext: 'html', needsText: true,
    note: '按坐标绝对定位，视觉接近原版，文字可以选中复制。',
  },
  {
    id: 'image', label: '图片 (PNG / JPG)', short: '图片', icon: '🖼️', ext: 'png', needsText: false,
    note: '逐页导出图片，多页自动打包 zip。适合做预览图，或喂给 OCR 做文字识别。',
  },
];

export const tool = {
  init(app) {
    let src = null;

    const page = toolPage({
      title: 'PDF 转换',
      icon: '🔄',
      desc: '把 PDF 转成 Word / Excel / PPT / HTML 或图片。选好目标格式再点导出即可，换个格式不用重新拖文件。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    /* ---------- 目标格式 ---------- */
    const fmtSel = select({
      label: '目标格式', value: 'docx',
      options: FORMATS.map((f) => [f.id, f.label]),
      onChange: () => { sync(); schedulePreview(); },
    });
    const fmtNote = note('');

    /* ---------- 通用选项 ---------- */
    const rangeInput1 = textInput({ label: '转换页面', placeholder: '留空=全部，如 1-3,5' , onChange: schedulePreview });

    /* ---------- 各格式专属选项 ---------- */
    const headingToggle = toggle({ label: '按字号识别标题', value: true });
    const gapToggle = toggle({ label: '按空行合并成段落', value: true });
    const oneSheetToggle = toggle({ label: '每页一个工作表', value: true });
    const dpiRange = rangeInput({ label: '渲染分辨率', value: 150, min: 50, max: 400, step: 10, format: (v) => v + ' DPI', onChange: schedulePreview });
    const imgFmtSel = select({
      label: '图片格式', value: 'png',
      options: [['png', 'PNG（无损，体积大）'], ['jpeg', 'JPG（有损，体积小）']],
      onChange: () => { sync(); schedulePreview(); },
    });
    const qualityRange = rangeInput({ label: 'JPG 质量', value: 85, min: 30, max: 100, step: 1, format: (v) => v + '%', onChange: schedulePreview });
    const grayToggle = toggle({ label: '转灰度', value: false, onChange: schedulePreview });

    const preview = previewPane('选好目标格式后，这里会显示第 1 页的导出效果');
    const bar = progress();
    const btnGo = button('转换并下载', run, { primary: true });
    btnGo.disabled = true;

    page.add(
      dz, info,
      fieldset('目标格式', fmtSel, fmtNote),
      fieldset('选项',
        rangeInput1,
        headingToggle, gapToggle, oneSheetToggle,
        dpiRange,
        grid(imgFmtSel, qualityRange), grayToggle,
      ),
      bar.root, preview,
    );
    page.setActions(btnGo);
    app.main.append(page.root);

    let timer = null;
    let previewUrl = null;

    /* ---------------- 界面同步 ---------------- */

    const cur = () => FORMATS.find((f) => f.id === fmtSel.get()) || FORMATS[0];

    function sync() {
      const f = cur();
      fmtNote.textContent = f.note;
      fmtNote.className = 'hint';
      btnGo.textContent = f.id === 'image' ? '导出图片' : `转换成 ${f.short}`;

      const isImg = f.id === 'image';
      headingToggle.root.classList.toggle('hidden', f.id !== 'docx');
      gapToggle.root.classList.toggle('hidden', f.id !== 'docx');
      oneSheetToggle.root.classList.toggle('hidden', f.id !== 'xlsx');
      dpiRange.root.classList.toggle('hidden', !(f.id === 'pptx' || isImg));
      imgFmtSel.root.classList.toggle('hidden', !isImg);
      qualityRange.root.classList.toggle('hidden', !isImg || imgFmtSel.get() !== 'jpeg');
      grayToggle.root.classList.toggle('hidden', !isImg);

      // 只有导出图片时才有像素级预览可看
      preview.root.classList.toggle('hidden', !isImg);
      if (!isImg && previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    }

    function schedulePreview() {
      clearTimeout(timer);
      if (fmtSel.get() !== 'image' || !src) return;
      timer = setTimeout(() => doPreview().catch((e) => console.error(e)), 420);
    }

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
        btnGo.disabled = false;
        schedulePreview();
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    async function run() {
      const f = cur();
      const pdf = await openPdf(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), pdf.numPages);
      if (!pages.length) { pdf.destroy?.(); throw new Error('页范围里没有有效页面'); }

      // 需要文字层的格式先探测一下，避免导出空文件
      if (f.needsText) {
        bar.show(0, '正在检查文字层…');
        const probe = await hasTextLayer(pdf, 3);
        if (!probe.hasText) {
          pdf.destroy?.(); bar.hide();
          info.className = 'hint error';
          info.textContent = '这份 PDF 没有文字层（扫描件或纯图片），转成可编辑文档只会得到空内容。'
            + '可以先选「PowerPoint」或「图片」把每页转成图，或者先用 OCR 识别文字。';
          toast('没有文字层，无法转换成可编辑格式', 'error');
          return;
        }
      }

      const base = baseName(src.name);
      try {
        if (f.id === 'docx') await runDocx(pdf, pages, base);
        else if (f.id === 'xlsx') await runXlsx(pdf, pages, base);
        else if (f.id === 'pptx') await runPptx(pdf, pages, base);
        else if (f.id === 'html') await runHtml(pdf, pages, base);
        else await runImage(pdf, pages, base);
      } finally {
        pdf.destroy?.();
      }
    }

    /* ---------- Word ---------- */
    async function runDocx(pdf, pages, base) {
      const paragraphs = [];
      for (let i = 0; i < pages.length; i++) {
        bar.show(i / pages.length, `正在解析第 ${pages[i]} 页…`);
        const { items } = await pageText(pdf, pages[i]);
        const lines = itemsToLines(items);
        if (!lines.length) continue;
        if (pages.length > 1) paragraphs.push({ text: `— 第 ${pages[i]} 页 —`, level: 0 });

        const heights = lines.map((l) => Math.max(...l.items.map((it) => it.height)));
        const sorted = [...heights].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 10;

        lines.forEach((l, li) => {
          const text = l.cells.map((c) => c.text).join('  ').trim();
          if (!text) return;
          const h = Math.max(...l.items.map((it) => it.height));
          let level = 0;
          if (headingToggle.get()) {
            if (h > median * 1.5) level = 1;
            else if (h > median * 1.2) level = 2;
          }
          if (gapToggle.get() && li > 0 && Math.abs(lines[li - 1].y - l.y) > h * 2.1) {
            paragraphs.push({ text: '' });
          }
          paragraphs.push({ text, level });
        });
      }

      bar.set(0.95, '正在生成 docx…');
      const size = await pageSizeOf(pdf, pages[0]);
      const blob = await buildDocx({ paragraphs, pageSizePt: size, title: base });
      download(blob, `${base}.docx`);
      bar.set(1, `完成：${paragraphs.length} 个段落 → ${base}.docx`);
      toast(`已导出 ${base}.docx`, 'ok');
    }

    async function pageSizeOf(pdf, n) {
      const p = await pdf.getPage(n);
      const vp = p.getViewport({ scale: 1 });
      const size = { widthPt: vp.width, heightPt: vp.height };
      p.cleanup();
      return size;
    }

    /* ---------- Excel ---------- */
    async function runXlsx(pdf, pages, base) {
      const XLSX = await loadXLSX();
      const wb = XLSX.utils.book_new();

      if (oneSheetToggle.get()) {
        for (let i = 0; i < pages.length; i++) {
          bar.show(i / pages.length, `正在解析第 ${pages[i]} 页…`);
          const { items } = await pageText(pdf, pages[i]);
          const { rows } = itemsToGrid(items);
          const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['（本页没有可提取的文字）']]);
          XLSX.utils.book_append_sheet(wb, ws, `Page${pages[i]}`.slice(0, 31));
        }
      } else {
        const all = [];
        for (let i = 0; i < pages.length; i++) {
          bar.show(i / pages.length, `正在解析第 ${pages[i]} 页…`);
          const { items } = await pageText(pdf, pages[i]);
          const { rows } = itemsToGrid(items);
          if (i > 0) all.push([]);
          all.push(...rows);
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(all.length ? all : [['（没有可提取的文字）']]), 'Sheet1');
      }

      bar.set(0.95, '正在生成 xlsx…');
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`);
      bar.set(1, `完成：${wb.SheetNames.length} 个工作表 → ${base}.xlsx`);
      toast(`已导出 ${base}.xlsx`, 'ok');
    }

    /* ---------- PPT ---------- */
    async function runPptx(pdf, pages, base) {
      const slides = [];
      for (let i = 0; i < pages.length; i++) {
        bar.show(i / pages.length, `正在渲染第 ${pages[i]} 页…`);
        const { canvas, widthPt, heightPt } = await renderPage(pdf, pages[i], dpiRange.get() / 72);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
        slides.push({ bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpeg', widthPt, heightPt });
      }
      bar.set(0.92, '正在生成 pptx…');
      const blob = await buildPptx({ slides, title: base });
      download(blob, `${base}.pptx`);
      bar.set(1, `完成：${slides.length} 张幻灯片 → ${base}.pptx`);
      toast(`已导出 ${base}.pptx`, 'ok');
    }

    /* ---------- HTML ---------- */
    async function runHtml(pdf, pages, base) {
      const parts = [];
      for (let i = 0; i < pages.length; i++) {
        bar.show(i / pages.length, `正在解析第 ${pages[i]} 页…`);
        const { items, widthPt, heightPt } = await pageText(pdf, pages[i]);
        const spans = items.map((it) => {
          const top = heightPt - it.y - it.height * 0.82;
          const size = it.height * 0.95;
          return `<span style="left:${it.x.toFixed(2)}px;top:${top.toFixed(2)}px;font-size:${size.toFixed(2)}px">${escapeXml(it.str)}</span>`;
        }).join('\n');
        parts.push(`<section class="page" style="width:${widthPt.toFixed(0)}px;height:${heightPt.toFixed(0)}px">\n${spans}\n</section>`);
      }

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeXml(base)}</title>
<style>
  body { margin:0; padding:24px; background:#ececec; font-family:"Helvetica","PingFang SC","Microsoft YaHei",sans-serif; }
  .page { position:relative; margin:0 auto 20px; background:#fff; box-shadow:0 2px 10px rgba(0,0,0,.15); overflow:hidden; }
  .page span { position:absolute; white-space:pre; color:#111; line-height:1; transform-origin:0 0; }
</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;

      download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${base}.html`);
      bar.set(1, `完成：${pages.length} 页 → ${base}.html`);
      toast(`已导出 ${base}.html`, 'ok');
    }

    /* ---------- 图片 ---------- */
    async function renderToBlob(pdf, n, dpi, type, quality, gray) {
      const { canvas } = await renderPage(pdf, n, dpi / 72);
      let c = canvas;
      if (gray) {
        const c2 = document.createElement('canvas');
        c2.width = canvas.width;
        c2.height = canvas.height;
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
      if (!src || fmtSel.get() !== 'image') return;
      const pdf = await openPdf(src.bytes);
      const { blob, width, height } = await renderToBlob(
        pdf, 1, dpiRange.get(), imgFmtSel.get(), qualityRange.get() / 100, grayToggle.get());
      pdf.destroy?.();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.set(
        el('img', { src: previewUrl, alt: '导出预览' }),
        el('p', { class: 'hint', text: `第 1 页：${width}×${height} 像素，约 ${fmtBytes(blob.size)}` }),
      );
    }

    async function runImage(pdf, pages, base) {
      const type = imgFmtSel.get();
      const ext = type === 'png' ? 'png' : 'jpg';
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

    sync();
    return () => {
      clearTimeout(timer);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      src = null;
    };
  },
};
