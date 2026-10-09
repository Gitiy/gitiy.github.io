import {
  toolPage, fileZone, el, button, select, rangeInput, numberInput, toggle,
  note, toast, grid, fieldset, progress,
} from '../ui.js';
import { download, makeZip, baseName, fmtBytes, canvasToBlob } from '../lib/files.js';

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

export const tool = {
  init(app) {
    const items = [];   // { name, bitmap, width, height }

    const page = toolPage({
      title: '图片格式转换',
      icon: '🔄',
      desc: 'PNG / JPG / WebP 互相转换，可同时缩放尺寸、压缩质量、转灰度。多张图片自动打包下载。',
    });

    const listHost = el('div', { class: 'filelist' });
    const dz = fileZone({
      accept: 'image/*,.png,.jpg,.jpeg,.webp,.bmp',
      multiple: true, icon: '🖼️',
      title: '拖入多张图片，或点击选择',
      onFiles: addFiles,
    });

    const fmtSel = select({
      label: '输出格式', value: 'jpeg',
      options: [['jpeg', 'JPG（照片推荐，体积小）'], ['png', 'PNG（无损，支持透明）'], ['webp', 'WebP（同质量体积最小）']],
      onChange: () => qualityRange.root.classList.toggle('hidden', fmtSel.get() === 'png'),
    });
    const qualityRange = rangeInput({
      label: '质量', value: 85, min: 30, max: 100, step: 1, format: (v) => v + '%',
    });
    const maxW = numberInput({ label: '最大宽度', value: 0, min: 0, max: 20000, unit: 'px（0 = 不缩放）' });
    const maxH = numberInput({ label: '最大高度', value: 0, min: 0, max: 20000, unit: 'px（0 = 不缩放）' });
    const grayToggle = toggle({ label: '转灰度', value: false });

    const bar = progress();
    const btnGo = button('转换并下载', run, { primary: true });
    btnGo.disabled = true;

    page.add(dz, listHost, fieldset('输出设置', grid(fmtSel, qualityRange), grid(maxW, maxH), grayToggle), bar.root);
    page.setActions(btnGo, button('清空', clearAll));
    app.main.append(page.root);

    /* ---------------- 逻辑 ---------------- */

    async function addFiles(files) {
      for (const f of files) {
        try {
          const bmp = await createImageBitmap(f);
          items.push({ name: f.name, bitmap: bmp, width: bmp.width, height: bmp.height });
        } catch (err) {
          toast(`${f.name} 读不了：${err.message}`, 'error');
        }
      }
      render();
    }

    function render() {
      listHost.replaceChildren();
      items.forEach((it, i) => {
        listHost.append(el('div', { class: 'file-row' },
          el('span', { class: 'file-idx', text: String(i + 1) }),
          el('span', { class: 'file-name', title: it.name }, it.name),
          el('span', { class: 'file-note', text: `${it.width}×${it.height}` }),
          button('移除', () => { items[i].bitmap.close?.(); items.splice(i, 1); render(); }, { small: true, danger: true }),
        ));
      });
      btnGo.disabled = items.length === 0;
    }

    function clearAll() {
      for (const it of items) it.bitmap.close?.();
      items.length = 0;
      render();
    }

    function targetSize(w, h) {
      const mw = maxW.get() || 0, mh = maxH.get() || 0;
      if (!mw && !mh) return [w, h];
      let s = 1;
      if (mw && w > mw) s = Math.min(s, mw / w);
      if (mh && h > mh) s = Math.min(s, mh / h);
      return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
    }

    async function convert(it) {
      const fmt = fmtSel.get();
      const [w, h] = targetSize(it.width, it.height);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (fmt === 'jpeg') {
        ctx.fillStyle = '#ffffff';       // JPEG 没有透明通道，先压白底
        ctx.fillRect(0, 0, w, h);
      }
      if (grayToggle.get()) ctx.filter = 'grayscale(1)';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(it.bitmap, 0, 0, w, h);
      ctx.filter = 'none';

      const blob = await canvasToBlob(canvas, MIME[fmt], fmt === 'png' ? undefined : qualityRange.get() / 100);
      return new Uint8Array(await blob.arrayBuffer());
    }

    async function run() {
      const fmt = fmtSel.get();
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      const outputs = [];
      let inBytes = 0, outBytes = 0;

      for (let i = 0; i < items.length; i++) {
        bar.show(i / items.length, `正在转换第 ${i + 1}/${items.length} 张…`);
        const it = items[i];
        const data = await convert(it);
        outBytes += data.length;
        outputs.push({ name: `${baseName(it.name)}.${ext}`, data });
      }

      if (outputs.length === 1) {
        download(new Blob([outputs[0].data], { type: MIME[fmt] }), outputs[0].name);
        toast(`已导出 ${outputs[0].name}`, 'ok');
        bar.set(1, `完成：${outputs[0].name}（${fmtBytes(outBytes)}）`);
      } else {
        bar.set(0.9, '正在打包…');
        const zip = await makeZip(outputs);
        const name = `图片转换_${outputs.length}张.zip`;
        download(zip, name);
        toast(`已导出 ${name}`, 'ok');
        bar.set(1, `完成：${outputs.length} 张，合计 ${fmtBytes(outBytes)}`);
      }
    }

    return () => {
      for (const it of items) it.bitmap.close?.();
      items.length = 0;
    };
  },
};
