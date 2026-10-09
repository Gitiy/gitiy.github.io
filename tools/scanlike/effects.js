/* ============================================================
   ScanLike — 效果管线与工具函数（可独立复用 / 便于自测）
   ============================================================ */

export const MAX_PIXELS = 30e6;   // 单页像素上限，防止内存爆掉
export const REF_SCALE = 150 / 72; // 噪点以 150 DPI 为基准做分辨率归一化

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

/** 画布工厂：主线程用 <canvas>，Worker 里用 OffscreenCanvas */
export function makeCanvas(w, h) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') {
    return new OffscreenCanvas(W, H);
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

/** 可复现的伪随机数（同一 seed 永远得到同样的噪点） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

export function parsePageRange(str, total) {
  if (!str || !str.trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set();
  for (const raw of str.split(',')) {
    const s = raw.trim();
    if (!s) continue;
    let m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = +m[1], b = +m[2];
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) set.add(i);
      continue;
    }
    m = s.match(/^(\d+)\s*-$/);
    if (m) {
      for (let i = +m[1]; i <= total; i++) if (i >= 1) set.add(i);
      continue;
    }
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 1 && n <= total) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/* ---------- 极简 ZIP 打包（store 模式，无压缩，零依赖） ---------- */

let CRC_TABLE = null;
export function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, f.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/* ---------- 图像效果 ---------- */

export function filterString(o, scale) {
  const p = [];
  if (o.blur > 0) p.push(`blur(${round(o.blur * scale, 3)}px)`);
  p.push(`brightness(${o.brightness}%)`);
  p.push(`contrast(${o.contrast}%)`);
  p.push(`saturate(${o.saturation}%)`);
  if (o.colorMode === 'grayscale') p.push('grayscale(1)');
  // 黑白模式这里只做去色，真正的二值化在 compose 里、噪点之后再做，
  // 否则先二值化会把后面加的颗粒噪点又盖回来，出来是"灰底"而不是传真那种纯黑白
  else if (o.colorMode === 'bw') p.push('grayscale(1)');
  else if (o.colorMode === 'sepia') p.push('sepia(0.72)');
  return p.join(' ');
}

/**
 * 传真/复印机的硬阈值滤镜。
 * 用 brightness 把阈值挪到指定亮度，再用极高对比度把中间调压成非黑即白：
 *   out = ((in * B) - 0.5) * C + 0.5  →  阈值出现在 in = 0.5 / B
 * 所以 B = 50 / 阈值(%)。阈值 50% 时 B = 1（即不过曝不过暗）。
 */
function bwFilter(thresholdPct) {
  const b = clamp(50 / (Number(thresholdPct) || 50), 0.4, 2);
  return `grayscale(1) brightness(${(b * 100).toFixed(1)}%) contrast(1500%)`;
}

/* ---------- 噪点贴图 ----------
   原来是逐像素跑 ImageData 循环，在 30MP 页面上是两次 ~120MB 的内存拷贝。
   改成预生成噪声贴图 + 随机偏移平铺：
     · 用 source-over 叠加「以中灰为中心」的噪声，等价于往原图加噪声
       （白纸上只会变暗 —— 因为变亮的部分会被 255 截断，和原来的逐像素加法观感一致）
     · 泛黄用一次 multiply 纯色填充，等价于逐通道乘系数
   全部走 GPU 合成，没有逐像素循环。
*/

const NOISE_TILES = 4;
let noiseTiles = null;
let speckleTile = null;

// 用固定种子的伪随机数生成贴图，而不是 Math.random()：
// 每个 worker 各自持有一份 effects.js 实例，如果各自随机，
// 同一页在不同 worker 上噪点就会不同，预览与导出对不上。
const TILE_SEED = 0x5ca71e;
let tileRng = null;
const nextTileRandom = () => {
  if (!tileRng) tileRng = mulberry32(TILE_SEED);
  return tileRng();
};

