import {
  toolPage, el, button, select, note, toggle,
  copyWithFeedback, toast,
} from '../ui.js';
import { STYLES, convertCase, splitWords, convertAllCases } from '../lib/encode-text.js';
import { download, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: '命名风格转换',
      icon: '🐫',
      desc: 'camelCase / snake_case / kebab-case 等 14 种命名风格互转。能正确处理缩写词（HTTPServer → httpServer）与中文。',
    });

    const input = el('input', { type: 'text', class: 'input mono', placeholder: '输入变量名，例如 my_variable_name 或 HTTPServerConfig', 'aria-label': '输入' });
    const list = el('div', { class: 'case-list' });
    const wordBox = el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '.35rem' } });
    const stat = note('等待输入');

    const multiMode = toggle({ label: '多行模式（每行一个名字，批量转换）', value: false, onChange: run });
    const lines = el('textarea', { class: 'input mono', rows: 8, placeholder: '每行一个名字…', 'aria-label': '批量输入' });
    const bulkOut = el('textarea', { class: 'input mono', rows: 8, readonly: true, 'aria-label': '批量结果' });

    const bulkStyle = select({
      label: '批量转换目标风格', value: 'camel',
      options: STYLES.map((s) => [s.id, `${s.label}  例如 ${s.example}`]),
      onChange: runBulk,
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '输入' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => { input.value = 'HTTPServerConfig'; run(); }, { small: true }),
          button('清空', () => { input.value = ''; run(); }, { small: true }),
        ),
        el('p', { class: 'field-hint', text: '切分出的词' }),
        wordBox,
      ),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '全部风格' }), list),
      el('div', { class: 'card' }, multiMode.root),
      el('div', { class: 'card hidden', id: 'bulkCard' },
        el('p', { class: 'field-hint', text: '批量转换' }),
        bulkStyle.root,
        el('div', { class: 'grid2', style: { marginTop: '.5rem' } }, lines, bulkOut),
      ),
      stat,
    );
    page.setActions(
      button('复制全部', async () => {
        if (multiMode.get()) { await copyWithFeedback(bulkOut.value, '已复制'); return; }
        const text = convertAllCases(input.value).map((c) => `${c.label.padEnd(16)} ${c.value}`).join('\n');
        await copyWithFeedback(text, '已复制全部风格');
      }, { primary: true }),
      button('导出 txt', () => {
        const text = multiMode.get()
          ? bulkOut.value
          : convertAllCases(input.value).map((c) => `${c.label.padEnd(16)} ${c.value}`).join('\n');
        if (!text) { toast('没有可导出的内容', 'error'); return; }
        download(new Blob([text], { type: 'text/plain' }), `命名转换_${stamp()}.txt`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    const bulkCard = page.root.querySelector('#bulkCard');

    input.addEventListener('input', run);
    lines.addEventListener('input', runBulk);

    function render() {
      list.replaceChildren();
      if (!input.value.trim()) {
        list.append(el('p', { class: 'hint', text: '暂无结果' }));
        return;
      }
      for (const c of convertAllCases(input.value)) {
        list.append(el('div', { class: 'kv-row' },
          el('span', { class: 'kv-key', text: c.label }),
          el('code', { class: 'kv-val', text: c.value }),
          button('复制', async () => {
            const { copyText } = await import('../ui.js');
            const ok = await copyText(c.value);
            toast(ok ? '已复制' : '复制失败', ok ? 'ok' : 'error');
          }, { small: true }),
        ));
      }
    }

    function run() {
      const words = splitWords(input.value);
      wordBox.replaceChildren();
      if (!words.length) {
        wordBox.append(el('span', { class: 'hint', text: '—' }));
      } else {
        for (const w of words) wordBox.append(el('span', { class: 'chip', text: w }));
      }
      render();
      stat.textContent = words.length
        ? `切分出 ${words.length} 个词 · 共 ${STYLES.length} 种风格`
        : '等待输入';
      stat.className = words.length ? 'hint ok' : 'hint';
    }

    function runBulk() {
      bulkCard.classList.toggle('hidden', !multiMode.get());
      if (!multiMode.get()) return;
      const style = bulkStyle.get();
      const out = lines.value.split('\n').map((l) => (l.trim() ? convertCase(l.trim(), style) : ''));
      bulkOut.value = out.join('\n');
    }

    multiMode.node.addEventListener('change', () => { runBulk(); });

    run();
    return () => { };
  },
};
