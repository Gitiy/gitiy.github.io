import {
  toolPage, fileZone, el, button, select, textInput, note, toast,
  grid, fieldset, progress, copyWithFeedback,
} from '../ui.js';
import { openPdf, allText, hasTextLayer, parsePageRange } from '../lib/pdfkit.js';
import { download, makeZip, baseName } from '../lib/files.js';

export const tool = {
  init(app) {
    let src = null;
    let extracted = null;   // [{ page, text }]

    const page = toolPage({
      title: 'PDF 提取文字',
      icon: '📝',
      desc: '把 PDF 里的文字按页提取出来，可复制或导出 txt。只对含文字层的 PDF 有效——扫描件是图片，需要先做 OCR。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const modeSel = select({
      label: '输出方式', value: 'merged',
      options: [['merged', '合并成一个文本文件'], ['per-page', '每页一个 txt（打包 zip）']],
      onChange: () => { },
    });
    const rangeInput1 = textInput({ label: '提取页面', placeholder: '留空=全部' });

    const outArea = el('textarea', { class: 'input mono', rows: 16, readonly: true, 'aria-label': '提取结果' });
    const stat = note('');
    const bar = progress();

    const btnExtract = button('开始提取', extract, { primary: true });
    btnExtract.disabled = true;
    const btnCopy = button('复制', () => copyWithFeedback(outArea.value, '已复制全文'));
    const btnDownload = button('导出 txt', doDownload);
    btnCopy.disabled = true;
    btnDownload.disabled = true;

    page.add(dz, info, fieldset('选项', grid(modeSel, rangeInput1)), bar.root,
      el('div', { class: 'card' }, outArea, stat));
    page.setActions(btnExtract, btnCopy, btnDownload);
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
        btnExtract.disabled = false;
        extracted = null;
        outArea.value = '';
        btnCopy.disabled = btnDownload.disabled = true;
        stat.textContent = '';
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    async function extract() {
      const pdf = await openPdf(src.bytes);
      const pages = parsePageRange(rangeInput1.get(), pdf.numPages);
      if (!pages.length) { pdf.destroy?.(); throw new Error('页范围里没有有效页面'); }

      bar.show(0, '正在检查文字层…');
      const probe = await hasTextLayer(pdf, 3);
      if (!probe.hasText) {
        pdf.destroy?.();
        bar.hide();
        outArea.value = '';
        stat.className = 'hint error';
        stat.textContent = '这份 PDF 没有文字层（很可能是扫描件或纯图片），提取不到文字。需要先用 OCR 工具识别后再处理。';
        btnCopy.disabled = btnDownload.disabled = true;
        toast('没有文字层，提取不到内容', 'error');
        return;
      }

      const res = await allText(pdf, pages, (r, n) => bar.set(r, `正在提取第 ${n} 页…`));
      pdf.destroy?.();

      extracted = res.map((r) => ({ page: r.page, text: r.text }));
      const chars = extracted.reduce((s, r) => s + r.text.length, 0);
      const empty = extracted.filter((r) => !r.text).length;

      outArea.value = modeSel.get() === 'per-page'
        ? extracted.map((r) => `===== 第 ${r.page} 页 =====\n${r.text}`).join('\n\n')
        : extracted.map((r) => r.text).join('\n\n');

      bar.set(1, '提取完成');
      stat.className = 'hint' + (empty ? ' warn' : ' ok');
      stat.textContent = `共 ${extracted.length} 页，${chars} 个字符` +
        (empty ? `；其中 ${empty} 页没有文字（可能是插图页）` : '');
      btnCopy.disabled = btnDownload.disabled = false;
      toast(`提取完成，共 ${chars} 个字符`, 'ok');
    }

    async function doDownload() {
      if (!extracted) return;
      const base = baseName(src.name);
      if (modeSel.get() === 'per-page') {
        const zip = await makeZip(extracted.map((r) => ({
          name: `${base}_第${String(r.page).padStart(3, '0')}页.txt`,
          data: r.text,
        })));
        download(zip, `${base}_文字_${extracted.length}页.zip`);
        toast('已导出 zip', 'ok');
      } else {
        const txt = extracted.map((r) => r.text).join('\n\n');
        download(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
        toast('已导出 txt', 'ok');
      }
    }

    return () => { src = null; extracted = null; };
  },
};
