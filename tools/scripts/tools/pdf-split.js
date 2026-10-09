import { toolPage, fileZone, el, button, select, textInput, numberInput, note, toast, grid } from '../ui.js';
import { openPdf, parsePageRange, formatPageRange } from '../lib/pdfkit.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, makeZip, baseName, stamp, fmtBytes } from '../lib/files.js';

export const tool = {
  init(app) {
    let src = null;              // { name, bytes, numPages }
    let plan = [];               // [{ name, pages }]

    const page = toolPage({
      title: 'PDF 拆分',
      icon: '✂️',
      desc: '把 PDF 按页范围拆成多份，或把每一页单独导出。结果多于一份时自动打包成 zip。',
    });

    const info = note('还没有选择文件');
    const planHost = el('div', { class: 'filelist' });

    const dz = fileZone({
      accept: '.pdf,application/pdf',
      multiple: false,
      icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      hint: '拆分规则可以在下面切换',
      onFiles: (files) => load(files[0]),
    });

    const modeSel = select({
      label: '拆分方式',
      value: 'each',
      options: [
        ['each', '每页一个文件'],
        ['every', '每 N 页一份'],
        ['ranges', '自定义多段范围（每段一个文件）'],
        ['extract', '只提取一个范围（输出单份）'],
      ],
      onChange: () => { syncMode(); buildPlan(); },
    });

    const everyN = numberInput({ label: '每份页数', value: 1, min: 1, max: 500, onChange: buildPlan });
    const rangesInput = textInput({
      label: '范围',
      value: '1-3,4-6,7-',
      hint: '用逗号分隔，每段生成一个文件。支持 1-3、5、7- 三种写法',
      onChange: buildPlan,
    });

    const btnExport = button('导出', doExport, { primary: true });
    btnExport.disabled = true;

    page.add(dz, info, modeSel, grid(everyN, rangesInput), planHost);
    page.setActions(btnExport);
    app.main.append(page.root);

    syncMode();
    buildPlan();

    /* ---------------- 逻辑 ---------------- */

    function syncMode() {
      const m = modeSel.get();
      everyN.root.classList.toggle('hidden', m !== 'every');
      rangesInput.root.classList.toggle('hidden', m === 'each' || m === 'every');
    }

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await openPdf(bytes);
        src = { name: file.name, bytes, numPages: doc.numPages };
        doc.destroy?.();
        info.textContent = `${src.name} · ${src.numPages} 页 · ${fmtBytes(bytes.length)}`;
        info.className = 'hint';
        buildPlan();
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    function buildPlan() {
      plan = [];
      const base = src ? baseName(src.name) : 'document';

      if (src) {
        const m = modeSel.get();
        if (m === 'each') {
          for (let i = 1; i <= src.numPages; i++) plan.push({ name: `${base}_${String(i).padStart(3, '0')}.pdf`, pages: [i] });
        } else if (m === 'every') {
          const n = Math.max(1, everyN.get() || 1);
          let part = 1;
          for (let i = 1; i <= src.numPages; i += n) {
            const pages = [];
            for (let j = i; j < i + n && j <= src.numPages; j++) pages.push(j);
            plan.push({ name: `${base}_part${String(part).padStart(2, '0')}.pdf`, pages });
            part++;
          }
        } else {
          const chunks = String(rangesInput.get()).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
          chunks.forEach((spec, i) => {
            const pages = parsePageRange(spec, src.numPages);
            if (!pages.length) return;
            plan.push({
              name: chunks.length === 1 ? `${base}_提取.pdf` : `${base}_${formatPageRange(pages).replace(/[^\d-]/g, '_') || i + 1}.pdf`,
              pages,
            });
          });
        }
      }

      renderPlan();
    }

    function renderPlan() {
      planHost.replaceChildren();
      if (!plan.length) {
        planHost.append(el('p', { class: 'hint', text: src ? '当前规则下没有可导出的页面' : '还没有选择文件' }));
        btnExport.disabled = true;
        return;
      }
      const total = plan.reduce((s, p) => s + p.pages.length, 0);
      planHost.append(el('p', { class: 'hint', text: `将生成 ${plan.length} 个文件，共 ${total} 页` }));
      const show = plan.slice(0, 60);
      for (const p of show) {
        planHost.append(el('div', { class: 'file-row' },
          el('span', { class: 'file-name', title: p.name }, p.name),
          el('span', { class: 'file-note', text: `${formatPageRange(p.pages)}（${p.pages.length} 页）` }),
        ));
      }
      if (plan.length > show.length) {
        planHost.append(el('p', { class: 'hint', text: `…还有 ${plan.length - show.length} 个未列出` }));
      }
      btnExport.disabled = false;
    }

    async function doExport() {
      const PDFLib = await loadPdfLib();
      const doc = await PDFLib.PDFDocument.load(src.bytes);
      const outputs = [];

      for (const p of plan) {
        const out = await PDFLib.PDFDocument.create();
        const copied = await out.copyPages(doc, p.pages.map((n) => n - 1));
        for (const pg of copied) out.addPage(pg);
        out.setProducer('Tools · PDF 拆分');
        outputs.push({ name: p.name, data: await out.save({ updateMetadata: false }) });
      }

      if (outputs.length === 1) {
        download(new Blob([outputs[0].data], { type: 'application/pdf' }), outputs[0].name);
        toast(`已导出 ${outputs[0].name}`, 'ok');
      } else {
        const zip = await makeZip(outputs);
        const name = `${baseName(src.name)}_拆分_${outputs.length}份.zip`;
        download(zip, name);
        toast(`已导出 ${name}`, 'ok');
      }
    }

    return () => { src = null; plan = []; };
  },
};
