/**
 * SVG 优化器。
 *
 * 为什么不用 SVGO：它的浏览器包是从 CDN 直接分发的，内部对 sax / css-select /
 * css-tree / css-what / csso 用的是绝对路径 import，而这些包又各自级联依赖
 * （domutils → domhandler、csso → css-tree@2.2.0…），本地托管时全都要跟着改，
 * 加起来接近 1MB —— 对一个「把图标压小一点」的需求来说不划算。
 *
 * 这里用 DOMParser 做同样的事，覆盖 SVG 压缩真正有用的那几项：
 * 去注释与编辑器元数据、数字精度、未使用的 id 与 defs、空容器、
 * 默认属性值、空白折叠、属性排序、style 内的 CSS 压缩。
 * 不做的是 SVGO 那套「CSS 选择器重写」，那需要完整的 CSS 引擎。
 */

const EDITOR_NS = /^(inkscape|sodipodi|adobe|sketch|figma|serif|dc|cc|rdf|i):/i;
const EDITOR_ATTR = /^(inkscape|sodipodi|adobe|sketch|figma|serif):/i;

/** 需要做数字精度处理的属性 */
const NUMERIC_ATTRS = new Set([
  'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2',
  'stroke-width', 'stroke-dashoffset', 'stroke-miterlimit', 'font-size', 'opacity',
  'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset', 'dx', 'dy',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'startOffset', 'textLength',
  'pathLength', 'letter-spacing', 'word-spacing', 'baseline-shift', 'stdDeviation',
]);
/** 内容是「一串数字」的属性 */
const NUMBER_LIST_ATTRS = new Set(['points', 'viewBox', 'stroke-dasharray', 'values', 'keyTimes', 'keySplines']);
/** 内容是变换函数的属性 */
const TRANSFORM_ATTRS = new Set(['transform', 'gradientTransform', 'patternTransform']);

/** 可以整段删除的容器元素 */
const DROP_ELEMENTS = new Set(['metadata', 'sodipodi:namedview', 'foreignObject']);
/** 内容是文本、不能折叠空白的元素 */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textPath', 'style', 'script', 'title', 'desc', 'pre', 'code']);
/** 默认值，写了等于没写 */
const DEFAULT_ATTRS = {
  'stroke-dasharray': 'none',
  'stroke-dashoffset': '0',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-miterlimit': '4',
  'stroke-opacity': '1',
  'stroke-width': '1',
  'fill-opacity': '1',
  'fill-rule': 'nonzero',
  'opacity': '1',
  'stop-opacity': '1',
  'clip-rule': 'nonzero',
  'display': 'inline',
  'visibility': 'visible',
  'text-anchor': 'start',
  'font-style': 'normal',
  'font-weight': 'normal',
  'letter-spacing': 'normal',
  'word-spacing': 'normal',
  'paint-order': 'normal',
};

function roundNumber(n, precision) {
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  const r = Number(v.toFixed(precision));
  // 去掉 -0 与多余的尾零
  return String(Object.is(r, -0) ? 0 : r);
}

/** 把字符串里的每个数字按精度处理，非数字原样保留 */
function roundNumbersIn(text, precision) {
  return String(text).replace(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g, (m) => roundNumber(m, precision));
}

/** transform="translate(10.0000, 20.0000) rotate(45.0000)" 这类 */
function roundTransform(text, precision) {
  return String(text).replace(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g, (m) => roundNumber(m, precision));
}

function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    // 浏览器给的是「This page contains the following errors:error on line N at column M: ...」
    // 这么一大段，把真正有用的那句挑出来
    const raw = (err.textContent || 'XML 解析失败').replace(/\s+/g, ' ').trim();
    const m = raw.match(/(error on line \d+ at column \d+:.+?)(?:Below is|$)/i);
    throw new Error((m ? m[1] : raw).trim().slice(0, 200));
  }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('根元素不是 <svg>');
  }
  return doc;
}

const serialize = (doc) => new XMLSerializer().serializeToString(doc);

/* ============================================================
   各项优化
   ============================================================ */

function walk(node, fn) {
  fn(node);
  for (const child of [...node.childNodes]) walk(child, fn);
}

/** 1. 去注释、编辑器命名空间、元数据 */
function stripMetadata(doc, opts) {
  const remove = [];
  walk(doc.documentElement, (n) => {
    if (n.nodeType === 8) { remove.push(n); return; }   // 注释
    if (n.nodeType !== 1) return;
    const tag = n.nodeName;
    if (tag === 'metadata') { remove.push(n); return; }
    if (opts.removeDesc && (tag === 'desc' || tag === 'title')) { remove.push(n); return; }
    if (opts.removeEditors && EDITOR_NS.test(tag)) { remove.push(n); return; }
  });
  for (const n of remove) n.parentNode?.removeChild(n);

  if (opts.removeEditors) {
    walk(doc.documentElement, (n) => {
      if (n.nodeType !== 1 || !n.attributes) return;
      for (const a of [...n.attributes]) {
        if (EDITOR_ATTR.test(a.name)) n.removeAttribute(a.name);
      }
    });
  }
}

