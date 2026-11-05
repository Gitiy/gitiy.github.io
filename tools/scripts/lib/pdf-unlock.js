/**
 * PDF 标准安全处理器解密 —— 纯浏览器实现，零第三方依赖。
 *
 * 用途：已知密码的前提下，把加密 PDF 还原成未加密的等价副本（PDF24 的
 * "移除 PDF 密码保护" 同款能力）。**不做任何密码破解 / 暴力猜解**。
 *
 * 支持 ISO 32000 标准安全处理器：
 *   V1 R2  RC4 40-bit      V2 R3  RC4 128-bit
 *   V4 R4  RC4 / AES-128   V5 R5  AES-256 (deprecated)
 *   V5 R6  AES-256 (SHA-256/384/512 + Algorithm 2.B)
 * 用户密码（打开密码）与所有者密码（权限密码）都可用来解锁。
 *
 * 做法不是「逐页渲染成图片」，而是在 PDF 语法层把每个间接对象里的字符串与
 * 流就地解密，再重写一份干净的交叉引用表并去掉 trailer 的 /Encrypt。
 * 因此文字层、矢量图形、内嵌图片、书签、表单全部原样保留。
 */

/* ============================================================
   字节工具
   ============================================================ */

const EMPTY = new Uint8Array(0);
const ZERO16 = new Uint8Array(16);
const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);
const SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]); // "sAlT"

const latin1 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
};
const bytesOf = (s) => {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
  return u;
};
const hexOf = (u) => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0');
  return s;
};
const hexBytes = (s) => {
  const t = s.replace(/[^0-9a-fA-F]/g, '');
  const u = new Uint8Array(t.length >> 1);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(t.substr(i * 2, 2), 16);
  return u;
};
const concat = (...arrs) => {
  let n = 0;
  for (const a of arrs) n += a.length;
  const o = new Uint8Array(n);
  let p = 0;
  for (const a of arrs) { o.set(a, p); p += a.length; }
  return o;
};
const eq = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const i32le = (n) => { const u = new Uint8Array(4); new DataView(u.buffer).setInt32(0, n | 0, true); return u; };
const pad32 = (pwd) => concat(pwd.subarray(0, 32), PAD.subarray(0, Math.max(0, 32 - pwd.length)));
const xorKey = (key, n) => { const o = new Uint8Array(key); for (let i = 0; i < o.length; i++) o[i] ^= n; return o; };

/* ============================================================
   原语：MD5（Web Crypto 不提供）、RC4、SHA-*、AES-CBC
   ============================================================ */

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

function md5(data) {
  const len = data.length;
  const buf = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(buf.length - 8, bits >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(bits / 0x100000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < buf.length; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      const s = MD5_S[i];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const od = new DataView(out.buffer);
  od.setUint32(0, a0, true); od.setUint32(4, b0, true);
  od.setUint32(8, c0, true); od.setUint32(12, d0, true);
  return out;
}

function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  const out = new Uint8Array(data.length);
  let a = 0, b = 0;
  for (let n = 0; n < data.length; n++) {
    a = (a + 1) & 255; b = (b + S[a]) & 255;
    const t = S[a]; S[a] = S[b]; S[b] = t;
    out[n] = data[n] ^ S[(S[a] + S[b]) & 255];
  }
  return out;
}

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('当前环境不支持 Web Crypto（需 HTTPS 或 localhost）');
  return s;
};
const digest = async (alg, data) => new Uint8Array(await subtle().digest(alg, data));
const aesKey = (key, usages) => subtle().importKey('raw', key, { name: 'AES-CBC' }, false, usages);

/** 带 PKCS#7 padding 的 AES-CBC 解密（PDF 里的字符串 / 流都用这个） */
async function aesDecrypt(key, iv, ct) {
  const k = await aesKey(key, ['decrypt']);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, ct));
}

/** SubtleCrypto 的 AES-CBC 强制 padding；取密文前 n 字节即可得到 no-padding 结果 */
async function aesEncryptNoPad(key, iv, data) {
  const k = await aesKey(key, ['encrypt']);
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
  return out.subarray(0, data.length);
}

/**
 * no-padding 的 AES-CBC 解密（R5/R6 的 /UE /OE 用）。
 * 末尾补一个我们可控的密文块，让 SubtleCrypto 认为 padding 合法，再把它丢掉。
 */
