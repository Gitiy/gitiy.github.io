/** 通用文件工具：格式化、下载、打包 zip、类型判断 */

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v < 10 ? 2 : 1)) + ' ' + units[i];
}

export function baseName(name) {
  return String(name).replace(/\.[^./\\]+$/, '');
}

export function extOf(name) {
  const m = String(name).match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export function replaceExt(name, ext) {
  return baseName(name) + '.' + ext.replace(/^\./, '');
}

/** 生成 20261009-1612 这样的时间戳，用于避免重名覆盖 */
export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function download(data, name) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 交给浏览器读完再回收
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * 打包成 zip。
 * entries: [{ name, data: Uint8Array|ArrayBuffer|string|Blob }]
 */
export async function makeZip(entries, onProgress) {
  const { loadJSZip } = await import('./scripts.js');
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  let i = 0;
  for (const e of entries) {
    zip.file(e.name, e.data);
    if (++i % 10 === 0) onProgress?.(i / entries.length);
  }
  return zip.generateAsync({ type: 'blob' }, (meta) => onProgress?.(meta.percent / 100));
}

export function readBytes(file) {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

export function readText(file) {
  return file.text();
}

export const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImage = (f) =>
  /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name);
export const isDocx = (f) => /\.(docx|docm|dotx)$/i.test(f.name);
export const isXlsx = (f) => /\.(xlsx|xlsm|xls)$/i.test(f.name);
export const isCsv = (f) => /\.(csv|tsv)$/i.test(f.name);
export const isPptx = (f) => /\.(pptx|pptm|potx)$/i.test(f.name);

export function classify(name, type = '') {
  const f = { name, type };
  if (isPdf(f)) return 'pdf';
  if (isImage(f)) return 'image';
  if (isDocx(f)) return 'docx';
  if (isXlsx(f)) return 'xlsx';
  if (isCsv(f)) return 'csv';
  if (isPptx(f)) return 'pptx';
  return 'other';
}

/** 把 canvas 转成 Blob */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败'))), type, quality);
  });
}

/** 从 File 造一个可预览的 ImageBitmap */
export function loadImage(file) {
  return createImageBitmap(file);
}
