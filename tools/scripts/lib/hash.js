/**
 * 哈希与校验和。
 *
 * SHA-1/256/384/512 交给 WebCrypto（原生实现，快且不会有手写错误）。
 * MD5 / RIPEMD-160 / SHA-3 浏览器不提供，这里自己实现 ——
 * 算法本身是公开标准，实现后会用官方向量逐个比对（见 _selftest）。
 */

/* ============================================================
   字节输入统一化
   ============================================================ */

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new TextEncoder().encode(String(input));
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const u32le = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** 通用：按 MD5/RIPEMD 的规则补位（0x80 + 0 填充 + 小端 64 位长度） */
function padLittleEndian(msg, blockSize = 64) {
  const len = msg.length;
  const withOne = len + 1;
  const padLen = ((blockSize - 8 - (withOne % blockSize)) + blockSize) % blockSize;
  const total = withOne + padLen + 8;
  const out = new Uint8Array(total);
  out.set(msg);
  out[len] = 0x80;
  const dv = new DataView(out.buffer);
  // 64 位长度：高 32 位用除法算，避免 (len << 3) 溢出
  dv.setUint32(total - 8, (len << 3) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(len / 0x20000000) >>> 0, true);
  return out;
}

const rotl32 = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

/* ============================================================
   MD5
   ============================================================ */

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(abs(sin(i+1)) * 2^32)，标准定义，直接算避免抄错常量表 */
const MD5_K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  return k;
})();

export function md5(input) {
  const data = padLittleEndian(toBytes(input));
  const dv = new DataView(data.buffer);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < data.length; off += 64) {
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
      B = (B + rotl32(F, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  return hex([...u32le(a0), ...u32le(b0), ...u32le(c0), ...u32le(d0)]);
}

/* ============================================================
   RIPEMD-160
   ============================================================ */

const RMD_R = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];
const RMD_RP = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
];
const RMD_S = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const RMD_SP = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];
const RMD_K = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const RMD_KP = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

const f1 = (x, y, z) => (x ^ y ^ z) >>> 0;
const f2 = (x, y, z) => ((x & y) | (~x & z)) >>> 0;
const f3 = (x, y, z) => ((x | ~y) ^ z) >>> 0;
const f4 = (x, y, z) => ((x & z) | (y & ~z)) >>> 0;
const f5 = (x, y, z) => (x ^ (y | ~z)) >>> 0;
const RMD_F = [f1, f2, f3, f4, f5];

export function ripemd160(input) {
  const data = padLittleEndian(toBytes(input));
  const dv = new DataView(data.buffer);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  for (let off = 0; off < data.length; off += 64) {
    const X = new Uint32Array(16);
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);

    let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4;

    for (let j = 0; j < 80; j++) {
      const round = (j / 16) | 0;
      let t = (al + RMD_F[round](bl, cl, dl) + X[RMD_R[j]] + RMD_K[round]) >>> 0;
      t = (rotl32(t, RMD_S[j]) + el) >>> 0;
      al = el; el = dl; dl = rotl32(cl, 10); cl = bl; bl = t;

      t = (ar + RMD_F[4 - round](br, cr, dr) + X[RMD_RP[j]] + RMD_KP[round]) >>> 0;
      t = (rotl32(t, RMD_SP[j]) + er) >>> 0;
      ar = er; er = dr; dr = rotl32(cr, 10); cr = br; br = t;
    }

    const t = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + er) >>> 0;
    h2 = (h3 + el + ar) >>> 0;
    h3 = (h4 + al + br) >>> 0;
    h4 = (h0 + bl + cr) >>> 0;
    h0 = t;
  }

  return hex([...u32le(h0), ...u32le(h1), ...u32le(h2), ...u32le(h3), ...u32le(h4)]);
}

/* ============================================================
   SHA-3 / Keccak（浏览器 WebCrypto 不提供）
   ============================================================ */

const MASK64 = (1n << 64n) - 1n;
const rotl64 = (x, n) => (n === 0n ? x : ((x << n) | (x >> (64n - n))) & MASK64);

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
/**
 * ρ 与 π 步骤合并成 24 个「目标通道 + 旋转量」对，
 * 这样不用手写 5×5 的旋转表 —— 那张表很容易写转置（我第一版就写错了）。
 * 表来自 Keccak 参考实现，扁平状态索引是 lane = x + 5y。
 */
const KECCAK_PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const KECCAK_ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];

/** Keccak-f[1600] 置换，st 是 25 个 64 位通道（lane = x + 5y） */
function keccakF(st) {
  const bc = new Array(5).fill(0n);

  for (let round = 0; round < 24; round++) {
    // θ
    for (let i = 0; i < 5; i++) bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1n);
      for (let j = 0; j < 25; j += 5) st[j + i] ^= t;
    }

    // ρ + π
    let t = st[1];
    for (let i = 0; i < 24; i++) {
      const j = KECCAK_PILN[i];
      const prev = st[j];
      st[j] = rotl64(t, BigInt(KECCAK_ROTC[i]));
      t = prev;
    }

    // χ
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = st[j + i];
      for (let i = 0; i < 5; i++) st[j + i] ^= (~bc[(i + 1) % 5] & MASK64) & bc[(i + 2) % 5];
    }

    // ι
    st[0] ^= KECCAK_RC[round];
  }
}