function makeNoiseTile(size) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // 偏斜分布 v = 255·(1-u³)：大部分接近白，少数明显压暗。
    // 这样 source-over 叠加后的「最大压暗 = alpha、平均压暗 = alpha/4」，
    // 正好等于原来逐像素加法在白纸上被 255 截断后的统计特征，观感一致。
    const u = nextTileRandom();
    const v = 255 * (1 - u * u * u);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeSpeckleTile(size) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (nextTileRandom() < 0.0035) {
      const dark = nextTileRandom() < 0.58;
      d[i] = d[i + 1] = d[i + 2] = dark ? 0 : 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function getNoiseTiles() {
  if (!noiseTiles) {
    noiseTiles = [];
    for (let i = 0; i < NOISE_TILES; i++) noiseTiles.push(makeNoiseTile(384));
    speckleTile = makeSpeckleTile(384);
  }
  return noiseTiles;
}

function tileOver(ctx, tile, cell, ox, oy, w, h) {
  const ts = tile.width;
  for (let y = oy; y < h; y += cell) {
    for (let x = ox; x < w; x += cell) {
      ctx.drawImage(tile, 0, 0, ts, ts, x, y, cell, cell);
    }
  }
}

/** 噪点 + 椒盐斑点 + 纸张泛黄（按分辨率归一化，保证不同 DPI 观感一致） */
export function applyGrain(ctx, w, h, o, rng, scale) {
  const noise = o.noise / 100;
  const warm = o.yellowish / 100;
  if (noise <= 0 && warm <= 0) return;

  const k = clamp(REF_SCALE / scale, 0.6, 1.7);

  // 纸张泛黄：等价于 R×1、G×0.95、B×0.82 的逐通道乘法
  if (warm > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = clamp(warm, 0, 1);
    ctx.fillStyle = 'rgb(255, 243, 209)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (noise <= 0) return;

  const tiles = getNoiseTiles();
  const tile = tiles[Math.floor(rng() * tiles.length) % tiles.length];
  const cell = Math.max(48, Math.round(tile.width / k));   // DPI 越低，颗粒按比例放大
  const ox = -Math.floor(rng() * cell);
  const oy = -Math.floor(rng() * cell);

  // 系数 0.35 对应旧版逐像素振幅 noise*88/255，配合偏斜噪声分布可完整复现原观感
  ctx.save();
  ctx.globalAlpha = clamp(noise * 0.35, 0, 1);
  tileOver(ctx, tile, cell, ox, oy, w, h);
  ctx.restore();

  // 椒盐斑点
  if (speckleTile) {
    const cell2 = Math.max(64, Math.round(speckleTile.width / k));
    ctx.save();
    ctx.globalAlpha = clamp(noise * 0.3, 0, 1);
    tileOver(ctx, speckleTile, cell2, -Math.floor(rng() * cell2), -Math.floor(rng() * cell2), w, h);
    ctx.restore();
  }
}

/** 边缘阴影：模拟扫描仪盖板压边 */
export function drawEdgeShade(ctx, w, h, strength) {
  const band = Math.max(6, Math.min(w, h) * 0.035);
  const grads = [
    [ctx.createLinearGradient(-w / 2, 0, -w / 2 + band, 0), -w / 2, -h / 2, band, h, 0.30],
    [ctx.createLinearGradient(0, -h / 2, 0, -h / 2 + band * 0.85), -w / 2, -h / 2, w, band * 0.85, 0.16],
    [ctx.createLinearGradient(0, h / 2, 0, h / 2 - band * 0.7), -w / 2, h / 2 - band * 0.7, w, band * 0.7, 0.12],
    [ctx.createLinearGradient(w / 2, 0, w / 2 - band * 0.6, 0), w / 2 - band * 0.6, -h / 2, band * 0.6, h, 0.08],
  ];
  for (const [g, x, y, gw, gh, a] of grads) {
    g.addColorStop(0, `rgba(0,0,0,${(a * strength).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, gw, gh);
  }
}

export function drawBorder(ctx, w, h, lw) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.42)';
  ctx.lineWidth = lw;
  ctx.strokeRect(-w / 2 + lw / 2, -h / 2 + lw / 2, w - lw, h - lw);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = lw * 0.5;
  ctx.strokeRect(-w / 2 + lw * 1.5, -h / 2 + lw * 1.5, w - lw * 3, h - lw * 3);
  ctx.restore();
}

/** 旋转 + 白纸底 + 投影 + 边缘阴影 + 边框（角度由外部传入，保证预览与导出一致） */
export function compose(base, o, angleDeg, scale) {
  const w = base.width, h = base.height;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const ow = Math.ceil(w * cos + h * sin);
  const oh = Math.ceil(w * sin + h * cos);

  const out = makeCanvas(ow, oh);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ow, oh);

  ctx.save();
  ctx.translate(ow / 2, oh / 2);
  ctx.rotate(rad);

  // 纸张投影
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = Math.max(2, 5 * scale);
  ctx.shadowOffsetY = 1.5 * scale;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();

  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.clip();
  if (o.colorMode === 'bw') {
    // 二值化放在噪点之后：颗粒被阈值吃掉，只留下椒盐斑点，正是传真件的样子
    ctx.save();
    ctx.filter = bwFilter(o.bwThreshold);
    ctx.drawImage(base, -w / 2, -h / 2);
    ctx.restore();
  } else {
    ctx.drawImage(base, -w / 2, -h / 2);
  }
  if (o.edgeShadow > 0) drawEdgeShade(ctx, w, h, o.edgeShadow / 100);
  if (o.border) drawBorder(ctx, w, h, Math.max(1, o.borderWidth * scale));
  ctx.restore();

  return out;
}

/* ---------- 覆盖层：签名 / 印章 / 水印 ---------- */

/** 该覆盖层是否作用于指定页 */
export function overlayApplies(ov, page) {
  if (ov.pages === 'current') return ov.page === page;
  if (ov.pages === 'custom') {
    const list = String(ov.pageRange || '')
      .split(',')
      .flatMap((s) => {
        const m = s.trim().match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) return Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i);
        const n = parseInt(s, 10);
        return isNaN(n) ? [] : [n];
      });
    return list.includes(page);
  }
  return true;
}

/** 估算一段文字的相对宽度（中日韩字符按 1 字宽，其余按 0.55） */
export function estimateTextWidth(text, fontPx) {
  let units = 0;
  for (const ch of String(text || '')) {
    units += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1.0 : 0.55;
  }
  return units * fontPx;
}

/** 计算覆盖层在页面坐标系里的几何（供绘制与命中检测共用） */
export function overlayGeometry(ov, pageW, pageH, imgRatio = 1) {
  const cx = (ov.x ?? 0.5) * pageW;
  const cy = (ov.y ?? 0.5) * pageH;
  if (ov.type === 'text') {
    const fontPx = Math.max(6, (ov.size || 0.06) * pageW);
    const est = estimateTextWidth(ov.text, fontPx) || fontPx;
    const w = ov.tile ? pageW * 1.6 : est;
    const h = ov.tile ? pageH * 1.6 : fontPx * 1.3;
    return { cx, cy, w, h, rot: ov.rot || 0, fontPx };
  }
  const w = (ov.w || 0.25) * pageW;
  const h = w * imgRatio;
  return { cx, cy, w, h, rot: ov.rot || 0 };
}

function drawTextOverlay(ctx, pageW, pageH, ov) {
  const g = overlayGeometry(ov, pageW, pageH);
  ctx.font = `400 ${g.fontPx}px "Segoe UI","Microsoft YaHei","PingFang SC",sans-serif`;
  ctx.fillStyle = ov.color || 'rgba(0,0,0,0.28)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(g.cx, g.cy);
  ctx.rotate((g.rot * Math.PI) / 180);
  if (ov.tile) {
    const tw = ctx.measureText(ov.text || '').width || g.fontPx;
    const stepX = tw + g.fontPx * 2.4;
    const stepY = g.fontPx * 3.6;
    const diag = Math.hypot(pageW, pageH);
    for (let y = -diag; y <= diag; y += stepY) {
      for (let x = -diag; x <= diag; x += stepX) ctx.fillText(ov.text || '', x, y);
    }
  } else {
    ctx.fillText(ov.text || '', 0, 0);
  }
}

function drawImageOverlay(ctx, pageW, pageH, ov, img) {
  const ratio = (img.height || 1) / (img.width || 1);
  const g = overlayGeometry(ov, pageW, pageH, ratio);
  ctx.translate(g.cx, g.cy);
  ctx.rotate((g.rot * Math.PI) / 180);
  ctx.drawImage(img, -g.w / 2, -g.h / 2, g.w, g.h);
}

export function drawOverlays(ctx, pageW, pageH, list, page, resolveImage) {
  if (!list || !list.length) return;
  for (const ov of list) {
    if (ov.hidden) continue;
    if (!overlayApplies(ov, page)) continue;
    ctx.save();
    ctx.globalAlpha = ov.opacity == null ? 1 : ov.opacity;
    try {
      if (ov.type === 'text') {
        drawTextOverlay(ctx, pageW, pageH, ov);
      } else {
        const img = resolveImage ? resolveImage(ov.assetId) : null;
        if (img) drawImageOverlay(ctx, pageW, pageH, ov, img);
      }
    } catch (err) {
      console.warn('覆盖层绘制失败', err);
    }
    ctx.restore();
  }
}

/** 取该页实际使用的旋转角度（先于噪点消耗随机数，保证不同分辨率下角度一致） */
export function rotationAngle(o, seed) {
  const rng = mulberry32(seed);
  return o.rotate + (rng() * 2 - 1) * o.rotateVariance;
}

/**
 * 完整处理：源画布 -> 扫描效果画布
 * @param opts {overlays, page, resolveImage, fast}
 */
export function processCanvas(src, o, scale, seed, opts = {}) {
  const rng = mulberry32(seed);
  const angle = o.rotate + (rng() * 2 - 1) * o.rotateVariance;   // 必须先取，否则受画布尺寸影响
  const w = src.width, h = src.height;
  const base = makeCanvas(w, h);
  const bctx = base.getContext('2d');
  bctx.fillStyle = '#ffffff';
  bctx.fillRect(0, 0, w, h);
  bctx.filter = filterString(o, scale);
  bctx.drawImage(src, 0, 0);
  // 覆盖层走同一条滤镜链，因此签名/印章会带上模糊与色调，看起来是"扫描进去的"
  drawOverlays(bctx, w, h, opts.overlays, opts.page || 1, opts.resolveImage);
  bctx.filter = 'none';
  if (!opts.fast) applyGrain(bctx, w, h, o, rng, scale);
  const out = compose(base, o, angle, scale);
  out.__meta = { angle, pageW: w, pageH: h };
  return out;
}

export const pageSeed = (o, page) => (o.seed | 0) + page * 7919;
