import { toolPage, fileZone, el, button, textInput, textArea, note, toast, grid, fieldset, copyWithFeedback } from '../ui.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, fmtBytes } from '../lib/files.js';

const FIELDS = [
  ['title', '标题', 'Title'],
  ['author', '作者', 'Author'],
  ['subject', '主题', 'Subject'],
  ['keywords', '关键词', 'Keywords（用逗号分隔）'],
  ['creator', '创建程序', 'Creator'],
  ['producer', '生成程序', 'Producer'],
];

export const tool = {
  init(app) {
    let src = null;

    const page = toolPage({
      title: 'PDF 元数据',
      icon: '🏷️',
      desc: '查看并修改 PDF 的标题、作者、主题、关键词等属性。这些信息会显示在阅读器的文档属性里。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf',
      multiple: false,
      icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      hint: '会立即读出当前的元数据',
      onFiles: (files) => load(files[0]),
    });

    const inputs = {};
    for (const [key, label, ph] of FIELDS) {
      inputs[key] = textInput({ label, placeholder: ph });
    }
    const dates = note('');
    const btnSave = button('保存并下载', save, { primary: true });
    btnSave.disabled = true;

    page.add(dz, info, fieldset('元数据', grid(...Object.values(inputs)), dates));
    page.setActions(btnSave, button('清空', () => { location.reload(); }));
    app.main.appendChild(page.root);

    /* ---------------- 逻辑 ---------------- */

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const PDFLib = await loadPdfLib();
        const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });

        const sizes = new Map();
        for (const p of doc.getPages()) {
          const k = `${Math.round(p.getWidth())}×${Math.round(p.getHeight())}pt`;
          sizes.set(k, (sizes.get(k) || 0) + 1);
        }
        const sizeText = [...sizes].map(([k, n]) => `${k} × ${n}页`).join('，');

        src = { name: file.name, bytes, pageCount: doc.getPageCount() };
        info.textContent = `${file.name} · ${doc.getPageCount()} 页 · ${fmtBytes(bytes.length)} · ${sizeText}`;
        info.className = 'hint';

        inputs.title.set(doc.getTitle() || '');
        inputs.author.set(doc.getAuthor() || '');
        inputs.subject.set(doc.getSubject() || '');
        inputs.keywords.set((doc.getKeywords() || '').toString());
        inputs.creator.set(doc.getCreator() || '');
        inputs.producer.set(doc.getProducer() || '');

        const c = doc.getCreationDate();
        const m = doc.getModificationDate();
        dates.textContent = `创建时间：${c ? c.toLocaleString() : '（未设置）'}　修改时间：${m ? m.toLocaleString() : '（未设置）'}`;

        btnSave.disabled = false;
      } catch (err) {
        toast('读取失败：' + err.message, 'error');
      }
    }

    async function save() {
      if (!src) return;
      const PDFLib = await loadPdfLib();
      const doc = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });

      doc.setTitle(inputs.title.get().trim());
      doc.setAuthor(inputs.author.get().trim());
      doc.setSubject(inputs.subject.get().trim());
      const kw = inputs.keywords.get().split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
      if (kw.length) doc.setKeywords(kw);
      doc.setCreator(inputs.creator.get().trim());
      doc.setProducer(inputs.producer.get().trim());
      doc.setModificationDate(new Date());

      // pdf-lib 的 updateInfoDict() 会在 save 时无条件覆写 Producer，必须关掉
      const bytes = await doc.save({ updateMetadata: false });
      const name = `${baseName(src.name)}_已改元数据.pdf`;
      download(new Blob([bytes], { type: 'application/pdf' }), name);
      toast(`已保存 → ${name}`, 'ok');
    }

    return () => { src = null; };
  },
};
