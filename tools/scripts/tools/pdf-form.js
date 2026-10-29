import { toolPage, fileZone, el, button, textInput, select, toggle, note, toast, fieldset, grid } from '../ui.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, fmtBytes } from '../lib/files.js';

/**
 * 判断字段类型。不用 constructor.name —— vendor 里是压缩过的 UMD 包，
 * 类名不保证保留；改成看有没有对应的方法，稳一些。
 */
function kindOf(f) {
  if (typeof f.setText === 'function') return 'text';
  if (typeof f.check === 'function' && typeof f.uncheck === 'function') return 'check';
  if (typeof f.getOptions === 'function' && typeof f.select === 'function') return 'choice';
  return 'unsupported';
}

const KIND_LABEL = {
  text: '文本',
  check: '勾选',
  choice: '单选 / 下拉',
  unsupported: '不支持',
};

export const tool = {
  init(app) {
    let src = null;
    let doc = null;
    let form = null;
    let rows = [];          // [{ field, kind, control }]

    const page = toolPage({
      title: 'PDF 表单填写',
      icon: '📝',
      desc: '读取 PDF 里的 AcroForm 表单字段，直接在浏览器里填好再导出。可选「扁平化」把内容固化，别人就不能再改。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf',
      multiple: false,
      icon: '📄',
      title: '拖入带表单的 PDF，或点击选择',
      hint: '会立即列出所有可填字段',
      onFiles: (files) => load(files[0]),
    });

    const body = el('div');
    const flatToggle = toggle({
      label: '导出时扁平化',
      value: true,
      hint: '把填写内容烧进页面，看起来和普通文字一样，不能再被编辑。关掉则保留可编辑的表单字段。',
    });
    const flatBox = fieldset('导出选项', flatToggle);
    flatBox.classList.add('hidden');

    const btnSave = button('填好并下载', save, { primary: true });
    btnSave.disabled = true;

    page.add(dz, info, body, flatBox);
    page.setActions(btnSave, button('全部清空', clearAll));
    app.main.appendChild(page.root);

    /* ---------------- 逻辑 ---------------- */

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const PDFLib = await loadPdfLib();
        doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false });

        let fields = [];
        try {
          form = doc.getForm();
          fields = form.getFields();
        } catch (e) {
          form = null;
        }

        if (!form || !fields.length) {
          src = null;
          body.replaceChildren();
          flatBox.classList.add('hidden');
          btnSave.disabled = true;
          info.textContent = `${file.name} · ${doc.getPageCount()} 页 · ${fmtBytes(bytes.length)}`;
          info.className = 'hint warn';
          body.append(note(
            '这份 PDF 里没有可填的 AcroForm 字段。可能是纯文字版、扫描件，或者用的是 XFA 表单（那种格式 pdf-lib 读不了）。',
            'warn',
          ));
          return;
        }

        src = { name: file.name, bytes };
        rows = buildRows(fields);

        const counts = {};
        for (const r of rows) counts[r.kind] = (counts[r.kind] || 0) + 1;
        const parts = Object.entries(counts)
          .filter(([k]) => k !== 'unsupported')
          .map(([k, n]) => `${KIND_LABEL[k]} ${n}`);
        const skipped = counts.unsupported || 0;

        info.textContent = `${file.name} · ${doc.getPageCount()} 页 · ${fmtBytes(bytes.length)} · 共 ${fields.length} 个字段` +
          (parts.length ? `（${parts.join('，')}${skipped ? `，跳过 ${skipped}` : ''}）` : '');
        info.className = 'hint' + (skipped ? ' warn' : '');

        flatBox.classList.remove('hidden');
        btnSave.disabled = false;
      } catch (err) {
        const msg = /encrypt/i.test(err.message || '')
          ? '这份 PDF 是加密的，先去掉密码再来填。'
          : err.message;
        toast('打不开这个 PDF：' + msg, 'error');
      }
    }

    function buildRows(fields) {
      const out = [];
      const usable = [];
      const skipped = [];

      for (const f of fields) {
        const kind = kindOf(f);
        if (kind === 'unsupported') { skipped.push(f); continue; }
        usable.push({ f, kind });
      }

      // 文本字段单独一组，其余按顺序
      const textRows = usable.filter((r) => r.kind === 'text');
      const otherRows = usable.filter((r) => r.kind !== 'text');

      const mk = (f, kind) => {
        const name = f.getName() || '(未命名字段)';
        const ro = typeof f.isReadOnly === 'function' && f.isReadOnly();
        let control;

        if (kind === 'text') {
          let val = '';
          try { val = f.getText() || ''; } catch { /* 有些字段取值会抛 */ }
          control = textInput({
            label: name,
            value: val,
            placeholder: typeof f.isMultiline === 'function' && f.isMultiline() ? '（多行文本）' : '',
            hint: ro ? '只读字段，改了也不会生效' : undefined,
          });
          if (ro) control.node.disabled = true;
        } else if (kind === 'check') {
          let val = false;
          try { val = !!f.isChecked(); } catch { }
          control = toggle({ label: name, value: val, hint: ro ? '只读字段' : undefined });
          if (ro) control.node.disabled = true;
        } else {
          let opts = [];
          try { opts = f.getOptions() || []; } catch { }
          let cur = '';
          try {
            const sel = f.getSelected ? f.getSelected() : null;
            cur = Array.isArray(sel) ? (sel[0] || '') : (sel || '');
          } catch { }
          const list = opts.length ? opts : [''];
          control = select({
            label: name,
            options: [['', '（不选）'], ...list.map((o) => [o, o])],
            value: cur,
            hint: ro ? '只读字段' : undefined,
          });
          if (ro) control.node.disabled = true;
        }

        const row = { field: f, kind, control, name };
        out.push(row);
        return row;
      };

      for (const { f, kind } of textRows) mk(f, kind);
      for (const { f, kind } of otherRows) mk(f, kind);

      const children = [];
      if (textRows.length) children.push(fieldset(`文本字段（${textRows.length}）`, grid(...out.filter((r) => r.kind === 'text').map((r) => r.control))));
      if (otherRows.length) children.push(fieldset(`勾选与选项（${otherRows.length}）`, grid(...out.filter((r) => r.kind !== 'text').map((r) => r.control))));
      if (skipped.length) {
        children.push(note(
          `另有 ${skipped.length} 个字段被跳过（按钮 / 签名域等，pdf-lib 无法填写）：` +
          skipped.slice(0, 8).map((f) => f.getName()).filter(Boolean).join('、') +
          (skipped.length > 8 ? ' …' : ''),
          'warn',
        ));
      }
      body.replaceChildren(...children);
      return out;
    }

    function clearAll() {
      for (const r of rows) {
        if (r.control.node.disabled) continue;
        if (r.kind === 'text') r.control.set('');
        else if (r.kind === 'check') r.control.set(false);
        else r.control.set('');
      }
      toast('已清空填写内容');
    }

    async function save() {
      if (!src || !doc || !form) return;
      try {
        let filled = 0;
        for (const r of rows) {
          if (r.control.node.disabled) continue;
          try {
            if (r.kind === 'text') {
              const v = r.control.get();
              if (v !== (r.field.getText() || '')) { r.field.setText(v); filled++; }
            } else if (r.kind === 'check') {
              const v = r.control.get();
              if (v !== !!r.field.isChecked()) { v ? r.field.check() : r.field.uncheck(); filled++; }
            } else {
              const v = r.control.get();
              if (v) { r.field.select(v); filled++; }
            }
          } catch (e) {
            console.warn('字段填写失败', r.name, e);
          }
        }

        let flattened = false;
        if (flatToggle.get()) {
          try { form.flatten(); flattened = true; }
          catch (e) { console.warn('扁平化失败', e); }
        }

        doc.setProducer('Tools · PDF 表单填写');
        doc.setModificationDate(new Date());
        const bytes = await doc.save({ updateMetadata: false });

        const name = `${baseName(src.name)}_已填表.pdf`;
        download(new Blob([bytes], { type: 'application/pdf' }), name);

        if (flatToggle.get() && !flattened) {
          toast(`已导出 ${name}，但扁平化没成功，字段仍是可编辑的`, 'warn');
        } else {
          toast(`已导出 ${name}（改了 ${filled} 个字段${flattened ? '，已扁平化' : ''}）`, 'ok');
        }
      } catch (err) {
        toast('导出失败：' + err.message, 'error');
      }
    }

    return () => {
      src = null;
      doc = null;
      form = null;
      rows = [];
    };
  },
};
