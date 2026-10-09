/**
 * PDF 绘制相关的小工具。
 *
 * 文字为什么先画到画布再贴图：pdf-lib 自带的标准字体（Helvetica 等）不含中文字形，
 * 直接 drawText 中文会抛错或变成乱码。用浏览器画布渲染成 PNG 再嵌入，
 * 任意语言都能正常显示，还自带抗锯齿。
 */

export function makeTextImage(text, {
  color = '#e11d48',
  fontPx = 220,
  fontFamily = 'sans-serif',
  weight = 'bold',
  padding = 0.25,
} = {}) {
  const pad = Math.round(fontPx * padding);
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${weight} ${fontPx}px ${fontFamily}`;
  const w = Math.max(1, Math.ceil(probe.measureText(text).width) + pad * 2);
  const h = Math.max(1, Math.ceil(fontPx * 1.35) + pad * 2);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.font = `${weight} ${fontPx}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  return { canvas: c, aspect: h / w };
}

/**
 * 计算「以 (cx,cy) 为中心旋转 rotDeg 度」时，pdf-lib 该把图片画在哪个左下角。
 * pdf-lib 的 rotate 是绕 (x,y) 这个左下角旋转的，所以要先把偏移反向旋转回去。
 */
export function centerRotatedBox(cx, cy, w, h, rotDeg) {
  const r = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = w / 2, dy = h / 2;
  return {
    x: cx - (dx * cos - dy * sin),
    y: cy - (dx * sin + dy * cos),
  };
}

export async function canvasToPngBytes(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export function canvasToDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}
