import {
  toolPage, fileZone, el, button, select, rangeInput, numberInput, toggle,
  note, toast, grid, fieldset, progress, previewPane,
} from '../ui.js';
import { loadPdfLib } from '../lib/scripts.js';
import { download, baseName, stamp } from '../lib/files.js';

const SIZES = {
  auto: null,
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  letter: [612, 792],
  b5: [498.9, 708.66],
};

export const tool = {
  init(app) {
    const items = [];   // { name, bitmap, width, height }
    let previewUrl = null;

    const page = toolPage({
      title: '图片转 PDF',
      icon: '🖼️',
      desc: '把多张图片合成一份 PDF。可设置页面尺寸、页边距与图片填充方式，支持调整顺序。',
    });

    const listHost = el('div', { class: 'filelist' });
    const dz = fileZone({
      accept: 'image/*,.png,.jpg,.jpeg,.webp,.bmp',
      multiple: true, icon: '🖼️',
      title: '拖入多张图片，或点击选择',
      hint: '支持 PNG / JPG / WebP / BMP',
      onFiles: addFiles,
    });

    const sizeSel = select({
      label: '页面尺寸', value: 'auto',
      options: [['auto', '跟随图片（每页一张图）'], ['a4', 'A4'], ['a3', 'A3'], ['letter', 'Letter'], ['b5', 'B5']],
    });
    const orientSel = select({
      label: '方向', value: 'auto',
      options: [['auto', '按图片自动'], ['portrait', '纵向'], ['landscape', '横向']],
    });
    const fitSel = select({
      label: '填充方式', value: 'contain',
      options: [['contain', '等比缩放，四周留白'], ['cover', '铺满页面，超出裁切'], ['stretch', '拉伸铺满']],
    });
    const marginRange = rangeInput({
      label: '页边距', value: 0, min: 0, max: 100, step: 2, format: (v) => v + ' pt',
    });
    const qualityRange = rangeInput({
      label: 'JPEG 质量', value: 88, min: 40, max: 100, step: 1, format: (v) => v + '%',
    });
    const jpegToggle = toggle({ label: '用 JPEG 压缩（体积小，照片更合适）', value: true });

    const bar = progress();
    const preview = previewPane('添加图片后这里会显示第一张');
    const btnGo = button('生成 PDF', run, { primary: true });
    btnGo.disabled = true;

    page.add(dz, listHost, fieldset('页面设置', grid(sizeSel, orientSel), grid(fitSel, marginRange), grid(qualityRange, jpegToggle)), bar.root, preview);
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
          el('span', { class: 'file-move' },
            button('↑', () => move(i, -1), { small: true, disabled: i === 0 }),
            button('↓', () => move(i, 1), { small: true, disabled: i === items.length - 1 }),
          ),
          button('移除', () => { items.splice(i, 1); render(); }, { small: true, danger: true }),
        ));
      });
      btnGo.disabled = items.length === 0;

      if (items.length) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const c = document.createElement('canvas');
        c.width = items[0].width; c.height = items[0].height;
        c.getContext('2d').drawImage(items[0].bitmap, 0, 0);
        c.toBlob((b) => {
          previewUrl = URL.createObjectURL(b);
          preview.set(el('img', { src: previewUrl, alt: '第一张图片' }),
            el('p', { class: 'hint', text: `共 ${items.length} 张图片` }));
        }, 'image/jpeg', 0.8);
      } else {
        preview.clear();
      }
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      render();
    }

    function clearAll() {
      for (const it of items) it.bitmap.close?.();
      items.length = 0;
      render();
    }

    function pageSizeFor(imgW, imgH) {
      const key = sizeSel.get();
      if (key === 'auto') return [imgW * 0.75, imgH * 0.75];
      let [w, h] = SIZES[key];
      const o = orientSel.get();
      const landscape = o === 'landscape' || (o === 'auto' && imgW > imgH);
      if (landscape !== w > h) [w, h] = [h, w];
      return [w, h];
    }

    async function run() {
      const PDFLib = await loadPdfLib();
      const out = await PDFLib.PDFDocument.create();
      const margin = marginRange.get();
      const useJpg = jpegToggle.get();
      const quality = qualityRange.get() / 100;
      const fit = fitSel.get();

      for (let i = 0; i < items.length; i++) {
        bar.show(i / items.length, `正在处理第 ${i + 1}/${items.length} 张…`);
        const it = items[i];
        const [pw, ph] = pageSizeFor(it.width, it.height);
        const availW = Math.max(1, pw - margin * 2);
        const availH = Math.max(1, ph - margin * 2);

        // 先按需要准备画布：铺满模式要在画布上先裁好，
        // 因为 pdf-lib 没有便捷的裁剪绘制 API（CropBox 只是可视区域，不裁内容）
        let drawW, drawH, sx, sy, sw, sh;
        if (fit === 'stretch') {
          drawW = availW; drawH = availH; sx = 0; sy = 0; sw = it.width; sh = it.height;
        } else if (fit === 'cover') {
          const targetAr = availW / availH;
          const srcAr = it.width / it.height;
          if (srcAr > targetAr) { sh = it.height; sw = sh * targetAr; }
          else { sw = it.width; sh = sw / targetAr; }
          sx = (it.width - sw) / 2; sy = (it.height - sh) / 2;
          drawW = availW; drawH = availH;
        } else {
          const s = Math.min(availW / it.width, availH / it.height);
          drawW = it.width * s; drawH = it.height * s;
          sx = 0; sy = 0; sw = it.width; sh = it.height;
        }

        // 输出画布尺寸：尽量保持原图分辨率，但不超过页面对应像素（按 300DPI 估算上限）
        const maxPx = Math.max(1, Math.round(drawW / 72 * 300));
        const scale = Math.min(1, maxPx / sw);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(it.bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((r) =>
          canvas.toBlob(r, useJpg ? 'image/jpeg' : 'image/png', useJpg ? quality : undefined));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const img = useJpg ? await out.embedJpg(bytes) : await out.embedPng(bytes);

        const pg = out.addPage([pw, ph]);
        pg.drawImage(img, { x: (pw - drawW) / 2, y: (ph - drawH) / 2, width: drawW, height: drawH });
      }

      out.setProducer('Tools · 图片转 PDF');
      out.setModificationDate(new Date());
      bar.set(0.95, '正在写出 PDF…');
      const bytes = await out.save({ updateMetadata: false });
      const name = `图片合集_${stamp()}.pdf`;
      download(new Blob([bytes], { type: 'application/pdf' }), name);
      bar.set(1, `完成：${items.length} 页 → ${name}`);
      toast(`已生成 ${name}`, 'ok');
    }

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      for (const it of items) it.bitmap.close?.();
      items.length = 0;
    };
  },
};
