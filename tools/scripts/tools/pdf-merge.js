import { toolPage, fileZone, el, button, actions, note, toast } from '../ui.js';
import { openPdf, parsePageRange, formatPageRange } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const items = [];          // { name, bytes, numPages, range }
    const page = toolPage({
      title: 'PDF 合并',
      icon: '🔗',
      desc: '把多个 PDF 的指定页面按顺序合并成一份新 PDF。每一份都能单独指定页范围，也可以调整先后顺序。',
    });

    const listHost = el('div', { class: 'filelist' });
    const status = note('还没有添加文件');

    const nameInput = el('input', {
      type: 'text',
      class: 'input',
      placeholder: '合并结果的文件名（留空自动命名）',
    });

    const dz = fileZone({
      accept: '.pdf,application/pdf',
      multiple: true,
      icon: '📚',
      title: '拖入多个 PDF，或点击选择',
      hint: '可以一次选多个；添加后逐份指定要合并的页范围',
      onFiles: addFiles,
    });

    const btnMerge = button('合并并下载', merge, { primary: true });
    btnMerge.disabled = true;

    page.add(dz, listHost, status, el('div', { class: 'card' }, nameInput));
    page.setActions(btnMerge, button('清空', clearAll));
    app.main.append(page.root);

    /* ---------------- 逻辑 ---------------- */

    async function addFiles(files) {
      for (const f of files) {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const doc = await openPdf(bytes);
          items.push({ name: f.name, bytes, numPages: doc.numPages, range: '' });
          doc.destroy?.();
        } catch (err) {
          toast(`${f.name} 打不开：${err.message}`, 'error');
        }
      }
      render();
    }

    function render() {
      listHost.replaceChildren();
      if (!items.length) {
        listHost.append(el('p', { class: 'hint', text: '还没有文件' }));
      }

      items.forEach((it, i) => {
        const pages = parsePageRange(it.range, it.numPages);
        const rangeInput = el('input', {
          type: 'text',
          class: 'input',
          placeholder: `全部（1-${it.numPages}）`,
          value: it.range,
          style: { maxWidth: '11rem' },
          'aria-label': `${it.name} 的页范围`,
        });
        rangeInput.addEventListener('input', () => {
          it.range = rangeInput.value;
          updateSummary();
        });

        listHost.append(el('div', { class: 'file-row' },
          el('span', { class: 'file-idx', text: String(i + 1) }),
          el('span', { class: 'file-name', title: it.name }, it.name,
            el('span', { class: 'file-note', text: `${it.numPages} 页` })),
          rangeInput,
          el('span', { class: 'file-note', text: `${pages.length} 页` }),
          el('span', { class: 'file-move' },
            button('↑', () => move(i, -1), { small: true, disabled: i === 0, title: '上移' }),
            button('↓', () => move(i, 1), { small: true, disabled: i === items.length - 1, title: '下移' }),
          ),
          button('移除', () => { items.splice(i, 1); render(); }, { small: true, danger: true }),
        ));
      });

      updateSummary();
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      render();
    }

    function updateSummary() {
      const total = items.reduce((s, it) => s + parsePageRange(it.range, it.numPages).length, 0);
      btnMerge.disabled = total === 0;
      status.textContent = items.length
        ? `${items.length} 份文件，合并后共 ${total} 页`
        : '还没有添加文件';
      status.className = 'hint' + (total ? '' : ' warn');
    }

    function clearAll() {
      items.length = 0;
      nameInput.value = '';
      render();
    }

    async function merge() {
      const PDFLib = await loadPdfLib();
      const out = await PDFLib.PDFDocument.create();
      let total = 0;

      for (const it of items) {
        const src = await PDFLib.PDFDocument.load(it.bytes);
        const pages = parsePageRange(it.range, src.getPageCount());
        if (!pages.length) continue;
        const copied = await out.copyPages(src, pages.map((p) => p - 1));
        for (const p of copied) out.addPage(p);
        total += copied.length;
      }

      if (!total) throw new Error('没有可合并的页面，请检查页范围');

      out.setTitle(nameInput.value.trim() || '合并文档');
      out.setProducer('Tools · PDF 合并');
      out.setCreator('Tools');
      const bytes = await out.save({ updateMetadata: false });

      const name = (nameInput.value.trim() || `合并结果_${stamp()}`).replace(/\.pdf$/i, '') + '.pdf';
      download(new Blob([bytes], { type: 'application/pdf' }), name);
      toast(`已合并 ${total} 页 → ${name}`, 'ok');
      status.textContent = `已导出 ${name}（${total} 页，${(bytes.length / 1024 / 1024).toFixed(2)} MB）`;
      status.className = 'hint ok';
    }

    render();
    return () => { /* 没有需要释放的资源 */ };
  },
};
