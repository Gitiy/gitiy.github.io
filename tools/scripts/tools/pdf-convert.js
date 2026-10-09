import {
  toolPage, fileZone, el, button, select, textInput, toggle, rangeInput,
  note, toast, grid, fieldset, progress,
} from '../ui.js';
import { openPdf, allText, hasTextLayer, parsePageRange, renderPage, pageText } from '../lib/pdfkit.js';
import { loadPdfLib, loadXLSX } from '../lib/scripts.js';
import { itemsToLines, itemsToGrid } from '../lib/table.js';
import { buildDocx, buildPptx, escapeXml } from '../lib/ooxml.js';
import { download, baseName } from '../lib/files.js';

const MODES = {
  docx: { title: 'PDF 转 Word', icon: '📘', ext: 'docx', needsText: true, desc: '提取文字与段落生成可编辑的 .docx。只还原文字内容与层级，复杂版式（分栏、表格线）不会保留。' },
  xlsx: { title: 'PDF 转 Excel', icon: '📗', ext: 'xlsx', needsText: true, desc: '按文字坐标还原成行列后导出 .xlsx。表格型 PDF 效果好；纯段落文本会退化成单列。' },
  pptx: { title: 'PDF 转 PPT', icon: '📙', ext: 'pptx', needsText: false, desc: '每页渲染成一张图铺满一页幻灯片，导出 .pptx。适合把 PDF 当演示稿用，页面外观完全一致。' },
  html: { title: 'PDF 转 HTML', icon: '🌐', ext: 'html', needsText: true, desc: '按坐标把文字绝对定位到 HTML，视觉上接近原版，文字可选中复制。' },
};

export const tool = {
  init(app) {
    const mode = app.toolDef?.params?.mode || 'docx';
    const cfg = MODES[mode] || MODES.docx;

    let src = null;

    const page = toolPage({ title: cfg.title, icon: cfg.icon, desc: cfg.desc });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const rangeInput1 = textInput({ label: '转换页面', placeholder: '留空=全部' });

    // 各模式专属选项
    const headingToggle = toggle({ label: '按字号识别标题', value: true });
    const oneSheetToggle = toggle({ label: '每页一个工作表', value: true });
    const dpiRange = rangeInput({ label: '幻灯片分辨率', value: 130, min: 60, max: 300, step: 10, format: (v) => v + ' DPI' });
    const gapToggle = toggle({ label: '按空行合并成段落', value: true });

    const optionBox = fieldset('选项',
      grid(rangeInput1),
      ...(mode === 'docx' ? [headingToggle, gapToggle] : []),
      ...(mode === 'xlsx' ? [oneSheetToggle] : []),
      ...(mode === 'pptx' ? [dpiRange] : []),
    );

    const bar = progress();
    const btnGo = button('转换并下载', run, { primary: true });
    btnGo.disabled = true;

    page.add(dz, info, optionBox, bar.root);
    page.setActions(btnGo);
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
        btnGo.disabled = false;
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    async function run() {
      const pdf = await openPdf(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), pdf.numPages);
      if (!pages.length) { pdf.destroy?.(); throw new Error('页范围里没有有效页面'); }

      // 需要文字的模式：先确认有文字层，避免导出空文件
      if (cfg.needsText) {
        bar.show(0, '正在检查文字层…');
        const probe = await hasTextLayer(pdf, 3);
        if (!probe.hasText) {
          pdf.destroy?.(); bar.hide();
          info.className = 'hint error';
          info.textContent = '这份 PDF 没有文字层（扫描件或纯图片），转成可编辑文档会得到空内容。可以先试「PDF 转 PPT」把每页转成图片，或先用 OCR 识别。';
          toast('没有文字层，无法转换', 'error');
          return;
        }
      }

      const base = baseName(src.name);
      if (mode === 'pptx') await runPptx(pdf, pages, base);
      else if (mode === 'xlsx') await runXlsx(pdf, pages, base);
      else if (mode === 'html') await runHtml(pdf, pages, base);
      else await runDocx(pdf, pages, base);
      pdf.destroy?.();
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
          // 页与页之间、或原文段落间距较大时插入空段落
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
        slides.push({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          ext: 'jpeg',
          widthPt, heightPt,
        });
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
          const left = it.x;
          const size = it.height * 0.95;
          return `<span style="left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;font-size:${size.toFixed(2)}px">${escapeXml(it.str)}</span>`;
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

    return () => { src = null; };
  },
};
