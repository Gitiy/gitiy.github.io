import {
  toolPage, el, button, toggle, select, note, toast, grid, fieldset,
  copyWithFeedback, actions,
} from '../ui.js';
import { download, baseName, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: '文本去重',
      icon: '🧹',
      desc: '去掉重复行，可选忽略大小写与首尾空白、剔除空行、排序。处理结果实时显示。',
    });

    const input = el('textarea', { class: 'input mono', rows: 12, placeholder: '把文本粘贴到这里，每行一条…', 'aria-label': '原始文本' });
    const output = el('textarea', { class: 'input mono', rows: 12, readonly: true, 'aria-label': '去重结果' });
    const stat = note('等待输入');

    const ignoreCase = toggle({ label: '忽略大小写', value: true, onChange: run });
    const trimSpaces = toggle({ label: '忽略行首尾空白', value: true, onChange: run });
    const dropEmpty = toggle({ label: '剔除空行', value: true, onChange: run });
    const sortOut = select({
      label: '排序', value: 'none',
      options: [['none', '保持原顺序'], ['asc', '升序'], ['desc', '降序'], ['len', '按长度']],
      onChange: run,
    });
    const keepMode = select({
      label: '重复时保留', value: 'first',
      options: [['first', '第一次出现的写法'], ['last', '最后一次出现的写法']],
      onChange: run,
    });

    page.add(
      el('div', { class: 'card' }, el('label', { class: 'field' }, el('span', { class: 'field-label', text: '原始文本' })), input),
      fieldset('选项', grid(ignoreCase, trimSpaces), grid(dropEmpty, sortOut), keepMode),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '去重结果' }), output, stat),
    );
    page.setActions(
      button('去重', run, { primary: true }),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
      button('导出 txt', () => {
        if (!output.value) { toast('没有可导出的内容', 'error'); return; }
        download(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), `去重结果_${stamp()}.txt`);
        toast('已导出 txt', 'ok');
      }),
      button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    /* ---------------- 逻辑 ---------------- */

    function run() {
      const raw = input.value;
      if (!raw.trim()) {
        output.value = '';
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      const lines = raw.split(/\r?\n/);
      const ic = ignoreCase.get();
      const trim = trimSpaces.get();
      const drop = dropEmpty.get();

      const map = new Map();   // key -> { text, index }
      let removed = 0, empty = 0;

      lines.forEach((line, i) => {
        let text = trim ? line.trim() : line;
        if (!text.trim() && drop) { empty++; return; }
        let key = trim ? text.trim() : text;
        if (ic) key = key.toLowerCase();
        if (map.has(key)) {
          removed++;
          if (keepMode.get() === 'last') map.set(key, { text, index: i });
        } else {
          map.set(key, { text, index: i });
        }
      });

      let out = [...map.values()].sort((a, b) => a.index - b.index).map((v) => v.text);
      const mode = sortOut.get();
      if (mode === 'asc') out.sort((a, b) => a.localeCompare(b, 'zh'));
      else if (mode === 'desc') out.sort((a, b) => b.localeCompare(a, 'zh'));
      else if (mode === 'len') out.sort((a, b) => a.length - b.length);

      output.value = out.join('\n');
      const parts = [`原始 ${lines.length} 行`, `去重后 ${out.length} 行`, `删除重复 ${removed} 行`];
      if (empty) parts.push(`剔除空行 ${empty} 行`);
      stat.textContent = parts.join(' · ');
      stat.className = 'hint ok';
    }

    run();
    return () => { };
  },
};
