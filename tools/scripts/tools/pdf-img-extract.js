import {
  toolPage, fileZone, el, button, numberInput, toggle,
  note, toast, grid, fieldset, progress, previewPane,
} from '../ui.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, makeZip, baseName, fmtBytes } from '../lib/files.js';

/** 把 pdf-lib 的过滤器对象转成字符串数组，例如 ['/FlateDecode'] */
function filterNames(dict, PDFName) {
  const f = dict.get(PDFName.of('Filter'));
  if (!f) return [];
  if (typeof f.asArray === 'function') {
    try { return f.asArray().map((x) => x.asString()); } catch { return []; }
  }
  try { return [f.asString()]; } catch { return []; }
}

/** 原始像素 -> PNG 字节（只处理 8bpc 的 DeviceRGB / DeviceGray） */
async function pixelsToPng(data, w, h, comps) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  if (comps === 3) {
    for (let i = 0, j = 0; i < w * h; i++, j += 3) {
      d[i * 4] = data[j]; d[i * 4 + 1] = data[j + 1]; d[i * 4 + 2] = data[j + 2]; d[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const v = data[i];
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export const tool = {
  init(app) {
    let src = null;
    let found = [];
    let previewUrl = null;

    const page = toolPage({
      title: 'PDF 图片提取',
      icon: '🧲',
      desc: '把 PDF 里内嵌的图片原样导出。JPEG 直接取原始字节不重新编码，其它格式解码后转成 PNG，尽量保留清晰度。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '📄',
      title: '拖入一个 PDF，或点击选择',
      onFiles: (files) => load(files[0]),
    });

    const minSize = numberInput({ label: '忽略小于此边长的图', value: 24, min: 1, max: 2000, unit: 'px' });
    const skipMasked = toggle({ label: '跳过带透明蒙版的图（导出会丢透明通道）', value: false });

    const listHost = el('div', { class: 'filelist' });
    const bar = progress();
    const preview = previewPane('提取后点列表里的「预览」可以看大图');

    const btnGo = button('提取图片', run, { primary: true });
    const btnAll = button('打包下载全部', downloadAll);
    btnGo.disabled = true;
    btnAll.disabled = true;

    page.add(dz, info, fieldset('过滤', grid(minSize, skipMasked)), bar.root, listHost, preview);
    page.setActions(btnGo, btnAll);
    app.main.append(page.root);

    /* ---------------- 逻辑 ---------------- */

    async function load(file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        src = { name: file.name, bytes };
        info.textContent = `${file.name} · ${fmtBytes(bytes.length)}`;
        info.className = 'hint';
        btnGo.disabled = false;
        found = [];
        listHost.replaceChildren();
        btnAll.disabled = true;
      } catch (err) {
        toast('读不了这个文件：' + err.message, 'error');
      }
    }

    async function run() {
      const PDFLib = await loadPdfLib();
      const { PDFName, decodePDFRawStream, PDFRawStream } = PDFLib;
      const doc = await PDFLib.PDFDocument.load(src.bytes);
      const ctx = doc.context;
      const min = minSize.get() || 1;
      const seen = new Set();
      const total = doc.getPageCount();
      found = [];
      listHost.replaceChildren();
      bar.show(0, '正在扫描内嵌图片…');

      for (let i = 0; i < total; i++) {
        bar.set((i / total) * 0.9, `正在扫描第 ${i + 1}/${total} 页…`);
        const res = doc.getPage(i).node.Resources();
        if (!res) continue;
        const xobjRef = res.get(PDFName.of('XObject'));
        if (!xobjRef) continue;
        const xobj = ctx.lookup(xobjRef);
        if (!xobj || typeof xobj.entries !== 'function') continue;

        for (const [, ref] of xobj.entries()) {
          const key = String(ref);
          if (seen.has(key)) continue;
          seen.add(key);

          let obj;
          try { obj = ctx.lookup(ref); } catch { continue; }
          if (!obj || !obj.dict) continue;

          const subtype = obj.dict.get(PDFName.of('Subtype'));
          if (!subtype || String(subtype).replace(/^\//, '') !== 'Image') continue;

          const w = Number(obj.dict.get(PDFName.of('Width'))?.asNumber?.() ?? 0);
          const h = Number(obj.dict.get(PDFName.of('Height'))?.asNumber?.() ?? 0);
          if (!w || !h || w < min || h < min) continue;

          const filters = filterNames(obj.dict, PDFName);
          const hasMask = !!obj.dict.get(PDFName.of('SMask'));
          if (skipMasked.get() && hasMask) continue;

          const bpc = Number(obj.dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() ?? 8);
          const csName = String(obj.dict.get(PDFName.of('ColorSpace')) || '').replace(/^\//, '');

          try {
            if (filters.includes('/DCTDecode') && obj instanceof PDFRawStream) {
              found.push({
                page: i + 1, ext: 'jpg', w, h, data: obj.contents.slice(),
                note: `JPEG 原图${hasMask ? '（有透明蒙版，已忽略）' : ''}`,
              });
            } else if (filters.length === 0 || filters.includes('/FlateDecode')) {
              if (bpc !== 8) continue;
              const comps = csName === 'DeviceRGB' ? 3 : csName === 'DeviceGray' ? 1 : 0;
              if (!comps) continue;
              const decoded = filters.length ? decodePDFRawStream(obj).decode() : obj.contents;
              const data = await pixelsToPng(decoded, w, h, comps);
              found.push({
                page: i + 1, ext: 'png', w, h, data,
                note: `${csName === 'DeviceRGB' ? 'RGB' : '灰度'}解码为 PNG`,
              });
            }
            // 其它编码（JPX / CCITT / 索引色）不硬猜，直接跳过
          } catch {
            /* 单张失败不影响整体 */
          }
        }
      }

      found.forEach((f, i) => { f.name = `p${f.page}_${f.w}x${f.h}_${i + 1}.${f.ext}`; });
      bar.set(1, `扫描完成，找到 ${found.length} 张图片`);
      renderList();
      btnAll.disabled = found.length === 0;
      if (!found.length) {
        listHost.append(el('p', {
          class: 'hint warn',
          text: '没有找到可导出的图片。可能是：PDF 里没有位图、图片用了特殊编码（JPX / CCITT / 索引色）、或者被上面的过滤条件排除了。',
        }));
      }
    }

    function renderList() {
      listHost.replaceChildren();
      for (const f of found) {
        listHost.append(el('div', { class: 'file-row' },
          el('span', { class: 'file-name', title: f.name }, f.name),
          el('span', { class: 'file-note', text: `${f.w}×${f.h} · ${fmtBytes(f.data.length)} · ${f.note}` }),
          button('预览', () => showPreview(f), { small: true }),
          button('下载', () => download(new Blob([f.data]), f.name), { small: true }),
        ));
      }
    }

    function showPreview(f) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([f.data], { type: f.ext === 'jpg' ? 'image/jpeg' : 'image/png' }));
      preview.set(
        el('img', { src: previewUrl, alt: f.name }),
        el('p', { class: 'hint', text: `${f.name} · ${f.w}×${f.h} · ${f.note}` }),
      );
    }

    async function downloadAll() {
      if (!found.length) { toast('还没有提取到图片', 'error'); return; }
      if (found.length === 1) {
        download(new Blob([found[0].data]), found[0].name);
        toast(`已下载 ${found[0].name}`, 'ok');
        return;
      }
      const zip = await makeZip(found.map((f) => ({ name: f.name, data: f.data })));
      const name = `${baseName(src.name)}_图片_${found.length}张.zip`;
      download(zip, name);
      toast(`已下载 ${name}`, 'ok');
    }

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      src = null; found = [];
    };
  },
};
