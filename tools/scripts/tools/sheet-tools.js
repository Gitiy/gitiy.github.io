import {
  toolPage, fileZone, el, button, select, toggle, textInput,
  note, toast, grid, fieldset, previewPane,
} from '../ui.js';
import { loadXLSX } from '../lib/scripts.js';
import { download, baseName, readBytes } from '../lib/files.js';

/**
 * 输入是 Excel / CSV / TSV，输出有 6 种。原先拆成了「表格格式转换」和
 * 「Excel 转 JSON」两个入口，其实只是目标格式不同 —— 合成一个，
 * 选到 JSON 时再显示 JSON 专属选项。
 */
const TARGETS = [
  ['xlsx', 'Excel (.xlsx)', 'xlsx'],
  ['csv', 'CSV', 'csv'],
  ['tsv', 'TSV', 'tsv'],
  ['json', 'JSON', 'json'],
  ['html', 'HTML 表格', 'html'],
  ['md', 'Markdown 表格', 'md'],
];

export const tool = {
  init(app) {
    let book = null;          // SheetJS workbook
    let src = null;

    const page = toolPage({
      title: '表格转换',
      icon: '📊',
      desc: 'Excel / CSV / TSV 互转，也可以导出 JSON / HTML / Markdown。首行可作字段名，支持选工作表与自定义分隔符。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.xlsx,.xlsm,.xls,.csv,.tsv',
      multiple: false, icon: '📊',
      title: '拖入 Excel / CSV / TSV 文件',
      onFiles: (files) => load(files[0]),
    });

    const sheetSel = select({ label: '工作表', value: '', options: [['', '（先选择文件）']], onChange: () => updatePreview() });
    const outSel = select({
      label: '输出格式', value: 'xlsx',
      options: TARGETS.map(([v, l]) => [v, l]),
      onChange: () => { syncOptions(); },
    });
    const jsonShape = select({
      label: 'JSON 形式', value: 'objects',
      options: [['objects', '对象数组（首行为字段名）'], ['arrays', '二维数组']],
      onChange: () => { syncOptions(); },
    });
    const headerToggle = toggle({ label: '首行作为字段名', value: true });
    const delimInput = textInput({ label: 'CSV / TSV 分隔符', value: '', hint: '留空用默认（CSV 逗号、TSV 制表符）；也可以填 \\t 表示制表符' });

    const preview = previewPane('选择文件后这里会显示前几行');
    const btnGo = button('转换并下载', run, { primary: true });
    btnGo.disabled = true;

    page.add(dz, info, fieldset('选项', grid(sheetSel, outSel), grid(jsonShape, headerToggle), delimInput), preview);
    page.setActions(btnGo);
    app.main.append(page.root);
    syncOptions();

    /* ---------------- 界面同步 ---------------- */

    function syncOptions() {
      const isJson = outSel.get() === 'json';
      jsonShape.root.classList.toggle('hidden', !isJson);
      headerToggle.root.classList.toggle('hidden', !isJson || jsonShape.get() === 'arrays');
      delimInput.root.classList.toggle('hidden', !['csv', 'tsv'].includes(outSel.get()));
      btnGo.textContent = isJson ? '导出 JSON' : `导出 ${TARGETS.find(([v]) => v === outSel.get())[1]}`;
    }

    /* ---------------- 逻辑 ---------------- */

    async function load(file) {
      if (!file) return;
      try {
        const XLSX = await loadXLSX();
        const bytes = await readBytes(file);
        book = XLSX.read(bytes, { type: 'array', raw: false, cellDates: true });
        src = { name: file.name };

        const names = book.SheetNames;
        sheetSel.node.replaceChildren(...names.map((n) => el('option', { value: n, text: n })));
        sheetSel.set(names[0]);
        info.textContent = `${file.name} · ${names.length} 个工作表：${names.join('、')}`;
        info.className = 'hint';
        btnGo.disabled = false;
        updatePreview();
      } catch (err) {
        toast('读不了这个表格：' + err.message, 'error');
      }
    }

    function currentRows() {
      if (!book) return [];
      const XLSX = globalThis.XLSX;
      const ws = book.Sheets[sheetSel.get()];
      if (!ws) return [];
      return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    }

    function updatePreview() {
      const rows = currentRows();
      if (!rows.length) { preview.set(el('p', { class: 'hint', text: '这个工作表是空的' })); return; }
      const head = rows.slice(0, 8);
      const cols = Math.max(...head.map((r) => r.length));
      const table = el('table', { class: 'data-table' },
        el('tbody', {}, head.map((r, i) => el('tr', {},
          el('th', { text: String(i + 1) }),
          Array.from({ length: Math.min(cols, 8) }, (_, c) => el('td', { text: String(r[c] ?? '') })),
        ))),
      );
      preview.set(
        el('p', { class: 'hint', text: `共 ${rows.length} 行 × ${cols} 列（预览前 ${head.length} 行、前 8 列）` }),
        table,
      );
    }

    async function run() {
      const XLSX = await loadXLSX();
      const rows = currentRows();
      if (!rows.length) throw new Error('这个工作表没有数据');

      const fmt = outSel.get();
      const base = baseName(src.name);
      let data, name;

      if (fmt === 'json') {
        let json;
        if (jsonShape.get() === 'arrays') {
          json = rows;
        } else {
          const [head, ...body] = rows;
          const keys = head.map((h, i) => String(h || `列${i + 1}`));
          json = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
        }
        data = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' });
        name = `${base}.json`;
      } else if (fmt === 'csv' || fmt === 'tsv') {
        const delim = (delimInput.get() || (fmt === 'csv' ? ',' : '\t')).replace('\\t', '\t');
        data = new Blob(['\ufeff' + XLSX.utils.sheet_to_csv(book.Sheets[sheetSel.get()], { FS: delim + ';' })],
          { type: 'text/csv;charset=utf-8' });
        name = `${base}.${fmt}`;
      } else if (fmt === 'html') {
        const html = XLSX.utils.sheet_to_html(book.Sheets[sheetSel.get()]);
        data = new Blob([`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${base}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px}</style>
</head><body>${html}</body></html>`], { type: 'text/html;charset=utf-8' });
        name = `${base}.html`;
      } else if (fmt === 'md') {
        const md = XLSX.utils.sheet_to_json(book.Sheets[sheetSel.get()], { header: 1, blankrows: false })
          .map((r, i) => {
            const cells = r.map((c) => String(c ?? '').replace(/\|/g, '\\|'));
            const line = '| ' + cells.join(' | ') + ' |';
            if (i !== 0) return line;
            return line + '\n| ' + cells.map(() => '---').join(' | ') + ' |';
          }).join('\n');
        data = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        name = `${base}.md`;
      } else {
        const out = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
        data = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        name = `${base}.xlsx`;
      }

      download(data, name);
      toast(`已导出 ${name}`, 'ok');
    }

    return () => { book = null; src = null; };
  },
};