/** 2. 数字精度 */
function cleanupNumbers(doc, precision) {
  walk(doc.documentElement, (n) => {
    if (n.nodeType !== 1 || !n.attributes) return;
    for (const a of [...n.attributes]) {
      const name = a.name;
      const local = name.replace(/^[a-z]+:/i, '');
      if (NUMERIC_ATTRS.has(local) || NUMERIC_ATTRS.has(name)) {
        n.setAttribute(name, roundNumbersIn(a.value, precision));
      } else if (NUMBER_LIST_ATTRS.has(local) || NUMBER_LIST_ATTRS.has(name)) {
        n.setAttribute(name, roundNumbersIn(a.value, precision).replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim());
      } else if (TRANSFORM_ATTRS.has(local) || TRANSFORM_ATTRS.has(name)) {
        n.setAttribute(name, roundTransform(a.value, precision).replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' '));
      } else if (local === 'd' || local === 'style') {
        // 路径数据里的数字很多，精度处理收益最大
        n.setAttribute(name, roundNumbersIn(a.value, precision));
      }
    }
  });
}

/** 3. 去掉默认属性值 */
function dropDefaultAttrs(doc) {
  walk(doc.documentElement, (n) => {
    if (n.nodeType !== 1 || !n.attributes) return;
    for (const a of [...n.attributes]) {
      const def = DEFAULT_ATTRS[a.name];
      if (def !== undefined && String(a.value).trim() === def) n.removeAttribute(a.name);
    }
  });
}

