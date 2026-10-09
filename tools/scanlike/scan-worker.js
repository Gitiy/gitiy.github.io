/* ============================================================
   ScanLike 效果处理线程
   把整条效果管线（滤镜 → 覆盖层 → 噪点 → 旋转/边框）搬出主线程，
   主线程只负责 UI，导出时不再卡死。
   同一个 Worker 可以复用于预览和导出，多个 Worker 组成池并行处理多页。
   ============================================================ */

import { processCanvas } from './effects.js';

/** assetId -> ImageBitmap，由主线程下发 */
const assets = new Map();

self.onmessage = async (e) => {
  const m = e.data;

  if (m.type === 'assets') {
    assets.clear();
    for (const [k, v] of Object.entries(m.assets || {})) assets.set(k, v);
    return;
  }

  if (m.type !== 'process') return;

  const { id, bitmap, settings, scale, seed, page, overlays, fast, want, mime, quality } = m;
  try {
    const src = new OffscreenCanvas(bitmap.width, bitmap.height);
    src.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const out = processCanvas(src, settings, scale, seed, {
      overlays,
      page,
      fast,
      resolveImage: (key) => assets.get(key) || null,
    });
    const meta = out.__meta || null;
    const w = out.width, h = out.height;

    if (want === 'blob') {
      const blob = await out.convertToBlob({ type: mime || 'image/jpeg', quality: quality == null ? 0.85 : quality });
      self.postMessage({ id, ok: true, blob, meta, w, h });
    } else {
      const bmp = out.transferToImageBitmap();
      self.postMessage({ id, ok: true, bitmap: bmp, meta, w, h }, [bmp]);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
