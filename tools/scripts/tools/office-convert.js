import {
  toolPage, fileZone, el, button, select, rangeInput, toggle,
  note, toast, grid, fieldset, progress,
} from '../ui.js';
import { loadDocxPreview, loadXLSX, loadHtmlToImage, loadJSZip, loadPdfLib } from '../lib/scripts.js';
import { download, makeZip, baseName, fmtBytes } from '../lib/files.js';

const ACCEPT = '.docx,.docm,.dotx,.xlsx,.xlsm,.xls,.csv,.tsv,.pptx,.pptm,.potx';
const KIND = { docx: 'Word', xlsx: 'Excel', csv: 'CSV', tsv: 'TSV', pptx: 'PowerPoint' };

/**
 * 输出成 PDF 还是图片，只是最后一步打包方式不同 —— 渲染管线完全一样，
 * 所以合成一个入口，用一个下拉框切换即可。
 */
const OUTPUTS = [
  {
    id: 'pdf', label: '合并成 PDF', short: 'PDF',
    note: '每个文件转成一份 PDF，尽量保留原始排版。多个文件会打包成 zip。',
  },
  {
    id: 'image', label: '逐页导出图片', short: '图片',
    note: '每个文件逐页导出 PNG / JPG，多页自动打包 zip。适合做预览图或喂给 OCR。',
  },
];