async function aesDecryptNoPad(key, iv, ct) {
  if (!ct.length || ct.length % 16) throw new Error('加密数据长度不合法');
  const k = await aesKey(key, ['encrypt', 'decrypt']);
  const last = ct.subarray(ct.length - 16);
  const x = new Uint8Array(16);
  for (let i = 0; i < 16; i++) x[i] = last[i] ^ 0x10;
  const enc = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: ZERO16 }, k, x));
  const full = concat(ct, enc.subarray(0, 16));
  const out = new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, full));
  return out.subarray(0, ct.length);
}

/* ============================================================
   PDF 词法 / 对象层
   ============================================================ */

const isWS = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const isReg = (c) => !isWS(c) && !isDelim(c);
const decodeName = (s) => s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** 把一段 PDF 语法切成 token；字符串一律以原始字节保存 */
function scan(text, from = 0, to = text.length) {
  const t = [];
  let i = from;
  while (i < to) {
    const c = text.charCodeAt(i);
    if (isWS(c)) { i++; continue; }
    if (c === 37) { // 注释
      while (i < to && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      continue;
    }
    if (c === 40) { // ( ... )
      const start = i; i++;
      let depth = 1, s = '';
      while (i < to && depth > 0) {
        const ch = text.charCodeAt(i);
        if (ch === 92) {
          i++;
          const n = text.charCodeAt(i);
          if (n >= 48 && n <= 55) {
            let oct = '';
            for (let k = 0; k < 3 && i < to && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 55; k++, i++) oct += text[i];
            s += String.fromCharCode(parseInt(oct, 8) & 255);
          } else if (n === 10) i++;
          else if (n === 13) { i++; if (text.charCodeAt(i) === 10) i++; }
          else { s += String.fromCharCode({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }[n] ?? n); i++; }
          continue;
        }
        if (ch === 40) depth++;
        else if (ch === 41) { depth--; if (!depth) { i++; break; } }
        if (depth) s += String.fromCharCode(ch);
        i++;
      }
      t.push({ type: 'str', start, end: i, bytes: bytesOf(s) });
      continue;
    }
    if (c === 60 && text.charCodeAt(i + 1) !== 60) { // <hex>
      const start = i; i++;
      let h = '';
      while (i < to && text.charCodeAt(i) !== 62) { h += text[i]; i++; }
      if (i < to) i++;
      t.push({ type: 'str', start, end: i, bytes: hexBytes(h) });
      continue;
    }
    if (c === 60) { t.push({ type: '<<', start: i, end: i + 2 }); i += 2; continue; }
    if (c === 62 && text.charCodeAt(i + 1) === 62) { t.push({ type: '>>', start: i, end: i + 2 }); i += 2; continue; }
    if (c === 62) { i++; continue; }
    if (c === 91 || c === 93 || c === 123 || c === 125) { t.push({ type: text[i], start: i, end: i + 1 }); i++; continue; }
    if (c === 47) {
      const start = i; i++;
      while (i < to && isReg(text.charCodeAt(i))) i++;
      t.push({ type: 'name', start, end: i, value: decodeName(text.slice(start + 1, i)) });
      continue;
    }
    const start = i;
    while (i < to && isReg(text.charCodeAt(i))) i++;
    const raw = text.slice(start, i);
    if (/^[+-]?[\d.]+$/.test(raw)) t.push({ type: 'num', start, end: i, value: parseFloat(raw) });
    else t.push({ type: 'kw', start, end: i, value: raw });
  }
  return t;
}

/** 递归解析 token 流，值形如 {dict} / {arr} / {str} / {name} / {ref} / number / {kw} */
function parseAt(t, i) {
  const tk = t[i];
  if (!tk) return [null, i, [0, 0]];
  if (tk.type === '<<') {
    const d = {};
    let j = i + 1;
    while (j < t.length && t[j].type !== '>>') {
      if (t[j].type !== 'name') { j++; continue; }
      const key = t[j].value; j++;
      const [v, nj, range] = parseAt(t, j);
      d[key] = { v, range };
      j = nj;
    }
    const end = t[j]?.type === '>>' ? t[j].end : tk.end;
    if (t[j]?.type === '>>') j++;
    return [{ dict: d }, j, [tk.start, end]];
  }
  if (tk.type === '[') {
    const a = []; let j = i + 1;
    while (j < t.length && t[j].type !== ']') { const [v, nj] = parseAt(t, j); a.push(v); j = nj; }
    const end = t[j]?.end ?? tk.end;
    if (t[j]?.type === ']') j++;
    return [{ arr: a }, j, [tk.start, end]];
  }
  if (tk.type === 'num' && t[i + 1]?.type === 'num' && t[i + 2]?.type === 'kw' && t[i + 2].value === 'R') {
    return [{ ref: t[i].value }, i + 3, [tk.start, t[i + 2].end]];
  }
  if (tk.type === 'num') return [tk.value, i + 1, [tk.start, tk.end]];
  if (tk.type === 'name') return [{ name: tk.value }, i + 1, [tk.start, tk.end]];
  if (tk.type === 'str') return [{ str: tk.bytes }, i + 1, [tk.start, tk.end]];
  return [{ kw: tk.value }, i + 1, [tk.start, tk.end]];
}

const D = (v) => v?.dict || null;
const N = (v) => typeof v === 'number' ? v : undefined;
const NAME = (v) => v?.name;
const STR = (v) => v?.str;

/** 扫出文件里所有间接对象；流数据按 endstream / /Length 精确定位，避免误匹配 */
function parseObjects(text) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const num = +m[1], gen = +m[2];
    const bodyStart = m.index + m[0].length;
    let endobj = text.indexOf('endobj', bodyStart);
    if (endobj < 0) endobj = text.length;

    // 找 stream 关键字（必须在 << >> 字典之后）
    let tagAt = -1;
    const probeEnd = Math.min(endobj, text.length);
    const sm = /\bstream(?=\r\n|\n|\r)/g;
    let s;
    while ((s = sm.exec(text.slice(bodyStart, probeEnd)))) {
      if (text.slice(bodyStart, bodyStart + s.index).includes('>>')) { tagAt = bodyStart + s.index; break; }
    }

    let headEnd = endobj, streamStart = -1, dataEnd = -1;
    if (tagAt >= 0) {
      headEnd = tagAt;
      let ds = tagAt + 6;
      if (text[ds] === '\r' && text[ds + 1] === '\n') ds += 2;
      else if (text[ds] === '\r' || text[ds] === '\n') ds += 1;
      streamStart = ds;
      const es = text.indexOf('endstream', ds);
      if (es >= 0) {
        let d = es;
        if (text[d - 2] === '\r' && text[d - 1] === '\n') d -= 2;
        else if (text[d - 1] === '\r' || text[d - 1] === '\n') d -= 1;
        dataEnd = d;
        const eo = text.indexOf('endobj', es);
        if (eo >= 0) endobj = eo;
      }
    }

    const head = text.slice(bodyStart, headEnd);
    const toks = scan(head);
    const [val] = parseAt(toks, 0);
    objs.set(num, {
      num, gen, bodyStart, headEnd, endobj,
      head, toks, val, streamStart, dataEnd,
      streamData: streamStart >= 0 ? bytesOf(text.slice(streamStart, Math.max(streamStart, dataEnd))) : null,
    });
    re.lastIndex = Math.max(re.lastIndex, endobj + 6);
  }

  // 第二轮：/Length 若是间接引用，现在对象表已经完整，可以精确修正流边界
  for (const o of objs.values()) {
    if (o.streamStart < 0) continue;
    const lv = D(o.val)?.Length?.v;
    let L = N(lv);
    if (L == null && lv?.ref != null) L = stripVal(objs.get(lv.ref)?.val);
    if (Number.isFinite(L) && L >= 0 && o.streamStart + L <= o.dataEnd) {
      o.streamData = bytesOf(text.slice(o.streamStart, o.streamStart + L));
    }
  }
  return objs;
}
const stripVal = (v) => typeof v === 'number' ? v : undefined;

