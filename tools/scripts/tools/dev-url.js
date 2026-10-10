import {
  toolPage, el, button, toggle, note, grid, fieldset,
  copyWithFeedback, toast,
} from '../ui.js';

/** URL 里的查询串可能含重复键，所以用数组而不是对象保存 */
function parseQuery(search) {
  const out = [];
  const s = search.replace(/^\?/, '');
  if (!s) return out;
  for (const pair of s.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const rawK = i < 0 ? pair : pair.slice(0, i);
    const rawV = i < 0 ? '' : pair.slice(i + 1);
    out.push({
      key: safeDecode(rawK),
      value: safeDecode(rawV),
      rawKey: rawK,
      rawValue: rawV,
    });
  }
  return out;
}

function safeDecode(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

const encodePart = (s, plus) => {
  const e = encodeURIComponent(s);
  return plus ? e.replace(/%20/g, '+') : e;
};

function buildQuery(params, plus) {
  return params
    .filter((p) => p.key !== '' || p.value !== '')
    .map((p) => (p.value === '' ? encodePart(p.key, plus) : `${encodePart(p.key, plus)}=${encodePart(p.value, plus)}`))
    .join('&');
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'URL 解析与编辑',
      icon: '🔗',
      desc: '拆解 URL 的协议、主机、端口、路径、查询参数与锚点，可视化增删改查询参数，实时看编码前后的差别。',
    });

    const input = el('input', { type: 'text', class: 'input mono', placeholder: 'https://example.com:8443/a/b?x=1&y=%E4%B8%AD#top', 'aria-label': 'URL 输入' });
    const partsBox = el('div', { class: 'kv-list' });
    const paramBox = el('div', { class: 'kv-list' });
    const output = el('textarea', { class: 'input mono', rows: 3, readonly: true, 'aria-label': '重建结果' });
    const stat = note('等待输入');

    const plusMode = toggle({ label: '用 + 表示空格（表单编码习惯）', value: false, onChange: rebuild });
    const decodeMode = toggle({ label: '显示解码后的参数值', value: true, onChange: renderParams });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'URL' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('用当前页面地址', () => { input.value = location.href; rebuild(); }, { small: true }),
          button('清空', () => { input.value = ''; rebuild(); }, { small: true }),
        ),
      ),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '组成部分' }), partsBox),
      el('div', { class: 'card' },
        el('div', { class: 'row' },
          el('p', { class: 'field-hint', text: '查询参数' }),
          el('span', { class: 'grow' }),
          button('＋ 添加参数', () => { params.push({ key: 'new', value: '' }); renderParams(); rebuild(); }, { small: true }),
        ),
        grid(plusMode, decodeMode),
        paramBox,
      ),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '重建后的 URL' }), output, stat),
    );
    page.setActions(
      button('复制 URL', () => copyWithFeedback(output.value, '已复制 URL'), { primary: true }),
      button('只复制查询串', () => copyWithFeedback(buildQuery(params, plusMode.get()), '已复制查询串')),
    );
    app.main.append(page.root);

    let parsed = null;
    let params = [];

    input.addEventListener('input', rebuild);

    function rebuild() {
      const raw = input.value.trim();
      partsBox.replaceChildren();
      paramBox.replaceChildren();
      if (!raw) {
        output.value = '';
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      let url;
      try {
        url = new URL(raw);
      } catch {
        // 没写协议时补一个再试，这是最常见的输入习惯
        try {
          url = new URL('https://' + raw);
          stat.textContent = '没写协议，按 https:// 解析';
        } catch {
          stat.textContent = '不是合法的 URL';
          stat.className = 'hint error';
          output.value = '';
          return;
        }
      }
      parsed = url;
      params = parseQuery(url.search);

      const rows = [
        ['协议', url.protocol.replace(':', '')],
        ['用户名', url.username || '（无）'],
        ['密码', url.password ? '•'.repeat(url.password.length) : '（无）'],
        ['主机名', url.hostname],
        ['端口', url.port || `（默认 ${url.protocol === 'https:' ? 443 : 80}）`],
        ['路径', url.pathname || '/'],
        ['锚点', url.hash || '（无）'],
        ['是否默认端口', url.port === '' ? '是' : '否'],
      ];
      for (const [k, v] of rows) {
        partsBox.append(el('div', { class: 'kv-row' },
          el('span', { class: 'kv-key', text: k }),
          el('code', { class: 'kv-val', text: String(v) }),
        ));
      }

      renderParams();
      updateOutput();
    }

    function renderParams() {
      paramBox.replaceChildren();
      if (!params.length) {
        paramBox.append(el('p', { class: 'hint', text: '这个 URL 没有查询参数' }));
        return;
      }
      const showDecoded = decodeMode.get();
      params.forEach((p, i) => {
        const keyIn = el('input', { type: 'text', class: 'input mono', value: p.key, 'aria-label': '参数名' });
        const valIn = el('input', { type: 'text', class: 'input mono', value: p.value, 'aria-label': '参数值' });
        keyIn.addEventListener('input', () => { params[i].key = keyIn.value; updateOutput(); });
        valIn.addEventListener('input', () => { params[i].value = valIn.value; updateOutput(); });

        const rawHint = showDecoded && (p.rawKey !== encodePart(p.key, false) || p.rawValue !== encodePart(p.value, false))
          ? el('code', { class: 'kv-val', text: `原样：${p.rawKey}=${p.rawValue}` })
          : null;

        paramBox.append(el('div', { class: 'param-row' },
          keyIn,
          el('span', { class: 'param-eq', text: '=' }),
          valIn,
          button('✕', () => { params.splice(i, 1); renderParams(); updateOutput(); }, { small: true, danger: true, title: '删除该参数' }),
          rawHint,
        ));
      });
    }

    function updateOutput() {
      if (!parsed) return;
      const q = buildQuery(params, plusMode.get());
      const url = new URL(parsed.href);
      url.search = q ? '?' + q : '';
      output.value = url.href;
      stat.textContent = `共 ${params.length} 个查询参数 · 完整长度 ${url.href.length} 字符`;
      stat.className = 'hint ok';
    }

    input.value = 'https://example.com:8443/search?q=%E6%89%AB%E6%8F%8F%E4%BB%B6&page=2&tag=a&tag=b#results';
    rebuild();
    return () => { };
  },
};
