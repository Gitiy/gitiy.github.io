/**
 * 文本编解码：Base 系列（64 / 64url / 32 / 58 / 16）、命名风格转换。
 *
 * 不用 btoa/atob：它们只吃 Latin-1 字符串，中文会直接抛
 * InvalidCharacterError，而且不支持 URL-safe 变体。
 */

/* ============================================================
   字节 ↔ 字符串
   ============================================================ */

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

export const toBytes = (s) => enc.encode(s);
export const fromBytes = (b) => dec.decode(b);

/* ============================================================
   Base64
   ============================================================ */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64Encode(bytes, alphabet, pad) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (i + 1 < bytes.length) out += alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    else if (pad) out += '=';
    if (i + 2 < bytes.length) out += alphabet[b2 & 0x3f];
    else if (pad) out += '=';
  }
  return out;
}

function base64Decode(str) {
  // 解码时同时接受标准与 URL-safe 两套字母表：
  // 用户粘贴过来的内容常常分不清是哪一种，区分开来只会徒增困惑。
  const map = new Map();
  [...B64].forEach((c, i) => map.set(c, i));
  [...B64URL].forEach((c, i) => { if (!map.has(c)) map.set(c, i); });

  const clean = String(str).replace(/[\s=]/g, '');
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = map.get(ch);
    if (v === undefined) throw new Error(`Base64 里有非法字符：「${ch}」`);
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export const base64 = {
  encode: (bytes, { urlSafe = false, pad = true } = {}) =>
    base64Encode(bytes, urlSafe ? B64URL : B64, pad),
  decode: (str) => base64Decode(str),
};

/* ============================================================
   Base32（RFC 4648）
   ============================================================ */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32 = {
  encode(bytes, { pad = true } = {}) {
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out += B32[(buffer >> bits) & 31];
      }
    }
    if (bits > 0) out += B32[(buffer << (5 - bits)) & 31];
    if (pad) while (out.length % 8) out += '=';
    return out;
  },
  decode(str) {
    const map = new Map([...B32].map((c, i) => [c, i]));
    const clean = str.toUpperCase().replace(/[\s=]/g, '');
    const out = [];
    let buffer = 0;
    let bits = 0;
    for (const ch of clean) {
      const v = map.get(ch);
      if (v === undefined) throw new Error(`Base32 里有非法字符：「${ch}」`);
      buffer = (buffer << 5) | v;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        out.push((buffer >> bits) & 0xff);
      }
    }
    return new Uint8Array(out);
  },
};

/* ============================================================
   Base58（Bitcoin 字母表，去掉了容易混淆的 0 O I l）
   ============================================================ */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const base58 = {
  encode(bytes) {
    if (!bytes.length) return '';
    const digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let i = 0; i < digits.length; i++) {
        carry += digits[i] << 8;
        digits[i] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    // 前导零字节 → 前导 '1'；数值部分为 0 时不再额外输出字符
    let leading = '';
    for (const b of bytes) { if (b === 0) leading += '1'; else break; }

    const big = digits.reverse();
    let start = 0;
    while (start < big.length && big[start] === 0) start++;
    return leading + big.slice(start).map((d) => B58[d]).join('');
  },
  decode(str) {
    const map = new Map([...B58].map((c, i) => [c, i]));
    if (!str) return new Uint8Array(0);
    const bytes = [0];
    for (const ch of str) {
      const v = map.get(ch);
      if (v === undefined) throw new Error(`Base58 里有非法字符：「${ch}」`);
      let carry = v;
      for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    // 前导 '1' 代表前导零字节
    let leadingZeros = 0;
    for (const c of str) { if (c === '1') leadingZeros++; else break; }
    // 数值部分的高位零字节不是有效数据（全 '1' 的输入会留下一个 [0]）
    const big = bytes.reverse();
    let start = 0;
    while (start < big.length && big[start] === 0) start++;

    const arr = new Uint8Array(leadingZeros + (big.length - start));
    arr.set(big.slice(start), leadingZeros);
    return arr;
  },
};

/* ============================================================
   Hex
   ============================================================ */

export const hexCodec = {
  encode(bytes, { upper = false, sep = '' } = {}) {
    const parts = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
    const s = parts.join(sep);
    return upper ? s.toUpperCase() : s;
  },
  decode(str) {
    const clean = String(str).replace(/[\s:,-]/g, '');
    if (clean.length % 2) throw new Error('十六进制长度必须是偶数');
    if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('十六进制里出现了非 0-9a-f 的字符');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  },
};

/* ============================================================
   URL 编码
   ============================================================ */

export const urlCodec = {
  encode: (s, { component = true } = {}) => (component ? encodeURIComponent(s) : encodeURI(s)),
  decode: (s, { component = true } = {}) => (component ? decodeURIComponent(s) : decodeURI(s)),
};

/* ============================================================
   HTML 实体
   ============================================================ */

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export const htmlCodec = {
  encode: (s) => s.replace(/[&<>"'`]/g, (c) => HTML_ENTITIES[c]),
  decode: (s) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–' };
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return named[body] ?? m;
    });
  },
};

/* ============================================================
   命名风格转换
   ============================================================ */

