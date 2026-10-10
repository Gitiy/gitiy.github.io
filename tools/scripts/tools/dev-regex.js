import {
  toolPage, el, button, toggle, note, grid, fieldset,
  copyWithFeedback, toast, textInput,
} from '../ui.js';

const FLAGS = [
  ['g', 'g 全局匹配'],
  ['i', 'i 忽略大小写'],
  ['m', 'm 多行（^ $ 匹配每行）'],
  ['s', 's . 匹配换行'],
  ['u', 'u Unicode 模式'],
];

/** 把匹配位置标出来，用 DOM 节点而不是 innerHTML，避免把用户内容当 HTML 解析 */
function highlight(text, matches) {
  // 注意：collectMatches 返回的是 { index, groups }，不是原生数组，
  // 所以取匹配文本要用 m.groups[0] 而不是 m[0]。
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of matches) {
    const hit = m.groups[0] ?? '';
    if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
    if (hit) frag.append(el('mark', { class: 're-hit', text: hit }));
    last = m.index + hit.length;
    if (hit.length === 0) { // 零宽匹配，往前挪一格避免死循环
      if (last < text.length) frag.append(document.createTextNode(text[last]));
      last++;
    }
  }
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

function collectMatches(re, text, limit = 5000) {
  const out = [];
  if (re.global || re.sticky) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && out.length < limit) {
      out.push({ index: m.index, groups: [...m], named: m.groups ? { ...m.groups } : null });
      if (m[0].length === 0) re.lastIndex++;
    }
  } else {
    const m = re.exec(text);
    if (m) out.push({ index: m.index, groups: [...m], named: m.groups ? { ...m.groups } : null });
  }
  return out;
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: '正则测试与替换',
      icon: '🔍',
      desc: '实时高亮匹配结果，列出每个匹配与捕获组，并预览替换后的文本。支持所有 JS 正则标志。',
    });

    const pattern = el('input', { type: 'text', class: 'input mono', value: '(\\w+)@(\\w+\\.\\w+)', placeholder: '正则表达式（不含两侧斜杠）', 'aria-label': '正则表达式' });
    const flagsBox = el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '.75rem' } });
    const text = el('textarea', { class: 'input mono', rows: 8, placeholder: '把待匹配的文本粘贴到这里…', 'aria-label': '测试文本' });
    const highlightBox = el('div', { class: 're-view' });
    const matchList = el('div', { class: 'match-list' });
    const stat = note('');

    const replaceInput = textInput({ label: '替换为（支持 $1 $2 $<name>）', value: '', placeholder: '留空则只看匹配', onChange: run });
    const replaced = el('textarea', { class: 'input mono', rows: 6, readonly: true, 'aria-label': '替换结果' });

    const flagState = { g: true, i: false, m: false, s: false, u: false };
    for (const [f, label] of FLAGS) {
      const t = toggle({
        label, value: flagState[f],
        onChange: (v) => { flagState[f] = v; run(); },
      });
      flagsBox.append(t.root);
    }

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '正则表达式' }), pattern),
        el('p', { class: 'field-hint', text: '标志' }),
        flagsBox,
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => {
            pattern.value = '(\\w+)@(\\w+\\.\\w+)';
            flagState.g = true; flagState.i = true;
            text.value = '联系我们：support@example.com 或 sales@company.org\n无效的：not-an-email@、@nope.com';
            rebuildFlags();
            run();
          }, { small: true }),
        ),
      ),
      el('div', { class: 'card' }, el('label', { class: 'field' }, el('span', { class: 'field-label', text: '测试文本' }), text)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '匹配高亮' }), highlightBox, stat),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '匹配明细' }), matchList),
      el('div', { class: 'card' }, replaceInput.root, el('p', { class: 'field-hint', text: '替换结果' }), replaced),
    );
    page.setActions(
      button('复制替换结果', () => copyWithFeedback(replaced.value, '已复制'), { primary: true }),
      button('复制匹配列表', () => {
        const rows = [...matchList.querySelectorAll('.match-row')].map((r) => r.textContent.trim()).join('\n');
        return copyWithFeedback(rows, '已复制');
      }),
    );
    app.main.append(page.root);

    function rebuildFlags() {
      const nodes = [...flagsBox.querySelectorAll('input[type=checkbox]')];
      FLAGS.forEach(([f], i) => { if (nodes[i]) nodes[i].checked = flagState[f]; });
    }

    pattern.addEventListener('input', run);
    text.addEventListener('input', run);

    function run() {
      highlightBox.replaceChildren();
      matchList.replaceChildren();
      replaced.value = '';

      const p = pattern.value;
      if (!p) {
        stat.textContent = '输入正则表达式开始匹配';
        stat.className = 'hint';
        return;
      }

      const flagStr = FLAGS.map(([f]) => (flagState[f] ? f : '')).join('');
      let re;
      try {
        re = new RegExp(p, flagStr);
      } catch (err) {
        stat.textContent = '正则语法错误：' + err.message;
        stat.className = 'hint error';
        return;
      }

      const src = text.value;
      if (!src) {
        stat.textContent = '正则可编译，等待输入测试文本';
        stat.className = 'hint ok';
        return;
      }

      let matches;
      try {
        matches = collectMatches(re, src);
      } catch (err) {
        stat.textContent = '匹配时出错：' + err.message;
        stat.className = 'hint error';
        return;
      }

      highlightBox.append(highlight(src, matches));

      if (!matches.length) {
        matchList.append(el('p', { class: 'hint', text: '没有匹配' }));
      } else {
        matches.slice(0, 200).forEach((m, i) => {
          const row = el('div', { class: 'match-row' },
            el('span', { class: 'match-idx', text: `#${i + 1}` }),
            el('span', { class: 'match-pos', text: `位置 ${m.index}` }),
            el('code', { class: 'match-val', text: m.groups[0] || '(空匹配)' }),
          );
          if (m.groups.length > 1) {
            const groups = el('div', { class: 'match-groups' });
            for (let g = 1; g < m.groups.length; g++) {
              groups.append(el('span', { class: 'chip', text: `$${g} = ${m.groups[g] ?? '(未匹配)'}` }));
            }
            if (m.named) {
              for (const [k, v] of Object.entries(m.named)) {
                groups.append(el('span', { class: 'chip', text: `$<${k}> = ${v ?? '(未匹配)'}` }));
              }
            }
            row.append(groups);
          }
          matchList.append(row);
        });
        if (matches.length > 200) matchList.append(el('p', { class: 'hint', text: `（只列出前 200 个，共 ${matches.length} 个）` }));
      }

      const rep = replaceInput.get();
      if (rep) {
        try {
          replaced.value = src.replace(re, rep);
        } catch (err) {
          replaced.value = '替换失败：' + err.message;
        }
      } else {
        replaced.value = '';
      }

      const zeroWidth = matches.some((m) => m.groups[0] === '');
      stat.textContent = `找到 ${matches.length} 个匹配 · 标志 ${flagStr || '（无）'}` + (zeroWidth ? ' · 存在零宽匹配' : '');
      stat.className = 'hint ok';
    }

    run();
    return () => { };
  },
};