/** 从 trailer / xref stream 字典里取 /Encrypt /Root /Info /ID /Size */
function readTrailer(text, objs) {
  const chunks = [];
  const tr = /\btrailer\b/g;
  let m;
  while ((m = tr.exec(text))) {
    const e = text.indexOf('>>', m.index);
    if (e >= 0 && e - m.index < 4096) chunks.push(text.slice(m.index + 7, e + 2));
  }
  for (const o of objs.values()) {
    const d = D(o.val);
    if (NAME(d?.Type?.v) === 'XRef') chunks.push(o.head);
  }
  let best = null;
  for (const c of chunks) {
    const [v] = parseAt(scan(c), 0);
    const d = D(v);
    if (!d) continue;
    if (!best || d.Encrypt) best = { dict: d, text: c };
  }
  if (!best) return null;
  const d = best.dict;
  const idArr = d.ID?.v?.arr;
  const id0 = idArr?.[0]?.str || null;
  const id1 = idArr?.[1]?.str || id0;
  return {
    encryptRef: d.Encrypt?.v?.ref ?? null,
    rootRef: d.Root?.v?.ref ?? null,
    infoRef: d.Info?.v?.ref ?? null,
    size: N(d.Size?.v),
    id0: id0 || EMPTY,
    id1,
  };
}

