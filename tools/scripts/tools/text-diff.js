import { toolPage, el, button, toggle, note, fieldset, copyWithFeedback, grid } from '../ui.js';
import { download, stamp } from '../lib/files.js';

const MAX_DP = 4_000_000;   // LCS 动态规划的上限，超过就退化成粗粒度对比

/**
 * 行级差异。
 * 先裁掉公共前后缀（大多数真实文本差异很小），剩下部分再做 LCS；
 * 如果还是太大就退化成"全删 + 全增"，避免卡死浏览器。
 */
export function diffLines(a, b) {
  const out = [];
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;

  for (let i = 0; i < s; i++) out.push({ type: 'same', text: a[i] });

  const am = a.slice(s, a.length - e);
  const bm = b.slice(s, b.length - e);

  if (am.length * bm.length > MAX_DP) {
    for (const t of am) out.push({ type: 'del', text: t });
    for (const t of bm) out.push({ type: 'add', text: t });
  } else {
    const n = am.length, m = bm.length;
    const dp = new Uint32Array((n + 1) * (m + 1));
    const W = m + 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = am[i] === bm[j]
          ? dp[(i + 1) * W + j + 1] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { out.push({ type: 'same', text: am[i] }); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { out.push({ type: 'del', text: am[i] }); i++; }
      else { out.push({ type: 'add', text: bm[j] }); j++; }
    }
    while (i < n) { out.push({ type: 'del', text: am[i++] }); }
    while (j < m) { out.push({ type: 'add', text: bm[j++] }); }
  }

  for (let i = a.length - e; i < a.length; i++) out.push({ type: 'same', text: a[i] });
  return out;
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: '文本比较',
      icon: '🔍',
      desc: '逐行对比两段文本的差异，绿色为新增、红色为删除。适合比对配置、代码、名单的改动。',
    });

    const left = el('textarea', { class: 'input mono', rows: 10, placeholder: '原始文本…', 'aria-label': '原始文本' });
    const right = el('textarea', { class: 'input mono', rows: 10, placeholder: '修改后的文本…', 'aria-label': '修改后的文本' });
    const stat = note('两边都填上内容后点「比较」');
    const view = el('div', { class: 'diff-view', 'aria-label': '差异结果' });

    const ignoreCase = toggle({ label: '忽略大小写', value: false, onChange: () => run() });
    const ignoreSpace = toggle({ label: '忽略首尾空白', value: true, onChange: () => run() });

    const pane = (label, node) => el('div', { class: 'card' },
      el('p', { class: 'field-hint', text: label }), node);

    page.add(
      el('div', { class: 'diff-inputs' }, pane('原始文本', left), pane('修改后的文本', right)),
      fieldset('选项', grid(ignoreCase, ignoreSpace)),
      stat,
      view,
    );
    page.setActions(
      button('比较', run, { primary: true }),
      button('交换两边', () => { const t = left.value; left.value = right.value; right.value = t; run(); }),
      button('复制差异', () => {
        const lines = [...view.querySelectorAll('.diff-row')].map((r) => {
          const sign = r.classList.contains('add') ? '+ ' : r.classList.contains('del') ? '- ' : '  ';
          return sign + r.querySelector('.diff-text').textContent;
        });
        return copyWithFeedback(lines.join('\n'), '已复制差异');
      }),
      button('导出结果', () => {
        const lines = [...view.querySelectorAll('.diff-row')].map((r) => {
          const sign = r.classList.contains('add') ? '+ ' : r.classList.contains('del') ? '- ' : '  ';
          return sign + r.querySelector('.diff-text').textContent;
        });
        if (!lines.length) return;
        download(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `文本比较_${stamp()}.txt`);
      }),
      button('清空', () => { left.value = ''; right.value = ''; view.replaceChildren(); stat.textContent = '两边都填上内容后点「比较」'; stat.className = 'hint'; }),
    );
    app.main.append(page.root);

    /* ---------------- 逻辑 ---------------- */

    function norm(line) {
      let s = line;
      if (ignoreSpace.get()) s = s.trim();
      if (ignoreCase.get()) s = s.toLowerCase();
      return s;
    }

    function run() {
      const a = left.value.split(/\r?\n/);
      const b = right.value.split(/\r?\n/);
      if (!left.value && !right.value) {
        view.replaceChildren();
        stat.textContent = '两边都填上内容后点「比较」';
        stat.className = 'hint';
        return;
      }

      const na = a.map(norm), nb = b.map(norm);
      const diff = diffLines(na, nb);

      let add = 0, del = 0, same = 0;
      view.replaceChildren();
      let lnA = 1, lnB = 1;
      for (const d of diff) {
        const text = d.type === 'add' ? b[lnB - 1] : a[lnA - 1];
        const num = d.type === 'add' ? lnB : lnA;

        view.append(el('div', { class: 'diff-row ' + d.type },
          el('span', { class: 'diff-ln', text: String(num) }),
          el('span', { class: 'diff-sign', text: d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' ' }),
          el('span', { class: 'diff-text', text: text ?? '' }),
        ));

        if (d.type === 'add') { add++; lnB++; }
        else if (d.type === 'del') { del++; lnA++; }
        else { same++; lnA++; lnB++; }
      }

      const changed = add + del;
      stat.textContent = changed
        ? `新增 ${add} 行 · 删除 ${del} 行 · 相同 ${same} 行`
        : `两边完全一致（共 ${same} 行）`;
      stat.className = 'hint ' + (changed ? 'warn' : 'ok');
    }

    left.addEventListener('input', () => { if (right.value) run(); });
    right.addEventListener('input', () => { if (left.value) run(); });

    return () => { };
  },
};