/**
 * 切词。要点：
 * - 连续大写视为一个缩写词（HTTPServer → HTTP + Server）
 * - 保留数字与后随小写（utf8Encoder → utf8 + Encoder）
 * - 中文按整段保留（中文没有大小写概念，硬拆反而破坏语义）
 */
export function splitWords(input) {
  const s = String(input).replace(/[_\-.\\/\s]+/g, ' ').trim();
  if (!s) return [];
  const words = [];
  for (const chunk of s.split(' ')) {
    const m = chunk.match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z]+[0-9]*|[0-9]+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g);
    if (m) words.push(...m);
  }
  return words;
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const low = (w) => w.toLowerCase();

export const STYLES = [
  { id: 'camel', label: 'camelCase', example: 'fooBarBaz' },
  { id: 'pascal', label: 'PascalCase', example: 'FooBarBaz' },
  { id: 'snake', label: 'snake_case', example: 'foo_bar_baz' },
  { id: 'kebab', label: 'kebab-case', example: 'foo-bar-baz' },
  { id: 'constant', label: 'CONSTANT_CASE', example: 'FOO_BAR_BAZ' },
  { id: 'cobol', label: 'COBOL-CASE', example: 'FOO-BAR-BAZ' },
  { id: 'dot', label: 'dot.case', example: 'foo.bar.baz' },
  { id: 'path', label: 'path/case', example: 'foo/bar/baz' },
  { id: 'space', label: 'space case', example: 'foo bar baz' },
  { id: 'title', label: 'Title Case', example: 'Foo Bar Baz' },
  { id: 'sentence', label: 'Sentence case', example: 'Foo bar baz' },
  { id: 'lower', label: 'lowercase', example: 'foobarbaz' },
  { id: 'upper', label: 'UPPERCASE', example: 'FOOBARBAZ' },
  { id: 'train', label: 'Train-Case', example: 'Foo-Bar-Baz' },
];

export function convertCase(input, style) {
  const w = splitWords(input);
  if (!w.length) return '';
  switch (style) {
    case 'camel': return w.map((x, i) => (i === 0 ? low(x) : cap(low(x)))).join('');
    case 'pascal': return w.map((x) => cap(low(x))).join('');
    case 'snake': return w.map(low).join('_');
    case 'kebab': return w.map(low).join('-');
    case 'constant': return w.map((x) => x.toUpperCase()).join('_');
    case 'cobol': return w.map((x) => x.toUpperCase()).join('-');
    case 'dot': return w.map(low).join('.');
    case 'path': return w.map(low).join('/');
    case 'space': return w.map(low).join(' ');
    case 'title': return w.map(cap).join(' ');
    case 'sentence': return w.map((x, i) => (i === 0 ? cap(low(x)) : low(x))).join(' ');
    case 'lower': return w.map(low).join('');
    case 'upper': return w.map((x) => x.toUpperCase()).join('');
    case 'train': return w.map(cap).join('-');
    default: return input;
  }
}

export const convertAllCases = (input) =>
  STYLES.map((s) => ({ id: s.id, label: s.label, value: convertCase(input, s.id) }));

/* ============================================================
   统一入口：Base 系列
   ============================================================ */

export const BASES = [
  { id: 'base64', label: 'Base64', desc: '最通用，含 + / 与 = 填充' },
  { id: 'base64url', label: 'Base64 URL-safe', desc: '用 - _ 替换 + /，适合放进 URL 与文件名' },
  { id: 'base32', label: 'Base32', desc: '只用大写字母与 2-7，不区分大小写' },
  { id: 'base58', label: 'Base58', desc: 'Bitcoin 用的字母表，去掉了 0 O I l' },
  { id: 'hex', label: '十六进制', desc: '每字节两个字符' },
  { id: 'url', label: 'URL 编码', desc: '百分号转义' },
  { id: 'html', label: 'HTML 实体', desc: '把 & < > 等转成实体' },
];

/** 编码：字符串 → 目标表示 */
export function encodeWith(text, base) {
  switch (base) {
    case 'base64': return base64.encode(toBytes(text));
    case 'base64url': return base64.encode(toBytes(text), { urlSafe: true });
    case 'base32': return base32.encode(toBytes(text));
    case 'base58': return base58.encode(toBytes(text));
    case 'hex': return [...toBytes(text)].map((b) => b.toString(16).padStart(2, '0')).join('');
    case 'url': return urlCodec.encode(text);
    case 'html': return htmlCodec.encode(text);
    default: throw new Error('未知编码：' + base);
  }
}

/** 解码：目标表示 → 字符串 */
export function decodeWith(text, base) {
  switch (base) {
    case 'base64': return fromBytes(base64.decode(text));
    case 'base64url': return fromBytes(base64.decode(text, { urlSafe: true }));
    case 'base32': return fromBytes(base32.decode(text));
    case 'base58': return fromBytes(base58.decode(text));
    case 'hex': return fromBytes(hexCodec.decode(text));
    case 'url': return urlCodec.decode(text);
    case 'html': return htmlCodec.decode(text);
    default: throw new Error('未知编码：' + base);
  }
}