function readEncrypt(objs, ref) {
  const o = objs.get(ref);
  const d = D(o?.val);
  if (!d) throw new Error('找不到加密字典（/Encrypt），文件可能已损坏');
  const V = N(d.V?.v) ?? 0;
  const R = N(d.R?.v) ?? 2;
  const keyLen = V <= 1 ? 5 : Math.max(5, Math.min(16, (N(d.Length?.v) ?? 128) >> 3));
  const cf = D(d.CF?.v) || {};
  const filterOf = (key, fallback) => {
    const f = NAME(d[key]?.v) || fallback;
    const c = D(cf[f]?.v);
    return NAME(c?.CFM?.v) || (V >= 5 ? 'AESV3' : V === 4 ? 'AESV2' : 'V2');
  };
  return {
    ref, V, R, keyLen,
    O: STR(d.O?.v) || new Uint8Array(32),
    U: STR(d.U?.v) || new Uint8Array(32),
    P: N(d.P?.v) ?? -1,
    OE: STR(d.OE?.v) || null,
    UE: STR(d.UE?.v) || null,
    encMeta: NAME(d.EncryptMetadata?.v) === 'false' ? false : (N(d.EncryptMetadata?.v) === 0 ? false : true),
    stmF: filterOf('StmF', 'StdCF'),
    strF: filterOf('StrF', 'StdCF'),
  };
}

/* ============================================================
   密钥推导（Algorithms 2 / 3 / 6 / 7 / 2.A / 2.B）
   ============================================================ */

function passwordVariants(s) {
  const out = [], seen = new Set();
  const add = (u) => { const k = hexOf(u); if (!seen.has(k)) { seen.add(k); out.push(u); } };
  add(new TextEncoder().encode(s));
  add(bytesOf(s));                       // PDFDocEncoding / latin1
  const u16 = new Uint8Array(2 + s.length * 2);
  u16[0] = 0xfe; u16[1] = 0xff;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u16[2 + i * 2] = c >> 8; u16[3 + i * 2] = c & 255; }
  add(u16);                              // 部分实现用 UTF-16BE + BOM
  return out;
}

const alg2 = (pwd, e, id0) => {
  let h = md5(concat(pad32(pwd), e.O, i32le(e.P), id0,
    e.R >= 4 && !e.encMeta ? new Uint8Array([255, 255, 255, 255]) : EMPTY));
  if (e.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, e.keyLen));
  return h.subarray(0, e.keyLen);
};

const checkU = (key, e, id0) => {
  if (e.R === 2) return eq(rc4(key, PAD), e.U);
  let u = rc4(key, md5(concat(PAD, id0)));
  for (let i = 1; i <= 19; i++) u = rc4(xorKey(key, i), u);
  return eq(u, e.U.subarray(0, 16));
};