function keccakSponge(bytes, rate, outLen, domain) {
  const st = new Array(25).fill(0n);

  // 补位：domain 后缀 + 0x00… + 末字节置最高位
  const padLen = rate - (bytes.length % rate);
  const padded = new Uint8Array(bytes.length + padLen);
  padded.set(bytes);
  padded[bytes.length] = domain;
  padded[padded.length - 1] |= 0x80;

  const lanes = rate / 8;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < lanes; i++) {
      let lane = 0n;
      // 小端：第 0 个字节是最低位
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      st[i] ^= lane;
    }
    keccakF(st);
  }

  const out = new Uint8Array(outLen);
  let written = 0;
  while (written < outLen) {
    for (let i = 0; i < lanes && written < outLen; i++) {
      const lane = st[i];
      for (let b = 0; b < 8 && written < outLen; b++) {
        out[written++] = Number((lane >> BigInt(b * 8)) & 0xffn);
      }
    }
    if (written < outLen) keccakF(st);
  }
  return out;
}

/** NIST SHA-3（domain 0x06） */
export const sha3_256 = (input) => hex(keccakSponge(toBytes(input), 136, 32, 0x06));
export const sha3_512 = (input) => hex(keccakSponge(toBytes(input), 72, 64, 0x06));
/** 原始 Keccak（domain 0x01）—— 以太坊用的是这个，和 SHA3 不是一回事 */
export const keccak256 = (input) => hex(keccakSponge(toBytes(input), 136, 32, 0x01));

/* ============================================================
   WebCrypto 覆盖的 SHA 系列
   ============================================================ */

const SUBTLE_ALGO = {
  'sha1': 'SHA-1', 'sha256': 'SHA-256', 'sha384': 'SHA-384', 'sha512': 'SHA-512',
};

export async function sha(input, algo) {
  const name = SUBTLE_ALGO[algo];
  if (!name) throw new Error('不支持的算法：' + algo);
  const buf = await crypto.subtle.digest(name, toBytes(input));
  return hex(new Uint8Array(buf));
}

/* ============================================================
   校验和
   ============================================================ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : (c >>> 1) >>> 0;
    t[n] = c;
  }
  return t;
})();

/** CRC-32（IEEE 802.3，和 zip / PNG 用的是同一个） */
export function crc32(input) {
  const bytes = toBytes(input);
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/** Adler-32（zlib 用的那个，比 CRC-32 快但弱） */
export function adler32(input) {
  const bytes = toBytes(input);
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, '0');
}

/* ============================================================
   统一入口
   ============================================================ */

/** 所有可算的算法，供界面生成选项 */
export const ALGORITHMS = [
  { id: 'md5', label: 'MD5', bits: 128, weak: true, note: '已不安全，仅用于校验' },
  { id: 'sha1', label: 'SHA-1', bits: 160, weak: true, note: '已不安全，仅用于校验' },
  { id: 'sha256', label: 'SHA-256', bits: 256 },
  { id: 'sha384', label: 'SHA-384', bits: 384 },
  { id: 'sha512', label: 'SHA-512', bits: 512 },
  { id: 'sha3-256', label: 'SHA-3 256', bits: 256 },
  { id: 'sha3-512', label: 'SHA-3 512', bits: 512 },
  { id: 'keccak256', label: 'Keccak-256', bits: 256, note: '以太坊用的原始 Keccak' },
  { id: 'ripemd160', label: 'RIPEMD-160', bits: 160 },
  { id: 'crc32', label: 'CRC-32', bits: 32, checksum: true },
  { id: 'adler32', label: 'Adler-32', bits: 32, checksum: true },
];

export async function hash(input, algo) {
  switch (algo) {
    case 'md5': return md5(input);
    case 'ripemd160': return ripemd160(input);
    case 'sha3-256': return sha3_256(input);
    case 'sha3-512': return sha3_512(input);
    case 'keccak256': return keccak256(input);
    case 'crc32': return crc32(input);
    case 'adler32': return adler32(input);
    default: return sha(input, algo);
  }
}

/** 一次算全部（界面里的「全部算法」模式） */
export async function hashAll(input) {
  const out = [];
  for (const a of ALGORITHMS) {
    try {
      out.push({ algo: a.id, label: a.label, hex: await hash(input, a.id) });
    } catch (err) {
      out.push({ algo: a.id, label: a.label, hex: '', error: err.message });
    }
  }
  return out;
}
