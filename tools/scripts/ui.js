/**
 * 共享 UI 组件与工具函数。
 * 目标：让每个工具模块只需要描述"有什么选项、点了做什么"，不用手写 DOM。
 */

/* ============================================================
   基础 DOM 助手
   ============================================================ */

export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ============================================================
   提示 / 状态
   ============================================================ */

export async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 落到降级 */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

let toastTimer = null;

export function toast(message, kind = 'info') {
  let node = document.getElementById('toast');
  if (!node) {
    node = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = 'toast'; }, 2600);
}

export async function copyWithFeedback(text, label = '已复制') {
  if (!text) { toast('没有可复制的内容', 'error'); return false; }
  const ok = await copyText(text);
  toast(ok ? label : '复制失败，请手动选择文本复制', ok ? 'ok' : 'error');
  return ok;
}

export function setStatus(node, text, kind = 'info') {
  if (!node) return;
  node.textContent = text || '';
  node.className = 'hint' + (kind === 'info' || !kind ? '' : ' ' + kind);
}

/* ============================================================
   表单控件
   ============================================================ */

function wrapControl(label, control, hint) {
  const id = 'c' + Math.random().toString(36).slice(2, 8);
  if (control.id === undefined || !control.id) control.id = id;
  const line = el('label', { class: 'field', for: control.id },
    el('span', { class: 'field-label', text: label }),
    control,
  );
  const node = el('div', { class: 'field-row' }, line);
  if (hint) node.append(el('p', { class: 'field-hint', text: hint }));
  return node;
}

export function select({ label, options, value, onChange, hint }) {
  const s = el('select', { class: 'input' });
  for (const o of options) {
    const [v, t] = Array.isArray(o) ? o : [o.value, o.label];
    s.append(el('option', { value: v, text: t, selected: String(v) === String(value) }));
  }
  if (value != null) s.value = String(value);
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return { root: wrapControl(label, s, hint), get: () => s.value, set: (v) => { s.value = String(v); }, node: s };
}

export function numberInput({ label, value, min, max, step = 1, onChange, hint, unit }) {
  const i = el('input', { type: 'number', class: 'input', value, min, max, step });
  if (onChange) i.addEventListener('input', () => onChange(parseFloat(i.value)));
  const node = wrapControl(label, i, hint);
  // 注意：node 自身就是 .field-row，querySelector 只匹配后代，这里必须直接 append
  if (unit) node.append(el('span', { class: 'unit', text: unit }));
  return { root: node, get: () => parseFloat(i.value), set: (v) => { i.value = v; }, node: i };
}

export function rangeInput({ label, value, min = 0, max = 100, step = 1, onChange, hint, format }) {
  const r = el('input', { type: 'range', class: 'input range', value, min, max, step });
  const out = el('span', { class: 'range-val', text: format ? format(value) : value });
  r.addEventListener('input', () => {
    out.textContent = format ? format(r.value) : r.value;
    onChange?.(parseFloat(r.value));
  });
  return {
    root: wrapControl(label, el('span', { class: 'range-wrap' }, r, out), hint),
    get: () => parseFloat(r.value),
    set: (v) => { r.value = v; out.textContent = format ? format(v) : v; },
    node: r,
  };
}

export function textInput({ label, value = '', placeholder, onChange, hint }) {
  const i = el('input', { type: 'text', class: 'input', value, placeholder });
  if (onChange) i.addEventListener('input', () => onChange(i.value));
  return { root: wrapControl(label, i, hint), get: () => i.value, set: (v) => { i.value = v; }, node: i };
}

export function textArea({ label, value = '', placeholder, rows = 6, onChange, hint, mono }) {
  const t = el('textarea', { class: 'input' + (mono ? ' mono' : ''), placeholder, rows });
  t.value = value;
  if (onChange) t.addEventListener('input', () => onChange(t.value));
  return { root: wrapControl(label, t, hint), get: () => t.value, set: (v) => { t.value = v; }, node: t };
}

export function toggle({ label, value = false, onChange, hint }) {
  const i = el('input', { type: 'checkbox', class: 'switch' });
  i.checked = !!value;
  if (onChange) i.addEventListener('change', () => onChange(i.checked));
  return { root: wrapControl(label, i, hint), get: () => i.checked, set: (v) => { i.checked = !!v; }, node: i };
}

export function colorInput({ label, value = '#e11d48', onChange, hint }) {
  const i = el('input', { type: 'color', class: 'input color', value });
  if (onChange) i.addEventListener('input', () => onChange(i.value));
  return { root: wrapControl(label, i, hint), get: () => i.value, set: (v) => { i.value = v; }, node: i };
}

/** 一组横向排列的控件 */
export function row(...children) {
  return el('div', { class: 'row' }, children.map((c) => (c && c.root) || c));
}

export function grid(...children) {
  return el('div', { class: 'grid2' }, children.map((c) => (c && c.root) || c));
}

export function fieldset(title, ...children) {
  return el('details', { class: 'card group', open: true },
    el('summary', {}, el('span', { text: title })),
    el('div', { class: 'group-body' }, children.map((c) => (c && c.root) || c)),
  );
}

/* ============================================================
   按钮 / 操作栏
   ============================================================ */