function alg7(ownerPwd, e, id0) {
  let h = md5(pad32(ownerPwd));
  if (e.R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const k = e.R === 2 ? h.subarray(0, 5) : h.subarray(0, e.keyLen);
  let u;
  if (e.R === 2) u = rc4(k, e.O);
  else { u = e.O.slice(); for (let i = 19; i >= 0; i--) u = rc4(xorKey(k, i), u); }
  // 解出的 32 字节里，密码后面补的是 PAD 的**前缀**，枚举长度找切点
  let userPwd = u;
  for (let len = 0; len <= 32; len++) {
    if (eq(u.subarray(len), PAD.subarray(0, 32 - len))) { userPwd = u.subarray(0, len); break; }
  }
  const key = alg2(userPwd, e, id0);
  return checkU(key, e, id0) ? key : null;
}

/**
 * R6 的 Algorithm 2.B。
 * 注意：验证密码（valSalt）与解密文件密钥（keySalt）是两次**独立**的哈希，
 * 各自的迭代轮数由本轮密文末字节决定，绝不能复用对方的轮数。
 * delta 是终止判据的偏移量：ISO/qpdf 用 32，个别实现写成 31，
 * 由 /U（或 /O）比对来判定当前文件用的是哪一套。
 */
async function hashR6(pwd, salt, udata, delta = 32) {
  let K = await digest('SHA-256', concat(pwd, salt, udata));
  for (let round = 1; round <= 512; round++) {
    const one = concat(pwd, K, udata);
    // 重复 64 次后长度必为 16 的倍数，正好符合 CBC no-padding
    const K1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) K1.set(one, i * one.length);
    const E = await aesEncryptNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += E[i];
    K = await digest(sum % 3 === 0 ? 'SHA-256' : sum % 3 === 1 ? 'SHA-384' : 'SHA-512', E);
    if (round >= 64 && E[E.length - 1] <= round - delta) break;
  }
  return K.subarray(0, 32);
}

async function deriveKey(e, password, id0) {
  for (const pwd of passwordVariants(password)) {
    if (e.R >= 5) {
      const uVal = e.U.subarray(32, 40), uKey = e.U.subarray(40, 48);
      if (e.R === 5) {
        if (eq(await digest('SHA-256', concat(pwd, uVal)), e.U.subarray(0, 32)) && e.UE) {
          const k = await digest('SHA-256', concat(pwd, uKey));
          return { key: await aesDecryptNoPad(k, ZERO16, e.UE), via: 'user' };
        }
        if (e.OE) {
          const oVal = e.O.subarray(32, 40), oKey = e.O.subarray(40, 48);
          if (eq(await digest('SHA-256', concat(pwd, oVal, e.U.subarray(0, 48))), e.O.subarray(0, 32))) {
            const k = await digest('SHA-256', concat(pwd, oKey, e.U.subarray(0, 48)));
            return { key: await aesDecryptNoPad(k, ZERO16, e.OE), via: 'owner' };
          }
        }
      } else {
        for (const delta of [32, 31]) {
          if (e.UE && eq(await hashR6(pwd, uVal, EMPTY, delta), e.U.subarray(0, 32))) {
            const kk = await hashR6(pwd, uKey, EMPTY, delta);
            return { key: await aesDecryptNoPad(kk, ZERO16, e.UE), via: 'user' };
          }
          if (e.OE) {
            const udata = e.U.subarray(0, 48);
            if (eq(await hashR6(pwd, e.O.subarray(32, 40), udata, delta), e.O.subarray(0, 32))) {
              const kk = await hashR6(pwd, e.O.subarray(40, 48), udata, delta);
              return { key: await aesDecryptNoPad(kk, ZERO16, e.OE), via: 'owner' };
            }
          }
        }
      }
      continue;
    }

    // R2 / R3 / R4
    const key = alg2(pwd, e, id0);
    if (checkU(key, e, id0)) return { key, via: 'user' };
    const ownerKey = alg7(pwd, e, id0);
    if (ownerKey) return { key: ownerKey, via: 'owner' };
  }
  throw new Error('密码不正确。请确认输入的是该文件的打开密码或所有者密码。');
}

/* ============================================================
   解密 + 重建
   ============================================================ */

function makeCipher(e, fileKey) {
  const modeOf = (cfm) => {
    if (e.R >= 5 || cfm === 'AESV3') return 'aes256';
    if (cfm === 'AESV2') return 'aes128';
    if (cfm === 'None' || cfm === 'Identity') return 'none';
    return 'rc4';
  };
  const objectKey = (num, gen, salt) => {
    if (e.R >= 5) return fileKey;
    const ext = new Uint8Array([num & 255, (num >>> 8) & 255, (num >>> 16) & 255, gen & 255, (gen >>> 8) & 255]);
    const h = md5(concat(fileKey, ext, salt ? SALT : EMPTY));
    return h.subarray(0, Math.min(fileKey.length + 5, 16));
  };
  const strMode = modeOf(e.strF), stmMode = modeOf(e.stmF);
  return {
    strMode, stmMode,
    async decrypt(bytes, num, gen, mode) {
      if (mode === 'none' || !bytes.length) return bytes;
      if (mode === 'rc4') return rc4(objectKey(num, gen, false), bytes);
      const key = mode === 'aes256' ? fileKey : objectKey(num, gen, true);
      // AESV2/AESV3：前 16 字节是 IV，其后是带 PKCS#7 padding 的密文
      if (bytes.length < 32 || (bytes.length - 16) % 16 !== 0) return bytes;
      try {
        return await aesDecrypt(key, bytes.subarray(0, 16), bytes.subarray(16));
      } catch {
        return bytes;
      }
    },
  };
}

