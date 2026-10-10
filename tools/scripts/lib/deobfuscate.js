/**
 * JavaScript 反混淆。
 *
 * 设计取舍：
 *
 * 1. **能纯字符串处理的就绝不 eval**。Packer、JavaScript Obfuscator、
 *    MyObfuscate、URL 编码这些都是确定性算法，直接按算法实现即可，
 *    既快又没有执行风险。
 * 2. **必须跑一遍的才进沙箱**。JSFuck / JJEncode / AAEncode / Obfuscator.io
 *    的字符串解码函数，本质是「跑一下才知道结果」，这类一律丢进
 *    lib/sandbox.js 的不透明源 iframe 里执行。
 * 3. **所有替换都走分词器**。de4js 那套正则直接作用在整份源码上，
 *    遇到字符串里恰好含有 `0x1a` 或 `![]` 就会改坏内容。这里先把源码切成
 *    「代码段 / 字符串 / 注释 / 正则」四类 token，只对代码段做替换，
 *    字符串只在明确要求时才做转义还原。
 */

import { loadScript, vendorUrl } from './scripts.js';

/* ============================================================
   分词器
   ============================================================ */

const KEYWORDS_BEFORE_REGEX = /(?:^|[({[;,=:!&|?+\-*%~^<>]|\b(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await))\s*$/;

/**
 * 把源码切成 token。
 * type: 'code' | 'string' | 'template' | 'comment' | 'regex'
 */
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let codeStart = 0;
  const n = src.length;
  // 记录「上一个有意义的片段」，用来判断 / 是正则还是除法。
  // 注释不影响它；字符串/正则后面出现 / 一定是除法，所以标记成一个标识符字符。
  let lastSig = '';

  const pushCode = (end) => {
    if (end > codeStart) {
      const text = src.slice(codeStart, end);
      tokens.push({ type: 'code', text });
      if (text.trim()) lastSig = text;
    }
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // 行注释
    if (c === '/' && c2 === '/') {
      pushCode(i);
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      tokens.push({ type: 'comment', text: src.slice(i, stop) });
      i = stop;
      codeStart = i;
      continue;
    }

    // 块注释
    if (c === '/' && c2 === '*') {
      pushCode(i);
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      tokens.push({ type: 'comment', text: src.slice(i, stop) });
      i = stop;
      codeStart = i;
      continue;
    }

    // 字符串
    if (c === "'" || c === '"') {
      pushCode(i);
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === '\n') break;   // 未闭合，按到行尾处理
        j++;
      }
      tokens.push({ type: 'string', text: src.slice(i, j), quote: c });
      lastSig = 'x';   // 值后面出现的 / 是除法
      i = j;
      codeStart = i;
      continue;
    }

    // 模板字符串（含 ${} 嵌套，这里只做整体切分，不递归解析内部）
    if (c === '`') {
      pushCode(i);
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && src[j] === '}') { depth--; j++; continue; }
        if (depth === 0 && src[j] === '`') { j++; break; }
        j++;
      }
      tokens.push({ type: 'template', text: src.slice(i, j) });
      lastSig = 'x';
      i = j;
      codeStart = i;
      continue;
    }

    // 正则字面量：靠前面还没成 token 的代码 + 上一个有意义片段来判断
    if (c === '/') {
      const pending = src.slice(codeStart, i);
      const context = (pending.trim() ? pending : lastSig).slice(-40);
      if (KEYWORDS_BEFORE_REGEX.test(context)) {
        pushCode(i);
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { j++; break; }
          else if (d === '\n') break;
          j++;
        }
        while (j < n && /[a-z]/i.test(src[j])) j++;   // 标志位
        tokens.push({ type: 'regex', text: src.slice(i, j) });
        lastSig = 'x';
        i = j;
        codeStart = i;
        continue;
      }
    }

    i++;
  }

  pushCode(n);
  return tokens;
}

const join = (tokens) => tokens.map((t) => t.text).join('');

/** 只对 code token 应用变换 */
function mapCode(tokens, fn) {
  return tokens.map((t) => (t.type === 'code' ? { ...t, text: fn(t.text) } : t));
}

