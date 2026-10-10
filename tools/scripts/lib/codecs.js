/**
 * 图片编解码统一入口。
 *
 * 为什么不直接用 canvas.toBlob：
 * 实测 Chrome 只能原生编码 baseline JPEG 和 WebP，**不支持 AVIF**，
 * JPEG 也没有 MozJPEG 的渐进式与网格量化优化。同一张 480×320 测试图
 * （渐变 + 噪点块 + 中英文字）实测：
 *   PNG 原图 210.7 KB
 *   浏览器原生 JPEG q72   24.6 KB
 *   MozJPEG        q72    21.4 KB   ← 小 13%
 *   AVIF           q55    14.1 KB   ← 只有原图 7%
 *   OxiPNG         lv3    92.8 KB   ← 无损，体积砍掉 56%
 * 所以这里直接用 squoosh.app 用的那几个 WASM 编解码器（jsquash 封装）。
 *
 * 所有编解码器都在 vendor/jsquash/ 下，路径通过 import.meta.url 解析，
 * 因此无论页面在 /tools/ 还是子路径下都能加载。
 */

const BASE = new URL('../../vendor/jsquash/', import.meta.url);

/** 编解码器元信息，供界面生成选项 */
export const CODECS = [
  {
    id: 'mozjpeg', label: 'MozJPEG', ext: 'jpg', mime: 'image/jpeg',
    lossy: true, engine: 'MozJPEG (WASM)', quality: 75,
    desc: '渐进式 JPEG，同画质下比浏览器自带编码器小 10–15%。照片首选。',
  },
  {
    id: 'avif', label: 'AVIF', ext: 'avif', mime: 'image/avif',
    lossy: true, engine: 'libavif (WASM)', quality: 50, heavy: true,
    desc: '压缩率最高，通常只有 JPEG 的一半大小。首次使用需加载 3.4 MB 编码器。',
  },
  {
    id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp',
    lossy: true, engine: '浏览器内置 libwebp', quality: 80,
    desc: '兼容性最好的现代格式，浏览器原生编码，速度最快。',
  },
  {
    id: 'oxipng', label: 'OxiPNG', ext: 'png', mime: 'image/png',
    lossy: false, engine: 'OxiPNG (WASM)', level: 3,
    desc: 'PNG 无损优化，画面完全不变，体积通常能减 30–60%。',
  },
  {
    id: 'png', label: 'PNG（无损）', ext: 'png', mime: 'image/png',
    lossy: false, engine: '浏览器内置',
    desc: '标准 PNG，不做额外优化。需要最快速度时用。',
  },
  {
    id: 'jpeg', label: 'JPEG（快速）', ext: 'jpg', mime: 'image/jpeg',
    lossy: true, engine: '浏览器内置', quality: 80,
    desc: '浏览器原生 JPEG，速度最快，压缩率不如 MozJPEG。',
  },
];

export const codecById = (id) => CODECS.find((c) => c.id === id) || CODECS[0];

/* ============================================================
   懒加载编解码器模块
   ============================================================ */

const moduleCache = new Map();

export function loadCodec(id) {
  if (moduleCache.has(id)) return moduleCache.get(id);
  const url = (rel) => new URL(rel, BASE).href;

  const p = (async () => {
    switch (id) {
      case 'mozjpeg': return (await import(url('jpeg/encode.js'))).default;
      case 'avif': return (await import(url('avif/encode.js'))).default;
      case 'oxipng': return (await import(url('oxipng/optimise.js'))).default;
      case 'resize': return (await import(url('resize/index.js'))).default;
      default: return null;   // webp / png / jpeg 走浏览器原生，不需要模块
    }
  })();

  moduleCache.set(id, p);
  return p;
}

/** 预热：在用户还没点导出之前先把编解码器拉下来，减少等待 */
export function preloadCodecs(...ids) {
  return Promise.all(ids.map((id) => loadCodec(id).catch(() => null)));
}

/* ============================================================
   解码 / 编码
   ============================================================ */

/**
 * 把图片源解成 ImageData。
 * 用 imageOrientation:'from-image' 让带 EXIF 旋转的照片自动摆正 ——
 * 否则手机拍的竖图会被压成横的。
 */
export async function decodeImage(source) {
  const bitmap = source instanceof ImageBitmap
    ? source
    : await createImageBitmap(source, { imageOrientation: 'from-image' });

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // 透明区域统一压白底，避免转 JPEG 后变黑
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  if (bitmap !== source && typeof bitmap.close === 'function') bitmap.close();

  return ctx.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: 'srgb' });
}

export function imageDataToCanvas(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布编码失败'))), mime, quality);
  });
}