async function inflate(data) {
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const ds = new DecompressionStream(fmt);
      const stream = new Blob([data]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* 换一种格式再试 */ }
  }
  throw new Error('对象流使用了暂不支持的压缩格式');
}

/** 把 /Type /ObjStm 里压缩存放的间接对象展开成独立对象 */
async function expandObjectStreams(objs) {
  for (const o of [...objs.values()]) {
    const d = D(o.val);
    if (NAME(d?.Type?.v) !== 'ObjStm' || !o.streamData) continue;
    const filter = d.Filter?.v;
    let data = o.streamData;
    if (filter) {
      const f = NAME(filter) || filter?.arr?.map((x) => NAME(x)).join(',') || '';
      if (!/FlateDecode/i.test(f)) { o.skip = true; continue; }
      data = await inflate(data);
    }
    const n = N(d.N?.v) ?? 0, first = N(d.First?.v) ?? 0;
    const s = latin1(data);
    const ht = scan(s.slice(0, first));
    const nums = [], offs = [];
    for (let i = 0; i < n; i++) { nums.push(ht[i * 2]?.value); offs.push(ht[i * 2 + 1]?.value); }
    for (let i = 0; i < n; i++) {
      const num = nums[i];
      if (!Number.isFinite(num) || objs.has(num)) continue;
      const start = first + (offs[i] ?? 0);
      const end = i + 1 < n ? first + (offs[i + 1] ?? 0) : s.length;
      const content = s.slice(start, end);
      const toks = scan(content);
      const [val] = parseAt(toks, 0);
      objs.set(num, {
        num, gen: 0, head: content, headEnd: content.length,
        toks, val, streamStart: -1, dataEnd: -1, streamData: null, fromObjStm: true,
      });
    }
    o.skip = true;
  }
}

function algorithmLabel(e) {
  if (e.R >= 6) return 'AES-256（PDF 2.0 / R6）';
  if (e.R === 5) return 'AES-256（R5，旧草案）';
  if (e.V === 4) return e.stmF === 'V2' ? 'RC4 128 位（V4）' : 'AES-128';
  if (e.R >= 3) return 'RC4 128 位';
  return 'RC4 40 位';
}

const PERM_BITS = [
  [3, '打印'], [4, '修改内容'], [5, '复制文字/图片'], [6, '添加批注'],
  [9, '填写表单'], [10, '无障碍提取'], [11, '组装文档'], [12, '高质量打印'],
];
function permissionsOf(P) {
  return PERM_BITS.map(([bit, label]) => ({ label, allowed: !!(P & (1 << (bit - 1))) }));
}

/** 只读检查：加密方式、权限位、是否本来就没设打开密码 */
export async function inspectPdf(bytes, { probeEmpty = false } = {}) {
  const text = latin1(bytes);
  if (!/%PDF-\d/.test(text.slice(0, 1024))) throw new Error('这不是有效的 PDF 文件');
  const objs = parseObjects(text);
  const tr = readTrailer(text, objs);
  if (!tr || tr.encryptRef == null) return { encrypted: false };
  const e = readEncrypt(objs, tr.encryptRef);
  const info = {
    encrypted: true,
    algorithm: algorithmLabel(e),
    version: e.V, revision: e.R,
    permissions: permissionsOf(e.P),
    encryptMetadata: e.encMeta,
    objectCount: objs.size,
  };
  if (probeEmpty) {
    try { await deriveKey(e, '', tr.id0); info.needsPassword = false; }
    catch { info.needsPassword = true; }
  }
  return info;
}

/**
 * 解密并导出无密码 PDF。
 * @returns {Promise<{bytes: Uint8Array, info: object, via: string}>}
 */