/** 4. 去掉未使用的 id，以及 defs 里没人引用的元素 */
function cleanupIds(doc, removeIds) {
  const used = new Set();

  const collectRefs = (text) => {
    for (const m of String(text).matchAll(/url\(\s*#([^)\s"']+)\s*\)/g)) used.add(m[1]);
    for (const m of String(text).matchAll(/#([A-Za-z_][\w:.-]*)/g)) used.add(m[1]);
  };

  // 先把所有 href 与 style/属性里的引用收集起来
  walk(doc.documentElement, (n) => {
    if (n.nodeType === 1 && n.attributes) {
      for (const a of n.attributes) collectRefs(a.value);
    }
    if (n.nodeType === 3) collectRefs(n.nodeValue);
  });

  // 被引用到的 id 自己也算「已使用」，避免误删链式引用
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 10) {
    changed = false;
    walk(doc.documentElement, (n) => {
      if (n.nodeType !== 1) return;
      const id = n.getAttribute?.('id');
      if (id && used.has(id)) {
        for (const a of n.attributes) {
          for (const m of String(a.value).matchAll(/#([A-Za-z_][\w:.-]*)/g)) {
            if (!used.has(m[1])) { used.add(m[1]); changed = true; }
          }
        }
      }
    });
  }

  const drop = [];
  walk(doc.documentElement, (n) => {
    if (n.nodeType !== 1) return;
    const id = n.getAttribute?.('id');
    if (id && !used.has(id)) {
      if (removeIds) n.removeAttribute('id');
      // defs 里没人引用的图形整块删掉
      if (n.parentNode && n.parentNode.nodeName === 'defs') drop.push(n);
    }
  });
  for (const n of drop) n.parentNode.removeChild(n);
}

/** 5. 空容器 */
function dropEmptyContainers(doc) {
  const EMPTY_OK = new Set(['svg', 'g', 'defs', 'symbol', 'marker', 'pattern', 'clipPath', 'mask', 'linearGradient', 'radialGradient']);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    const drop = [];
    walk(doc.documentElement, (n) => {
      if (n.nodeType !== 1) return;
      if (!EMPTY_OK.has(n.nodeName)) return;
      if (n === doc.documentElement) return;
      // 只含空白、没有任何子元素，且没有 id / 引用
      const hasElement = [...n.childNodes].some((c) => c.nodeType === 1);
      const hasText = [...n.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
      if (!hasElement && !hasText && !n.getAttribute('id')) drop.push(n);
    });
    for (const n of drop) { n.parentNode.removeChild(n); changed = true; }
  }
}

/** 6. 空白折叠（含 style 里的 CSS） */
function collapseWhitespace(doc, pretty) {
  const drop = [];
  walk(doc.documentElement, (n) => {
    if (n.nodeType === 3) {
      const parent = n.parentNode;
      if (!parent || parent.nodeType !== 1) return;
      if (TEXT_ELEMENTS.has(parent.nodeName)) return;
      if (!n.nodeValue.trim()) drop.push(n);
      else n.nodeValue = n.nodeValue.replace(/\s+/g, ' ');
    }
  });
  for (const n of drop) n.parentNode?.removeChild(n);

  // style 元素里的 CSS
  walk(doc.documentElement, (n) => {
    if (n.nodeType === 1 && n.nodeName === 'style') {
      n.textContent = String(n.textContent)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s*([{};:,>~+])\s*/g, '$1')
        .replace(/;}/g, '}')
        .replace(/\s+/g, ' ')
        .trim();
    }
  });

  if (pretty) {
    prettyPrint(doc);
  }
}

/** 简单缩进输出 */
function prettyPrint(doc) {
  const INDENT = '  ';
  const lines = [];
  const render = (node, depth) => {
    const pad = INDENT.repeat(depth);
    if (node.nodeType === 3) {
      const t = node.nodeValue.trim();
      if (t) lines.push(pad + t);
      return;
    }
    if (node.nodeType !== 1) return;
    const attrs = [...node.attributes].map((a) => ` ${a.name}="${a.value}"`).join('');
    const kids = [...node.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim()));
    if (!kids.length) {
      lines.push(`${pad}<${node.nodeName}${attrs}/>`);
      return;
    }
    if (TEXT_ELEMENTS.has(node.nodeName) && kids.every((c) => c.nodeType === 3)) {
      lines.push(`${pad}<${node.nodeName}${attrs}>${node.textContent.trim()}</${node.nodeName}>`);
      return;
    }
    lines.push(`${pad}<${node.nodeName}${attrs}>`);
    for (const c of kids) render(c, depth + 1);
    lines.push(`${pad}</${node.nodeName}>`);
  };
  render(doc.documentElement, 0);

  // 重建文档内容
  const svg = doc.documentElement;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.appendChild(doc.createTextNode('\n' + lines.map((l) => INDENT + l).join('\n') + '\n'));
}

/** 7. 属性排序，让压缩结果更稳定、diff 更好看 */
function sortAttrs(doc) {
  walk(doc.documentElement, (n) => {
    if (n.nodeType !== 1 || !n.attributes || n.attributes.length < 2) return;
    const attrs = [...n.attributes].sort((a, b) => a.name.localeCompare(b.name));
    for (const a of attrs) {
      n.removeAttribute(a.name);
      n.setAttribute(a.name, a.value);
    }
  });
}

/** 8. 补上缺失的 xmlns（否则很多看图工具会拒收） */
function ensureNamespaces(doc) {
  const root = doc.documentElement;
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const text = serialize(doc);
  if (/xlink:href/.test(text) && !root.getAttribute('xmlns:xlink')) {
    root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
}

/* ============================================================
   统一入口
   ============================================================ */

export const OPTIONS = [
  { id: 'numbers', label: '数字精度', desc: '把坐标小数位收敛到指定位数', default: true },
  { id: 'metadata', label: '去元数据', desc: '删掉 metadata 与编辑器残留的命名空间', default: true },
  { id: 'desc', label: '去 title / desc', desc: '这两个元素只对读屏软件有意义，删掉可能影响无障碍', default: false },
  { id: 'ids', label: '清理未使用的 id', desc: '删掉没人引用的 id 与 defs 内容', default: true },
  { id: 'empty', label: '删空容器', desc: '去掉空的 g / defs', default: true },
  { id: 'defaults', label: '去默认属性值', desc: 'stroke-width="1" 这种写了等于没写的属性', default: true },
  { id: 'sortAttrs', label: '属性排序', desc: '让输出更稳定，便于版本对比', default: true },
  { id: 'pretty', label: '保留缩进', desc: '便于阅读，但会大一些', default: false },
];

/**
 * @param {string} text SVG 源码
 * @param {object} opts { precision, ...OPTIONS 里的开关 }
 * @returns {{ data: string, before: number, after: number, stats: object }}
 */
export function optimizeSvg(text, opts = {}) {
  const o = Object.fromEntries(OPTIONS.map((x) => [x.id, opts[x.id] ?? x.default]));
  const precision = Math.max(0, Math.min(8, opts.precision ?? 3));

  const doc = parseSvg(text);
  const stats = { comments: 0, metadata: 0, ids: 0, empty: 0, defaults: 0, numbers: 0 };

  // 统计用：先在原文档上数一遍
  const countBefore = (fn) => {
    let n = 0;
    walk(doc.documentElement, (node) => { if (fn(node)) n++; });
    return n;
  };
  stats.comments = countBefore((n) => n.nodeType === 8);
  stats.metadata = countBefore((n) => n.nodeType === 1 && (n.nodeName === 'metadata' || EDITOR_NS.test(n.nodeName)));
  stats.ids = countBefore((n) => n.nodeType === 1 && n.getAttribute?.('id'));

  if (o.metadata || o.desc) stripMetadata(doc, { removeEditors: o.metadata, removeDesc: o.desc });
  if (o.numbers) cleanupNumbers(doc, precision);
  if (o.defaults) dropDefaultAttrs(doc);
  if (o.ids) cleanupIds(doc, true);
  if (o.empty) dropEmptyContainers(doc);
  ensureNamespaces(doc);
  collapseWhitespace(doc, o.pretty);
  if (o.sortAttrs) sortAttrs(doc);

  const data = serialize(doc);
  return { data, before: text.length, after: data.length, stats };
}

/** 只做 XML 合法性检查 */
export function checkSvg(text) {
  parseSvg(text);
  return true;
}