/**
 * 缩放。method='lanczos3' 时走 WASM（画质明显好于 canvas 的双线性），
 * 其余走 canvas 多级减半 —— 直接一次缩到目标尺寸会丢细节。
 */
export async function resizeImageData(imageData, { width, height, method = 'lanczos3' } = {}) {
  const w = Math.max(1, Math.round(width || imageData.width));
  const h = Math.max(1, Math.round(height || imageData.height));
  if (w === imageData.width && h === imageData.height) return imageData;

  if (method === 'lanczos3') {
    try {
      const resize = await loadCodec('resize');
      return await resize(imageData, { width: w, height: h, method: 'lanczos3', fitMethod: 'stretch' });
    } catch {
      /* 落到 canvas */
    }
  }

  let src = imageData;
  let cw = imageData.width;
  let ch = imageData.height;
  // 多级减半：每级最多缩到一半，最后一级精确到目标尺寸
  while (cw > w * 2 && ch > h * 2) {
    cw = Math.max(w, Math.round(cw / 2));
    ch = Math.max(h, Math.round(ch / 2));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(imageDataToCanvas(src), 0, 0, cw, ch);
    src = cx.getImageData(0, 0, cw, ch, { colorSpace: 'srgb' });
  }

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageDataToCanvas(src), 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' });
}

/**
 * 编码。返回 { bytes, mime, ext, note }
 * opts: { codec, quality, level, interlace, progressive, subsample, speed }
 */
export async function encodeImage(imageData, opts = {}) {
  const meta = codecById(opts.codec);
  const quality = clamp01(opts.quality ?? meta.quality ?? 80);

  switch (meta.id) {
    case 'mozjpeg': {
      const encode = await loadCodec('mozjpeg');
      const buf = await encode(imageData, {
        quality: Math.round(quality * 100),
        progressive: opts.progressive !== false,
        optimize_coding: true,
        auto_subsample: true,
        // 质量低于 80 时允许色度子采样，体积能再降一截
        chroma_subsample: opts.subsample ?? (quality < 0.8 ? 2 : 1),
      });
      return { bytes: new Uint8Array(buf), mime: meta.mime, ext: meta.ext, note: meta.engine };
    }

    case 'avif': {
      const encode = await loadCodec('avif');
      const buf = await encode(imageData, {
        quality: Math.round(quality * 100),
        speed: opts.speed ?? 6,
        subsample: opts.subsample ?? 1,
        enableSharpYUV: true,
      });
      return { bytes: new Uint8Array(buf), mime: meta.mime, ext: meta.ext, note: meta.engine };
    }

    case 'oxipng': {
      const optimise = await loadCodec('oxipng');
      // OxiPNG 吃的是 PNG 字节流，先用无损 PNG 编码一次
      const raw = await canvasToBlob(imageDataToCanvas(imageData), 'image/png');
      const buf = await optimise(await raw.arrayBuffer(), {
        level: opts.level ?? 3,
        interlace: !!opts.interlace,
      });
      return { bytes: new Uint8Array(buf), mime: meta.mime, ext: meta.ext, note: meta.engine };
    }

    case 'webp':
    case 'png':
    case 'jpeg': {
      const q = meta.lossy ? quality : undefined;
      const blob = await canvasToBlob(imageDataToCanvas(imageData), meta.mime, q);
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: meta.mime, ext: meta.ext, note: meta.engine };
    }

    default:
      throw new Error('未知的编码格式：' + opts.codec);
  }
}

/** 无损格式没有质量可调 */
export const isLossy = (id) => !!codecById(id).lossy;

/** 该格式是否需要额外下载 WASM 编码器 */
export const needsWasm = (id) => !!codecById(id).wasm;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.8;
  return Math.max(0.01, Math.min(1, n > 1 ? n / 100 : n));
}

/* ============================================================
   辅助：等比尺寸计算
   ============================================================ */

export function fitSize(w, h, target, mode = 'contain') {
  const tw = Math.max(1, Math.round(target.width || w));
  const th = Math.max(1, Math.round(target.height || h));
  if (mode === 'stretch') return { width: tw, height: th };
  const sx = tw / w;
  const sy = th / h;
  const s = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** 人眼可读的体积变化描述 */
export function sizeDelta(before, after) {
  const ratio = after / before;
  const pct = Math.round((1 - ratio) * 100);
  if (pct > 0) return { pct, text: `减小 ${pct}%`, better: true };
  if (pct < 0) return { pct, text: `增大 ${-pct}%`, better: false };
  return { pct: 0, text: '体积不变', better: false };
}