export async function unlockPdf(bytes, password = '') {
  const text = latin1(bytes);
  if (!/%PDF-\d/.test(text.slice(0, 1024))) throw new Error('这不是有效的 PDF 文件');

  const objs = parseObjects(text);
  const tr = readTrailer(text, objs);
  if (!tr || tr.encryptRef == null) throw new Error('这个 PDF 没有加密，不需要解锁');
  const e = readEncrypt(objs, tr.encryptRef);
  const { key, via } = await deriveKey(e, password, tr.id0);
  const cipher = makeCipher(e, key);

  await expandObjectStreams(objs);

  const skip = new Set([e.ref]);
  for (const o of objs.values()) {
    const d = D(o.val);
    const type = NAME(d?.Type?.v);
    if (type === 'XRef' || type === 'ObjStm' || o.num === e.ref) o.skip = true;
    // 签名字典的 /Contents 与 XMP 元数据（EncryptMetadata=false 时）本来就是明文
    if (d?.ByteRange || (type === 'Metadata' && !e.encMeta)) o.skipDecrypt = true;
  }

  const rebuilt = [];
  for (const o of objs.values()) {
    if (o.skip || skip.has(o.num)) continue;
    if (o.skipDecrypt) {
      rebuilt.push({ num: o.num, gen: o.gen, body: o.streamStart >= 0
        ? o.head + 'stream\n' + latin1(o.streamData) + '\nendstream'
        : o.head });
      continue;
    }
    const repls = [];
    for (const t of o.toks) {
      if (t.type !== 'str' || !t.bytes.length) continue;
      const dec = await cipher.decrypt(t.bytes, o.num, o.gen, cipher.strMode);
      repls.push({ start: t.start, end: t.end, text: '<' + hexOf(dec) + '>' });
    }
    let streamText = null;
    if (o.streamStart >= 0) {
      const dec = await cipher.decrypt(o.streamData, o.num, o.gen, cipher.stmMode);
      const lenEntry = D(o.val)?.Length;
      if (lenEntry?.range && !repls.some((r) => r.start === lenEntry.range[0])) {
        repls.push({ start: lenEntry.range[0], end: lenEntry.range[1], text: String(dec.length) });
      }
      streamText = 'stream\n' + latin1(dec) + '\nendstream';
    }
    let head = o.head;
    repls.sort((a, b) => b.start - a.start);
    for (const r of repls) head = head.slice(0, r.start) + r.text + head.slice(r.end);
    rebuilt.push({ num: o.num, gen: o.gen, body: streamText ? head + streamText : head });
  }
  rebuilt.sort((a, b) => a.num - b.num);

  // 重写一份传统 xref table：对象号保持不变，所以所有引用依然有效
  const hm = /%PDF-\d\.\d/.exec(text);
  const headerEnd = hm ? text.indexOf('\n', hm.index) + 1 : 0;
  const parts = [text.slice(0, headerEnd) + '%\xE2\xE3\xCF\xD3\n'];
  let pos = bytesOf(parts[0]).length;
  const offsets = new Map();
  for (const o of rebuilt) {
    offsets.set(o.num, pos);
    const chunk = `${o.num} ${o.gen} obj\n${o.body}\nendobj\n`;
    parts.push(chunk);
    pos += bytesOf(chunk).length;
  }
  const maxNum = Math.max(tr.size ? tr.size - 1 : 0, ...[...offsets.keys()], tr.rootRef || 0, tr.infoRef || 0);
  const xrefStart = pos;
  let xref = `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxNum; i++) {
    xref += offsets.has(i) ? `${String(offsets.get(i)).padStart(10, '0')} 00000 n \n` : '0000000000 00000 f \n';
  }
  const idAttr = tr.id0?.length ? ` /ID [<${hexOf(tr.id0)}> <${hexOf(tr.id1 || tr.id0)}>]` : '';
  let trailer = `trailer\n<< /Size ${maxNum + 1}`;
  if (tr.rootRef != null) trailer += ` /Root ${tr.rootRef} 0 R`;
  if (tr.infoRef != null) trailer += ` /Info ${tr.infoRef} 0 R`;
  trailer += `${idAttr} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(xref, trailer);

  return {
    bytes: bytesOf(parts.join('')),
    via,
    info: { algorithm: algorithmLabel(e), revision: e.R, objectCount: rebuilt.length },
  };
}