export const tool = {
  init(app) {
    const items = [];   // { name, buffer, kind, numPages }

    const page = toolPage({
      title: 'Office 转换',
      icon: '📄',
      desc: '把 Word / Excel / PowerPoint 转成 PDF 或图片，尽量保留原始排版。全部在本地渲染，文件不会上传。',
    });

    const listHost = el('div', { class: 'filelist' });
    const dz = fileZone({
      accept: ACCEPT,
      multiple: true, icon: '📊',
      title: '拖入 Word / Excel / PowerPoint 文件',
      hint: '支持 .docx .xlsx .xls .csv .pptx，可一次选多个',
      onFiles: addFiles,
    });

    const outSel = select({
      label: '输出为', value: 'pdf',
      options: OUTPUTS.map((o) => [o.id, o.label]),
      onChange: sync,
    });
    const outNote = note('');

    const dpiRange = rangeInput({
      label: '分辨率', value: 150, min: 72, max: 300, step: 6,
      format: (v) => v + ' DPI',
      hint: '文档里有小字号或细表格线时，调到 200 以上会更清楚。',
    });
    const qualityRange = rangeInput({
      label: 'JPEG 质量', value: 88, min: 40, max: 100, step: 1, format: (v) => v + '%',
    });
    const pngToggle = toggle({ label: 'PNG 无损输出（画面更准，体积更大）', value: false });

    const bar = progress();
    const btnGo = button('转换并下载', run, { primary: true });
    btnGo.disabled = true;

    page.add(dz, listHost, fieldset('输出设置', outSel, outNote, grid(dpiRange, qualityRange), pngToggle), bar.root);
    page.setActions(btnGo, button('清空', clearAll));
    app.main.append(page.root);

    function sync() {
      const o = OUTPUTS.find((x) => x.id === outSel.get()) || OUTPUTS[0];
      outNote.textContent = o.note;
      outNote.className = 'hint';
      btnGo.textContent = o.id === 'pdf' ? '转换成 PDF' : '导出图片';
    }

    /* ---------------- 逻辑 ---------------- */

    async function addFiles(files) {
      for (const f of files) {
        const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
        const kind = ['docx', 'docm', 'dotx'].includes(ext) ? 'docx'
          : ['xlsx', 'xlsm', 'xls'].includes(ext) ? 'xlsx'
            : ['csv', 'tsv'].includes(ext) ? ext
              : ['pptx', 'pptm', 'potx'].includes(ext) ? 'pptx' : null;
        if (!kind) { toast(`${f.name} 不是支持的 Office 格式`, 'error'); continue; }
        try {
          const buffer = await f.arrayBuffer();
          items.push({ name: f.name, buffer, kind, numPages: null });
        } catch (err) {
          toast(`${f.name} 读不了：${err.message}`, 'error');
        }
      }
      render();
    }

    function render() {
      listHost.replaceChildren();
      items.forEach((it, i) => {
        listHost.append(el('div', { class: 'file-row' },
          el('span', { class: 'file-idx', text: String(i + 1) }),
          el('span', { class: 'file-name', title: it.name }, it.name),
          el('span', { class: 'file-note', text: KIND[it.kind] + (it.numPages ? ` · ${it.numPages} 页` : '') }),
          button('移除', () => { items.splice(i, 1); render(); }, { small: true, danger: true }),
        ));
      });
      btnGo.disabled = items.length === 0;
    }

    function clearAll() {
      items.length = 0;
      render();
    }

    /** office.js 在模块顶层读取 globalThis 上的库，所以必须先加载脚本再 import */
    async function getOffice() {
      await Promise.all([loadDocxPreview(), loadXLSX(), loadHtmlToImage(), loadJSZip()]);
      return import('../lib/office.js');
    }

    async function convertOne(officeLib, it) {
      const office = await officeLib.loadOffice(it.buffer, it.name);
      it.numPages = office.numPages;

      const dpi = dpiRange.get();
      const usePng = pngToggle.get();
      const mime = usePng ? 'image/png' : 'image/jpeg';
      const quality = usePng ? undefined : qualityRange.get() / 100;

      const pages = [];
      for (let i = 0; i < office.numPages; i++) {
        const targetW = Math.round((office.widthPt / 72) * dpi);
        const canvas = await office.renderPage(i, targetW);
        const blob = await new Promise((r) => canvas.toBlob(r, mime, quality));
        pages.push({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          ext: usePng ? 'png' : 'jpeg',
          widthPt: office.widthPt,
          heightPt: office.heightPt,
        });
      }
      return pages;
    }

    async function run() {
      const officeLib = await getOffice();
      const out = outSel.get();
      const base = items.length === 1 ? baseName(items[0].name) : `Office转换_${items.length}份`;
      const outputs = [];
      const PDFLib = out === 'pdf' ? await loadPdfLib() : null;

      for (let n = 0; n < items.length; n++) {
        const it = items[n];
        bar.show(n / items.length, `正在渲染 ${it.name}…`);
        const pages = await convertOne(officeLib, it);
        render();

        if (out === 'pdf') {
          const doc = await PDFLib.PDFDocument.create();
          for (const p of pages) {
            const img = p.ext === 'png' ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes);
            const pg = doc.addPage([p.widthPt, p.heightPt]);
            pg.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
          }
          doc.setProducer('Tools · Office 转换');
          doc.setTitle(baseName(it.name));
          doc.setModificationDate(new Date());
          outputs.push({
            name: `${baseName(it.name)}.pdf`,
            data: new Uint8Array(await doc.save({ updateMetadata: false })),
          });
        } else {
          const ext = pngToggle.get() ? 'png' : 'jpg';
          pages.forEach((p, i) => outputs.push({
            name: pages.length > 1
              ? `${baseName(it.name)}_${String(i + 1).padStart(3, '0')}.${ext}`
              : `${baseName(it.name)}.${ext}`,
            data: p.bytes,
          }));
        }
      }

      if (outputs.length === 1) {
        const mime = out === 'pdf' ? 'application/pdf' : (pngToggle.get() ? 'image/png' : 'image/jpeg');
        download(new Blob([outputs[0].data], { type: mime }), outputs[0].name);
        bar.set(1, `完成：${outputs[0].name}（${fmtBytes(outputs[0].data.length)}）`);
        toast(`已导出 ${outputs[0].name}`, 'ok');
      } else {
        bar.set(0.92, '正在打包…');
        const zip = await makeZip(outputs);
        const name = `${base}_${outputs.length}个.zip`;
        download(zip, name);
        bar.set(1, `完成：${outputs.length} 个文件 → ${name}`);
        toast(`已导出 ${name}`, 'ok');
      }
    }

    sync();
    return () => { items.length = 0; };
  },
};