/* ============================================================
   代码段清理规则
   ============================================================ */

/** 十六进制 / 二进制 / 八进制字面量转十进制 */
function calcRadix(code) {
  return code
    .replace(/(?<![\w$.])0[xX]([0-9a-fA-F]+)(?![\w$])/g, (m, h) => String(parseInt(h, 16)))
    .replace(/(?<![\w$.])0[bB]([01]+)(?![\w$])/g, (m, b) => String(parseInt(b, 2)))
    .replace(/(?<![\w$.])0[oO]([0-7]+)(?![\w$])/g, (m, o) => String(parseInt(o, 8)));
}

/** 纯数字四则运算：1+2*3 → 7（只处理不含变量、不跨括号的片段） */
function calcNumber(code) {
  return code.replace(/(?<![\w$.'"])(\d+(?:\.\d+)?(?:\s*[+\-*/%]\s*\d+(?:\.\d+)?)+)(?![\w$.'"])/g, (m) => {
    if (!/^[\d\s+\-*/%.()]+$/.test(m)) return m;
    try {
      // 用 Function 而不是 eval，作用域更干净；输入已被限制为纯数字表达式
      const v = Function('"use strict";return (' + m + ')')();
      if (typeof v !== 'number' || !Number.isFinite(v)) return m;
      return String(Number(v.toFixed(12)));
    } catch { return m; }
  });
}

/** 数字外面多余的括号：(123) → 123（但绝不能碰函数调用的括号） */
function removeGrouping(code) {
  return code
    .replace(/(?<![\w$)\]])\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g, '$1')
    .replace(/(?<![\w$)\]])\s*\(\s*(['"])([\w$]+)\1\s*\)/g, '$2');
}

/**
 * ![] → false，!![] → true 之类。
 * 顺序很关键：双否定必须先处理，否则 `!![]` 会被 `![]` 规则先吃成 `!false`。
 */
function toBool(code) {
  return code
    .replace(/(?<![\w$])!!\[\](?![\w$])/g, 'true')
    .replace(/(?<![\w$])!!""(?![\w$])/g, 'false')
    .replace(/(?<![\w$])!!''(?![\w$])/g, 'false')
    .replace(/(?<![\w$])!!0(?![\w$.])/g, 'false')
    .replace(/(?<![\w$])!!1(?![\w$.])/g, 'true')
    .replace(/(?<![\w$])!\[\](?![\w$])/g, 'false')
    .replace(/(?<![\w$])!""(?![\w$])/g, 'true')
    .replace(/(?<![\w$])!''(?![\w$])/g, 'true')
    .replace(/(?<![\w$])!0(?![\w$.])/g, 'true')
    .replace(/(?<![\w$])!1(?![\w$.])/g, 'false');
}

/* ============================================================
   字符串转义还原
   ============================================================ */

const ESCAPE_MAP = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', "'": "'", '"': '"', '`': '`' };

/** 把字符串里的 \xNN \uNNNN 还原成字面字符 */
export function unescapeString(text) {
  const quote = text[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') return text;
  const body = text.slice(1, -1);

  const out = body.replace(/\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|[0-7]{1,3}|.)/g, (m, esc) => {
    if (esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16));
    if (esc[0] === 'u') {
      const code = esc[1] === '{' ? parseInt(esc.slice(2, -1), 16) : parseInt(esc.slice(1), 16);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    if (/^[0-7]{1,3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    return ESCAPE_MAP[esc] ?? esc;
  });

  // 还原后内容里可能出现了引号、换行或反斜杠，必须挑一个不会破坏字面量的写法。
  // 只要含反斜杠或换行，就直接用 JSON 序列化，那是唯一不会出错的方案。
  const clean = (q) => !out.includes(q) && !out.includes('\\') && !out.includes('\n') && !out.includes('\r');
  if (clean(quote)) return quote + out + quote;
  if (quote !== '"' && clean('"')) return '"' + out + '"';
  if (quote !== "'" && clean("'")) return "'" + out + "'";
  return JSON.stringify(out);
}

/* ============================================================
   各反混淆技术
   ============================================================ */

/** 平衡括号匹配 */
function matchBalanced(src, start, open = '{', close = '}') {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 顶层逗号切分 */
function splitTopLevel(text, sep = ',') {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i++;
      while (i < text.length) {
        cur += text[i];
        if (text[i] === '\\') { i++; cur += text[i] ?? ''; }
        else if (text[i] === q) break;
        i++;
      }
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out;
}

/** 解析 JS 字符串字面量 */
function parseStringLiteral(lit) {
  const t = lit.trim();
  const q = t[0];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  const body = t.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') { out += body[i]; continue; }
    const e = body[i + 1];
    if (e === 'x') { out += String.fromCharCode(parseInt(body.substr(i + 2, 2), 16)); i += 3; }
    else if (e === 'u') {
      if (body[i + 2] === '{') {
        const end = body.indexOf('}', i + 3);
        out += String.fromCodePoint(parseInt(body.slice(i + 3, end), 16));
        i = end;
      } else {
        out += String.fromCharCode(parseInt(body.substr(i + 2, 4), 16));
        i += 5;
      }
    } else if (/[0-7]/.test(e)) {
      const m = body.slice(i + 1).match(/^[0-7]{1,3}/)[0];
      out += String.fromCharCode(parseInt(m, 8));
      i += m.length;
    } else {
      out += ESCAPE_MAP[e] ?? e;
      i++;
    }
  }
  return out;
}

/** 把一个值安全地写成 JS 字符串字面量 */
function quoteString(v) {
  return JSON.stringify(String(v));
}

/* ---------------- Dean Edwards Packer ---------------- */

function packerEncodeIndex(c, radix) {
  const rec = (x) => (x < radix ? '' : rec(Math.floor(x / radix))) +
    ((x % radix) > 35 ? String.fromCharCode((x % radix) + 29) : (x % radix).toString(36));
  return rec(c);
}

/** 纯实现，不需要 eval —— 算法本身是确定性的 */
export function unpackPacker(src) {
  const results = [];
  let cursor = 0;

  while (true) {
    const at = src.indexOf('function(p,a,c,k,e,', cursor);
    if (at < 0) break;

    const braceStart = src.indexOf('{', at);
    if (braceStart < 0) break;
    const braceEnd = matchBalanced(src, braceStart);
    if (braceEnd < 0) break;

    // 函数体之后应该是 (参数列表)
    let p = braceEnd + 1;
    while (p < src.length && /\s/.test(src[p])) p++;
    if (src[p] !== '(') { cursor = braceEnd; continue; }
    const argsEnd = matchBalanced(src, p, '(', ')');
    if (argsEnd < 0) break;

    const args = splitTopLevel(src.slice(p + 1, argsEnd));
    if (args.length < 4) { cursor = argsEnd; continue; }

    const payload = parseStringLiteral(args[0]);
    const radix = parseInt(args[1], 10);
    const count = parseInt(args[2], 10);
    const dictRaw = args[3];

    // 字典写成 'a|b|c'.split('|')
    let dict = null;
    const splitMatch = dictRaw.match(/^\s*(['"`])([\s\S]*)\1\s*\.\s*split\s*\(\s*(['"`])([\s\S]*?)\3\s*\)\s*$/);
    if (splitMatch) {
      dict = parseStringLiteral(splitMatch[1] + splitMatch[2] + splitMatch[1]).split(parseStringLiteral(splitMatch[3] + splitMatch[4] + splitMatch[3]));
    }

    if (payload === null || !Number.isFinite(radix) || !Number.isFinite(count) || !dict) {
      cursor = argsEnd;
      continue;
    }

    let unpacked = payload;
    for (let i = count - 1; i >= 0; i--) {
      if (!dict[i]) continue;
      const token = packerEncodeIndex(i, radix);
      if (!token) continue;
      const re = new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      unpacked = unpacked.replace(re, dict[i]);
    }

    // 连同外层的 eval( ... ) 一起替换掉
    let from = at;
    const before = src.slice(0, at);
    const wrap = before.match(/eval\s*\(\s*$/);
    if (wrap) from = at - wrap[0].length;
    else {
      // 没有 eval 包裹的裸 packer 调用，也要把紧邻的标识符一起吃掉
      while (from > 0 && /[a-zA-Z_$.]/.test(src[from - 1])) from--;
    }

    let to = argsEnd + 1;
    while (to < src.length && /\s/.test(src[to])) to++;
    if (src[to] === ')') to++;
    while (to < src.length && src[to] === ';') to++;

    results.push({ from, to, text: unpacked });
    cursor = to;
  }

  if (!results.length) throw new Error('没找到 Dean Edwards Packer 的特征结构');
  let out = src;
  for (let i = results.length - 1; i >= 0; i--) {
    out = out.slice(0, results[i].from) + results[i].text + out.slice(results[i].to);
  }
  return out;
}

/* ---------------- URL 编码（bookmarklet） ---------------- */

export function detectUrlEncoded(src) {
  const t = src.trim();
  if (t.includes(' ')) return false;
  return t.includes('%2') || (t.match(/%/g) || []).length > 3;
}

export function unpackUrlEncoded(src) {
  const t = src.trim();
  const body = /%2[bB]/.test(t) ? t.replace(/\+/g, '%20') : t;
  try {
    return decodeURIComponent(body);
  } catch {
    // 有些老 bookmarklet 用的是 unescape 语义（%uXXXX），退回到宽松模式
    return body.replace(/%u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/%([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
}

/* ---------------- JavaScript Obfuscator ---------------- */

export function detectJsObfuscator(src) {
  return /^\s*var\s+_0x[a-f0-9]+\s*=\s*\[/i.test(src);
}

export function unpackJsObfuscator(src) {
  const m = src.match(/^\s*var\s+(_0x[a-f\d]+)\s*=\s*\[([\s\S]*?)\]\s*;/i);
  if (!m) throw new Error('没找到 JavaScript Obfuscator 的字符串数组');
  const name = m[1];
  const dict = splitTopLevel(m[2]).map((s) => {
    const v = parseStringLiteral(s);
    return v === null ? s.trim() : v;
  });

  let body = src.slice(m[0].length);
  body = body.replace(new RegExp(name.replace(/\$/g, '\\$') + '\\[(\\d+)\\]', 'g'), (all, idx) => {
    const item = dict[Number(idx)];
    return item === undefined ? all : quoteString(item);
  });
  return body;
}

/* ---------------- MyObfuscate ---------------- */

export function detectMyObfuscate(src) {
  const t = src.trim();
  return /^var\s+_?[0O1lI]{3}\s*=\s*('|\[)/.test(t) || (/^function\s+_?[0O1lI]{3}\s*\(/.test(t) && /eval\(/.test(t));
}

/** 不执行代码：直接从 `_escape` 变量里把编码串抠出来 */
export function unpackMyObfuscate(src) {
  const m = src.match(/var\s+_?[0O1lI]{3}\s*=\s*'((?:[^'\\]|\\.)*)'/);
  if (!m) throw new Error('没找到 MyObfuscate 的 _escape 字符串');
  const raw = parseStringLiteral("'" + m[1] + "'");
  let text = unpackUrlEncoded(raw);
  text = text.replace(/^<script>/i, '').replace(/<\/script>\s*$/i, '');
  return '// 注意：MyObfuscate 免费版会在你的页面上外链它自己的脚本，慎用。\n\n' + text;
}

/* ---------------- AAEncode ---------------- */

const AA_PRE = "(\uFF9F\u0414\uFF9F) ['_'] ( (\uFF9F\u0414\uFF9F) ['_'] (";
const AA_PRE_DEC = "( (\uFF9F\u0414\uFF9F) ['_'] (";
const AA_POST = ") (\uFF9F\u0398\uFF9F)) ('_');";
const AA_POST_DEC = ") ());";

export function detectAaEncode(src) {
  const t = src.trim();
  return t.includes(AA_PRE) && t.endsWith(AA_POST);
}

export function aaEncodeToRunnable(src) {
  const t = src.trim();
  return t.replace(AA_PRE, AA_PRE_DEC).replace(AA_POST, AA_POST_DEC);
}

/* ---------------- 常见混淆特征识别（用于给用户提示） ---------------- */

export function inspect(src) {
  const t = src.trim();
  const hints = [];
  const add = (id, label, detail) => hints.push({ id, label, detail });

  if (/function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e/.test(t)) add('packer', 'Dean Edwards Packer', '经典的 p,a,c,k,e 打包器，可以直接解开');
  if (detectUrlEncoded(t)) add('urlencode', 'URL 百分号编码', '整段代码被 percent-encode 了，解码即可');
  if (detectJsObfuscator(t)) add('jsObfuscator', 'JavaScript Obfuscator', '开头的 _0x 字符串数组可以直接内联');
  if (detectMyObfuscate(t)) add('myObfuscate', 'MyObfuscate', '把 _escape 里的编码串抠出来即可');
  if (/^\s*\(?\s*!\[\]|^\[(!\[\]\+\[\])/.test(t) || /\[\]\[\(!\[\]\+\[\]\)/.test(t)) add('jsfuck', 'JSFuck', '只用 6 个符号写的代码，需要跑一遍才能还原');
  if (/\$=~\[\]/.test(t)) add('jjencode', 'JJEncode', '靠 $ 和 _ 的字符串运算构造代码');
  // AAEncode 靠半角片假名 + 希腊字母拼出来，单看某一个字符会漏判
  const halfWidth = (t.match(/[\uFF61-\uFF9F]/g) || []).length;
  if (halfWidth > 5 && /[ωДΘﾉﾟ´｀]/.test(t)) add('aaencode', 'AAEncode', '颜文字风格的编码');
  if (/function\s+_0x[a-f0-9]{4,}\s*\(/.test(t) && /_0x[a-f0-9]{4,}\s*\(\s*['"]?0x/i.test(t)) add('obfuscatorIo', 'Obfuscator.io', '字符串数组 + 解码函数，可以在沙箱里还原');
  if (/eval\s*\(\s*function/.test(t)) add('eval', 'eval 包裹', '里面还有一层 eval，可以尝试捕获');
  if (/\\x[0-9a-fA-F]{2}/.test(t)) add('hexEscape', '十六进制转义', '字符串里用了 \\xNN，可以还原成可读字符');
  if (/\b_0x[a-f0-9]{3,}\b/.test(t)) add('hexNames', '十六进制变量名', '变量名被改成 _0x…，可读性很差（本工具不做重命名）');
  if (/\b0x[0-9a-fA-F]{4,}\b/.test(t)) add('hexNumber', '十六进制数字', '数字写成了十六进制，可以转成十进制');
  return hints;
}

/* ---------------- 汇总清理 ---------------- */

export const CLEAN_OPTIONS = [
  { id: 'unescape', label: '还原字符串转义', desc: '\\x41\\x42 → AB', default: true },
  { id: 'radix', label: '进制字面量转十进制', desc: '0x1a → 26', default: true },
  { id: 'calcNumber', label: '计算纯数字表达式', desc: '1+2*3 → 7', default: true },
  { id: 'strMerge', label: '合并相邻字符串', desc: "'a' + 'b' → 'ab'", default: true },
  { id: 'propArr', label: '属性访问改点号', desc: "obj['key'] → obj.key", default: true },
  { id: 'toBool', label: '布尔表达式求值', desc: '![] → false', default: true },
  { id: 'removeGrouping', label: '去掉多余括号', desc: '(123) → 123', default: true },
];

export function cleanSource(src, options = {}) {
  const opts = Object.fromEntries(CLEAN_OPTIONS.map((o) => [o.id, options[o.id] ?? o.default]));
  let tokens = tokenize(src);

  if (opts.unescape) {
    tokens = tokens.map((t) => (t.type === 'string' ? { ...t, text: unescapeString(t.text) } : t));
  }

  // 相邻字符串合并：string + code('+') + string
  if (opts.strMerge) {
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (tokens[i].type !== 'string') continue;
      const mid = tokens[i + 1];
      if (mid.type !== 'code' || !/^\s*\+\s*$/.test(mid.text)) continue;
      if (tokens[i + 2].type !== 'string') continue;

      const a = parseStringLiteral(tokens[i].text);
      const b = parseStringLiteral(tokens[i + 2].text);
      if (a === null || b === null) continue;

      tokens.splice(i, 3, { type: 'string', text: quoteString(a + b), quote: '"' });
      i--;
    }
  }

  // 属性访问：code 以 [ 结尾 + string + code 以 ] 开头
  if (opts.propArr) {
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (tokens[i].type !== 'code' || tokens[i + 1].type !== 'string' || tokens[i + 2].type !== 'code') continue;
      const before = tokens[i].text;
      const after = tokens[i + 2].text;
      const key = parseStringLiteral(tokens[i + 1].text);
      if (key === null || !/^[A-Za-z_$][\w$]*$/.test(key)) continue;

      const beforeMatch = before.match(/^(.*?)\[\s*\(?\s*$/s);
      const afterMatch = after.match(/^\s*\)?\s*\]/);
      if (!beforeMatch || !afterMatch) continue;

      tokens[i] = { type: 'code', text: beforeMatch[1] };
      tokens[i + 1] = { type: 'code', text: '.' + key };
      tokens[i + 2] = { type: 'code', text: after.slice(afterMatch[0].length) };
    }
  }

  tokens = mapCode(tokens, (code) => {
    let c = code;
    if (opts.radix) c = calcRadix(c);
    if (opts.toBool) c = toBool(c);
    if (opts.calcNumber) c = calcNumber(c);
    if (opts.removeGrouping) c = removeGrouping(c);
    return c;
  });

  return join(tokens).replace(/\n{3,}/g, '\n\n');
}

/* ---------------- 沙箱类技术 ---------------- */

/** Packer / WiseLoop 这类「外层 eval 包一段源码」的，直接捕获被 eval 的内容 */
export async function unpackEvalCaptured(src, runInSandbox) {
  const captured = await runInSandbox('captureEval', { src });
  if (!captured || !captured.trim()) throw new Error('没有捕获到 eval 的内容，可能不是这类混淆');
  return captured;
}

/** JSFuck / AAEncode：跑完取函数源码 */
export async function unpackEvalToString(src, runInSandbox) {
  const out = await runInSandbox('evalToString', { src });
  if (!out) throw new Error('执行后没有拿到源码，可能不是这类编码');
  return out;
}

/**
 * Obfuscator.io：先跑 head（字符串数组 + 解码函数），
 * 再逐个求值每个调用点，最后把结果内联回去。
 */
export async function unpackObfuscatorIo(src, runInSandbox, onProgress) {
  const callRe = /((?![^_a-zA-Z$])[\w$]*)\s*\(\s*(-?0x[a-f\d]+|'-?\d+'|"-?\d+")(\s*,\s*['"][^'"]*['"])?\s*\)/gi;

  const calls = [];
  let m;
  while ((m = callRe.exec(src))) {
    calls.push({ full: m[0], name: m[1] });
  }
  if (!calls.length) throw new Error('没找到 Obfuscator.io 风格的解码调用');

  const names = [...new Set(calls.map((c) => c.name))];

  // 找出解码函数的定义位置，把「head」截到那里为止
  let headEnd = -1;
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const defRe = new RegExp(`(?:function\\s+${esc}\\s*\\(|${esc}\\s*=\\s*function\\s*\\()`, 'g');
    const def = defRe.exec(src);
    if (!def) continue;
    const braceStart = src.indexOf('{', def.index + def[0].length - 1);
    if (braceStart < 0) continue;
    const braceEnd = matchBalanced(src, braceStart);
    if (braceEnd < 0) continue;
    headEnd = Math.max(headEnd, braceEnd + 1);
  }
  if (headEnd < 0) throw new Error('没找到解码函数的定义');

  let head = src.slice(0, headEnd);
  const body = src.slice(headEnd);

  // const/let 在沙箱里可能因重复声明报错，统一换成 var
  head = head.replace(/\b(const|let)\b/g, 'var');

  // 去重后批量求值
  const unique = [...new Set(calls.map((c) => c.full))];
  onProgress?.(`沙箱里求值 ${unique.length} 个解码调用…`);
  const values = await runInSandbox('resolve', { head, exprs: unique }, 20000);

  const map = new Map();
  unique.forEach((expr, i) => {
    const v = values[i];
    if (v && v.t !== 'error') {
      const str = v.t === 'json' ? JSON.parse(v.v) : v.v;
      if (typeof str === 'string' || typeof str === 'number') map.set(expr, String(str));
    }
  });

  if (!map.size) throw new Error('沙箱里没能解出任何字符串，这个样本可能不兼容');

  // 从后往前替换，避免位置偏移
  const positions = [];
  callRe.lastIndex = 0;
  while ((m = callRe.exec(src))) {
    if (map.has(m[0])) positions.push({ start: m.index, end: m.index + m[0].length, value: map.get(m[0]) });
  }
  let out = src;
  for (let i = positions.length - 1; i >= 0; i--) {
    const p = positions[i];
    out = out.slice(0, p.start) + quoteString(p.value) + out.slice(p.end);
  }
  return out;
}

/* ---------------- 技术清单 ---------------- */

export const TECHNIQUES = [
  {
    id: 'auto', label: '自动识别', desc: '按特征依次尝试，取效果最好的一次',
  },
  {
    id: 'packer', label: 'Packer / eval 解包', desc: 'Dean Edwards Packer、WiseLoop 这类把源码打包进字符串再 eval 的写法',
  },
  {
    id: 'obfuscatorIo', label: 'Obfuscator.io 字符串还原', desc: '跑一遍解码函数，把 _0xabc(0x12) 全部换成真实字符串',
  },
  {
    id: 'jsObfuscator', label: 'JavaScript Obfuscator', desc: '内联开头的 _0x 字符串数组',
  },
  {
    id: 'myObfuscate', label: 'MyObfuscate', desc: '从 _escape 变量里还原源码',
  },
  {
    id: 'jsfuck', label: 'JSFuck', desc: '只用 []()!+ 六个符号写成的代码',
  },
  {
    id: 'jjencode', label: 'JJEncode', desc: '靠 $ 与 _ 的字符串运算构造代码',
  },
  {
    id: 'aaencode', label: 'AAEncode', desc: '颜文字风格的编码',
  },
  {
    id: 'urlencode', label: 'URL 编码解码', desc: 'bookmarklet 常见的百分号编码',
  },
  {
    id: 'clean', label: '清理与还原（不执行）', desc: '转义还原、进制转换、字符串合并、属性点号化等纯文本变换',
  },
  {
    id: 'format', label: '仅格式化', desc: '只做缩进美化，不改动任何语义',
  },
];

/** 需要沙箱执行的技术 */
export const SANDBOX_TECHNIQUES = new Set(['packer', 'obfuscatorIo', 'jsfuck', 'aaencode', 'jjencode', 'auto']);

/* ---------------- js-beautify ---------------- */

let beautifyPromise = null;

export function loadBeautify() {
  if (!beautifyPromise) {
    beautifyPromise = import(vendorUrl('js-beautify.esm.js')).then((m) => {
      const b = m.default;
      return b && b.js ? b.js : (typeof b === 'function' ? b : null);
    });
  }
  return beautifyPromise;
}

export async function beautify(src, opts = {}) {
  const fn = await loadBeautify();
  if (!fn) throw new Error('js-beautify 加载失败');
  return fn(src, {
    indent_size: opts.indentSize ?? 2,
    indent_with_tabs: !!opts.tabs,
    max_preserve_newlines: opts.preserveNewlines ?? 2,
    preserve_newlines: true,
    break_chained_methods: false,
    brace_style: 'collapse,preserve-inline',
    end_with_newline: true,
    wrap_line_length: opts.wrap ?? 0,
  });
}

/* ---------------- jjdecode ---------------- */

export async function unpackJjEncode(src) {
  if (!globalThis.JJdecode) await loadScript('jjdecode.js');
  if (!globalThis.JJdecode) throw new Error('JJEncode 解码器加载失败');
  globalThis.JJdecode.dst = '';
  const out = globalThis.JJdecode.decode(src);
  return out || globalThis.JJdecode.dst || '';
}

/* ---------------- 统一入口 ---------------- */

/**
 * 执行一次反混淆。
 * @returns {Promise<{ text: string, method: string, note?: string }>}
 */
export async function deobfuscate(src, { technique = 'auto', clean = {}, runInSandbox, onProgress } = {}) {
  const run = (kind, payload, timeout) => {
    if (!runInSandbox) throw new Error('沙箱不可用');
    return runInSandbox(kind, payload, timeout);
  };
  const sandboxString = async (kind, payload, timeout) => {
    const r = await run(kind, payload, timeout);
    if (r && r.t === 'error') throw new Error(r.v);
    return r ? r.v : '';
  };

  const applyClean = (text) => cleanSource(text, clean);

  switch (technique) {
    case 'format':
      return { text: await beautify(src), method: '格式化' };

    case 'clean': {
      const out = applyClean(src);
      return { text: await beautify(out), method: '清理与还原', note: '未执行任何代码' };
    }

    case 'urlencode':
      if (!detectUrlEncoded(src)) throw new Error('没有检测到 URL 编码特征');
      return { text: await beautify(unpackUrlEncoded(src)), method: 'URL 编码解码' };

    case 'jsObfuscator':
      return { text: await beautify(applyClean(unpackJsObfuscator(src))), method: 'JavaScript Obfuscator' };

    case 'myObfuscate':
      return { text: await beautify(applyClean(unpackMyObfuscate(src))), method: 'MyObfuscate' };

    case 'jjencode':
      return { text: await beautify(unpackJjEncode(src)), method: 'JJEncode' };

    case 'jsfuck':
      return { text: await beautify(await unpackEvalToString(src, sandboxString)), method: 'JSFuck' };

    case 'aaencode':
      if (!detectAaEncode(src)) throw new Error('没有检测到 AAEncode 特征（开头应是 ﾟДﾟ 那段）');
      return { text: await beautify(await unpackEvalToString(aaEncodeToRunnable(src), sandboxString)), method: 'AAEncode' };

    case 'packer': {
      // 先试纯实现，失败再退到沙箱捕获 eval
      try {
        return { text: await beautify(applyClean(unpackPacker(src))), method: 'Packer（纯解析）' };
      } catch (err) {
        onProgress?.('纯解析没成功，改用沙箱捕获 eval…');
        const captured = await unpackEvalCaptured(src, sandboxString);
        return { text: await beautify(applyClean(captured)), method: 'Packer（沙箱捕获 eval）' };
      }
    }

    case 'obfuscatorIo': {
      const out = await unpackObfuscatorIo(src, run, onProgress);
      return { text: await beautify(applyClean(out)), method: 'Obfuscator.io' };
    }

    case 'auto': {
      const hints = inspect(src);
      const order = [];
      for (const h of hints) {
        if (['packer', 'obfuscatorIo', 'jsObfuscator', 'myObfuscate', 'jsfuck', 'jjencode', 'aaencode', 'urlencode'].includes(h.id)) order.push(h.id);
      }
      if (!order.length) order.push('clean');

      const tried = [];
      for (const id of order) {
        try {
          onProgress?.(`尝试「${TECHNIQUES.find((t) => t.id === id)?.label || id}」…`);
          const r = await deobfuscate(src, { technique: id, clean, runInSandbox, onProgress });
          tried.push({ id, ...r });
          // 结果明显变短且不再像混淆代码，就收工
          if (r.text.length < src.length * 0.95 || !/\\x[0-9a-f]{2}|_0x[a-f0-9]{4,}/i.test(r.text)) break;
        } catch (err) {
          tried.push({ id, error: err.message });
        }
      }

      const ok = tried.filter((t) => t.text);
      if (!ok.length) {
        // 全都没解开，至少给个格式化的版本
        return { text: await beautify(src), method: '格式化（没能识别出混淆方式）', note: tried.map((t) => `${t.id}: ${t.error}`).join('；') };
      }
      ok.sort((a, b) => a.text.length - b.text.length);
      const best = ok[0];
      return { text: best.text, method: best.method, note: tried.filter((t) => t.error).length ? `其余尝试：${tried.filter((t) => t.error).map((t) => t.id).join('、')} 未匹配` : '' };
    }

    default:
      throw new Error('未知的反混淆方式：' + technique);
  }
}