export function button(label, onClick, { primary, danger, small, disabled, title } = {}) {
  const b = el('button', {
    type: 'button',
    class: 'button' + (primary ? ' primary' : '') + (danger ? ' danger' : '') + (small ? ' small' : ''),
    title,
    disabled,
    text: label,
  });
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function actions(...children) {
  return el('div', { class: 'actions' }, children);
}

/* ============================================================
   文件拖放区
   ============================================================ */

export function fileZone({ accept = '', multiple = true, title = '拖入文件或点击选择', hint, onFiles, icon = '📄' }) {
  const input = el('input', { type: 'file', accept, multiple, hidden: true });
  const zone = el('div', {
    class: 'dropzone',
    role: 'button',
    tabindex: '0',
    'aria-label': title,
  },
    el('span', { class: 'dz-icon', text: icon }),
    el('span', { class: 'dz-title', text: title }),
    hint ? el('span', { class: 'dz-hint', text: hint }) : null,
  );

  const pick = () => input.click();
  const handle = (files) => {
    const list = [...files];
    if (list.length) onFiles?.(list);
  };

  zone.addEventListener('click', pick);
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
  });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    handle(e.dataTransfer.files);
  });
  input.addEventListener('change', () => { handle(input.files); input.value = ''; });

  return { root: el('div', { class: 'dz-wrap' }, zone, input), node: zone };
}

/* ============================================================
   文件列表 / 结果区
   ============================================================ */

export function fileList({ onRemove, onMove }) {
  const root = el('div', { class: 'filelist' });
  let items = [];

  const render = () => {
    root.replaceChildren();
    items.forEach((it, i) => {
      const row = el('div', { class: 'file-row' },
        el('span', { class: 'file-idx', text: String(i + 1) }),
        el('span', { class: 'file-name', text: it.name, title: it.name }),
        it.note ? el('span', { class: 'file-note', text: it.note }) : null,
        onMove ? el('span', { class: 'file-move' },
          button('↑', () => { if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); onMove(items); } }, { small: true, disabled: i === 0, title: '上移' }),
          button('↓', () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); onMove(items); } }, { small: true, disabled: i === items.length - 1, title: '下移' }),
        ) : null,
        onRemove ? button('移除', () => { items.splice(i, 1); render(); onRemove(items); }, { small: true, danger: true }) : null,
      );
      root.append(row);
    });
    root.classList.toggle('hidden', items.length === 0);
  };

  return {
    root,
    get: () => items,
    set: (v) => { items = [...v]; render(); },
    push: (v) => { items.push(...v); render(); },
    clear: () => { items = []; render(); },
  };
}

/** 进度 + 状态行 */
export function progress() {
  const bar = el('div', { class: 'bar' });
  const fill = el('div', { class: 'bar-fill' });
  bar.append(fill);
  const text = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const root = el('div', { class: 'progress hidden' }, bar, text);
  return {
    root,
    show(v = 0) { root.classList.remove('hidden'); this.set(v); },
    set(v, msg) { fill.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; if (msg) text.textContent = msg; },
    hide() { root.classList.add('hidden'); fill.style.width = '0%'; },
    text,
  };
}

/** 可滚动的预览容器 */
export function previewPane(placeholder = '这里显示预览') {
  const root = el('div', { class: 'preview-pane' }, el('p', { class: 'hint', text: placeholder }));
  return {
    root,
    set(...nodes) { root.replaceChildren(...nodes.filter(Boolean)); },
    clear() { root.replaceChildren(el('p', { class: 'hint', text: placeholder })); },
  };
}

export function note(text, kind = '') {
  return el('p', { class: 'hint' + (kind ? ' ' + kind : ''), text });
}

/* ============================================================
   工具页面骨架
   ============================================================ */

/**
 * 统一的工具页布局：标题 + 说明 + 文件区 + 选项 + 操作 + 结果
 * 返回 { root, add(), setActions(), result }
 */
export function toolPage({ title, desc, icon }) {
  const body = el('div', { class: 'tool-body' });
  const actionRow = el('div', { class: 'tool-actions' });
  const result = el('div', { class: 'tool-result' });
  const root = el('div', { class: 'tool-page' },
    el('header', { class: 'tool-head' },
      icon ? el('span', { class: 'tool-icon', text: icon }) : null,
      el('div', {},
        el('h2', { class: 'tool-title', text: title }),
        desc ? el('p', { class: 'tool-desc', text: desc }) : null,
      ),
    ),
    body,
    actionRow,
    result,
  );
  return {
    root,
    body,
    result,
    add: (...nodes) => { body.append(...nodes.map((n) => (n && n.root) || n)); return body; },
    setActions: (...nodes) => { actionRow.replaceChildren(...nodes.map((n) => (n && n.node) || n)); },
  };
}

/** 生成一个「导出」按钮，自动处理 Blob 下载 */
export function downloadButton(label, getBlob, { primary = true, onDone } = {}) {
  const b = button(label, async () => {
    b.disabled = true;
    const old = b.textContent;
    b.textContent = '处理中…';
    try {
      const out = await getBlob();
      if (!out) return;
      const { blob, name } = out;
      const { download } = await import('./files.js');
      download(blob, name);
      toast(`已导出 ${name}`, 'ok');
      onDone?.(out);
    } catch (err) {
      console.error(err);
      toast('处理失败：' + err.message, 'error');
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  }, { primary });
  return b;
}
