/**
 * 界面外壳：分类导航 + 搜索 + 卡片网格 + hash 路由。
 *
 * 路由刻意用原生 <a href="#id"> + hashchange，不用 pushState ——
 * 一次点击只产生一条历史记录，前进后退天然可用，卡片本身也是可聚焦的链接。
 */
import { CATEGORIES, TOOLS, findTool } from './registry.js';
import { el, toast, button } from './ui.js';

const main = document.getElementById('main');
const catsBar = document.getElementById('cats');
const searchBox = document.getElementById('search');
const searchClear = document.getElementById('searchClear');
const themeBtn = document.getElementById('btnTheme');

const state = {
  cat: 'all',
  query: '',
  module: null,      // 当前工具模块
  toolDef: null,
  cleanup: null,
};

/* ---------------------------------------------------------- 主题 */

const THEME_KEY = 'tools.theme';
const THEME_ORDER = ['', 'light', 'dark'];
const THEME_LABEL = { '': '跟随系统', light: '亮色', dark: '暗色' };

function currentTheme() {
  return document.documentElement.dataset.theme || '';
}

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try {
    if (t) localStorage.setItem(THEME_KEY, t);
    else localStorage.removeItem(THEME_KEY);
  } catch { /* 隐私模式忽略 */ }
  themeBtn.title = `主题：${THEME_LABEL[t]}（点击切换）`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#14161a' : '#ececec');
  }
}

themeBtn.addEventListener('click', () => {
  const i = THEME_ORDER.indexOf(currentTheme());
  applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
  toast(`主题：${THEME_LABEL[currentTheme()]}`);
});

/* ---------------------------------------------------------- 卡片网格 */

function matchQuery(tool, q) {
  if (!q) return true;
  const hay = [tool.name, tool.desc, tool.keywords || '', tool.id].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function toolCard(tool) {
  const href = tool.url || '#' + tool.id;
  const a = el('a', {
    class: 'card tool-card' + (tool.url ? ' external' : ''),
    href,
    dataset: { id: tool.id, cat: tool.cat },
    ...(tool.url ? { target: '_blank', rel: 'noopener' } : {}),
  },
    el('span', { class: 'tool-card-icon', text: tool.icon || '🔧' }),
    el('span', { class: 'tool-card-body' },
      el('span', { class: 'tool-card-name' }, tool.name,
        tool.badge ? el('span', { class: 'badge ' + tool.badge, text: tool.badge === 'hot' ? 'HOT' : 'NEW' }) : null),
      el('span', { class: 'tool-card-desc', text: tool.desc }),
    ),
    tool.url ? el('span', { class: 'tool-card-arrow', text: '↗' }) : null,
  );
  return a;
}

function renderGrid() {
  const list = TOOLS.filter((t) => (state.cat === 'all' || t.cat === state.cat) && matchQuery(t, state.query));

  main.replaceChildren();
  catsBar.hidden = false;

  if (!list.length) {
    main.append(el('div', { class: 'empty-state' },
      el('p', { text: `没有找到匹配「${state.query}」的工具` }),
      button('清空搜索', () => { searchBox.value = ''; state.query = ''; searchClear.hidden = true; renderGrid(); }, { small: true }),
    ));
    return;
  }

  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.cat)) groups.set(t.cat, []);
    groups.get(t.cat).push(t);
  }

  for (const [catId, items] of groups) {
    const cat = CATEGORIES.find((c) => c.id === catId);
    if (state.cat === 'all') {
      main.append(el('h2', { class: 'section-title', text: cat ? cat.name : catId }));
    }
    main.append(el('div', { class: 'grid-cards' }, items.map(toolCard)));
  }
}

function renderCats() {
  catsBar.replaceChildren();
  const counts = new Map();
  for (const t of TOOLS) counts.set(t.cat, (counts.get(t.cat) || 0) + 1);

  for (const c of CATEGORIES) {
    const n = c.id === 'all' ? TOOLS.length : counts.get(c.id) || 0;
    if (!n) continue;
    catsBar.append(el('button', {
      type: 'button',
      class: 'cat' + (state.cat === c.id ? ' active' : ''),
      dataset: { cat: c.id },
      onclick: () => {
        state.cat = c.id;
        renderCats();
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    }, el('span', { text: c.name }), el('span', { class: 'cat-n', text: String(n) })));
  }
}

/* ---------------------------------------------------------- 路由 */

function teardown() {
  if (state.cleanup) {
    try { state.cleanup(); } catch (e) { console.error(e); }
    state.cleanup = null;
  }
  if (state.module && typeof state.module.tool.exit === 'function') {
    try { state.module.tool.exit({ main }); } catch (e) { console.error(e); }
  }
  state.module = null;
  state.toolDef = null;
}

function renderError(title, message, retry) {
  main.replaceChildren(el('div', { class: 'tool-page' },
    el('div', { class: 'card error-card' },
      el('h3', { text: title }),
      el('p', { text: message }),
      retry ? el('div', { class: 'actions' }, button('重试', retry, { primary: true })) : null,
    ),
  ));
}

async function renderTool(def) {
  state.toolDef = def;
  main.replaceChildren(el('div', { class: 'loading', text: '正在加载工具…' }));
  catsBar.hidden = true;

  try {
    const mod = await import(def.module);
    if (!mod.tool || typeof mod.tool.init !== 'function') {
      throw new Error('模块没有导出 tool.init');
    }
    state.module = mod;
    main.replaceChildren();

    // 工具内容单独放一层容器：旧工具会直接改写 innerHTML，不能让它把返回条也清掉
    const view = el('div', { class: 'tool-view' });
    main.append(
      el('div', { class: 'tool-nav' },
        el('a', { class: 'back-link', href: '#', text: '← 返回工具箱' }),
        el('span', { class: 'crumb', text: def.name }),
      ),
      view,
    );

    const app = { main: view, toolDef: def, go: (hash) => { location.hash = hash; } };
    const out = mod.tool.init(app);
    if (typeof out === 'function') state.cleanup = out;
  } catch (err) {
    console.error('加载工具失败', def.module, err);
    renderError(`无法加载「${def.name}」`, err.message || String(err), () => renderTool(def));
  }
}

function route() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!id) {
    teardown();
    renderGrid();
    return;
  }
  const def = findTool(id);
  if (!def) {
    teardown();
    renderError('没有这个工具', `找不到 id 为「${id}」的工具，可能链接已过期。`, () => { location.hash = ''; });
    return;
  }
  if (state.toolDef && state.toolDef.id === id) return;   // 同一个工具，不重复初始化
  teardown();
  renderTool(def);
}

/* ---------------------------------------------------------- 搜索 */

let searchTimer = null;
searchBox.addEventListener('input', () => {
  state.query = searchBox.value.trim();
  searchClear.hidden = !state.query;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (location.hash) location.hash = '';   // 搜索时回到网格
    else renderGrid();
  }, 120);
});
searchClear.addEventListener('click', () => {
  searchBox.value = '';
  state.query = '';
  searchClear.hidden = true;
  renderGrid();
  searchBox.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchBox && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    searchBox.focus();
  }
  if (e.key === 'Escape' && document.activeElement === searchBox && searchBox.value) {
    searchBox.value = '';
    state.query = '';
    searchClear.hidden = true;
    renderGrid();
  }
});

/* ---------------------------------------------------------- 启动 */

window.addEventListener('hashchange', route);

applyTheme(currentTheme());
renderCats();
route();

// 供自测脚本使用
window.__tools = { state, TOOLS, CATEGORIES, renderGrid, route };

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => { });
}
