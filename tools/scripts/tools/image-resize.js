import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  toast, fileZone, numberInput, rangeInput,
} from '../ui.js';
import { decodeImage, resizeImageData, imageDataToCanvas, canvasToBlob } from '../lib/codecs.js';
import { download, fmtBytes, baseName, stamp } from '../lib/files.js';

/** 预设比例，点一下就从中心裁成该比例 */
const RATIOS = [
  ['free', '自由'],
  ['1:1', '1 : 1'],
  ['4:3', '4 : 3'],
  ['3:2', '3 : 2'],
  ['16:9', '16 : 9'],
  ['9:16', '9 : 16（竖屏）'],
  ['2:3', '2 : 3'],
  ['3:4', '3 : 4'],
];

export const tool = {
  init(app) {
    const page = toolPage({
      title: '图片缩放与裁剪',
      icon: '✂️',
      desc: '按像素或百分比缩放（Lanczos3 重采样），或按比例从中心裁剪。裁剪框可以在预览上直接拖动。',
    });

    let source = null;
    let out = null;
    let timer = 0;

    const cmp = el('div', { class: 'resize-view' });
    const srcInfo = note('');
    const stat = note('拖入一张图片开始');

    const modeSel = select({
      label: '模式', value: 'resize',
      options: [['resize', '只缩放'], ['crop', '只裁剪'], ['both', '先裁剪再缩放']],
      onChange: () => { sync(); schedule(); },
    });

    /* ---- 缩放 ---- */
    const byPercent = toggle({ label: '按百分比缩放', value: false, onChange: () => { sync(); schedule(); } });
    const width = numberInput({ label: '宽', value: 0, min: 1, max: 20000, onChange: () => { onDim('w'); schedule(); } });
    const height = numberInput({ label: '高', value: 0, min: 1, max: 20000, onChange: () => { onDim('h'); schedule(); } });
    const percent = rangeInput({ label: '百分比', value: 50, min: 1, max: 400, format: (v) => v + '%', onChange: schedule });
    const lock = toggle({ label: '锁定宽高比', value: true, onChange: sync });
    const method = select({
      label: '重采样算法', value: 'lanczos3',
      options: [['lanczos3', 'Lanczos3（画质最好）'], ['canvas', '浏览器双线性（最快）']],
      onChange: schedule,
    });

    /* ---- 裁剪 ---- */
    const ratioSel = select({
      label: '裁剪比例', value: 'free',
      options: RATIOS.map(([v, l]) => [v, l]),
      onChange: () => { applyRatio(); schedule(); },
    });
    const cropX = numberInput({ label: '左边距', value: 0, min: 0, onChange: schedule });
    const cropY = numberInput({ label: '上边距', value: 0, min: 0, onChange: schedule });
    const cropW = numberInput({ label: '裁剪宽', value: 0, min: 1, onChange: schedule });
    const cropH = numberInput({ label: '裁剪高', value: 0, min: 1, onChange: schedule });

    const formatSel = select({
      label: '输出格式', value: 'png',
      options: [['png', 'PNG（无损）'], ['jpeg', 'JPEG'], ['webp', 'WebP']],
      onChange: schedule,
    });
    const quality = rangeInput({ label: '质量', value: 90, min: 1, max: 100, format: (v) => v + '%', onChange: schedule });

    const preview = el('div', { class: 'resize-preview' });
    const overlay = el('div', { class: 'crop-overlay hidden' });

    page.add(
      el('div', { class: 'card' },
        fileZone({
          title: '拖入图片，或点击选择',
          hint: '支持 PNG / JPG / WebP / BMP / GIF / AVIF',
          icon: '🖼️', multiple: false, accept: 'image/*',
          onFiles: ([f]) => load(f),
        }).root,
      ),
      el('div', { class: 'card hidden', id: 'workCard' },
        cmp,
        preview,
        srcInfo,
      ),
      el('div', { class: 'card hidden', id: 'optCard' },
        modeSel.root,
        fieldset('缩放', byPercent, percent, grid(width, height), lock, method),
        fieldset('裁剪', ratioSel, grid(cropX, cropY), grid(cropW, cropH)),
        fieldset('输出', formatSel, quality),
      ),
      el('div', { class: 'card' }, stat),
    );
    page.setActions(
      button('下载结果', () => {
        if (!out) { toast('还没有结果', 'error'); return; }
        const ext = formatSel.get() === 'jpeg' ? 'jpg' : formatSel.get();
        download(out.blob, `${baseName(source.name)}_处理.${ext}`);
        toast('已下载', 'ok');
      }, { primary: true }),
      button('恢复原始尺寸', () => {
        if (!source) return;
        cropX.set(0); cropY.set(0);
        cropW.set(source.imageData.width); cropH.set(source.imageData.height);
        width.set(source.imageData.width); height.set(source.imageData.height);
        percent.set(100);
        ratioSel.set('free');
        schedule();
      }),
    );
    app.main.append(page.root);

    const workCard = page.root.querySelector('#workCard');
    const optCard = page.root.querySelector('#optCard');

    preview.append(overlay);

    function sync() {
      const mode = modeSel.get();
      const doResize = mode === 'resize' || mode === 'both';
      const doCrop = mode === 'crop' || mode === 'both';

      byPercent.root.classList.toggle('hidden', !doResize);
      percent.root.classList.toggle('hidden', !doResize || !byPercent.get());
      width.root.classList.toggle('hidden', !doResize || byPercent.get());
      height.root.classList.toggle('hidden', !doResize || byPercent.get());
      lock.root.classList.toggle('hidden', !doResize || byPercent.get());
      method.root.classList.toggle('hidden', !doResize);

      for (const n of [ratioSel, cropX, cropY, cropW, cropH]) n.root.classList.toggle('hidden', !doCrop);
      overlay.classList.toggle('hidden', !doCrop);
      quality.root.classList.toggle('hidden', formatSel.get() === 'png');
    }

    function onDim(which) {
      if (!source || !lock.get()) return;
      const w = cropW.get() || source.imageData.width;
      const h = cropH.get() || source.imageData.height;
      if (which === 'w') height.set(Math.max(1, Math.round((width.get() * h) / w)));
      else width.set(Math.max(1, Math.round((height.get() * w) / h)));
    }

    function applyRatio() {
      if (!source) return;
      const r = ratioSel.get();
      if (r === 'free') return;
      const [a, b] = r.split(':').map(Number);
      const W = source.imageData.width;
      const H = source.imageData.height;
      let cw = W;
      let ch = Math.round((W * b) / a);
      if (ch > H) { ch = H; cw = Math.round((H * a) / b); }
      cropW.set(cw);
      cropH.set(ch);
      cropX.set(Math.round((W - cw) / 2));
      cropY.set(Math.round((H - ch) / 2));
    }

    async function load(file) {
      try {
        const imageData = await decodeImage(file);
        source = { name: file.name, size: file.size, imageData };
        out = null;
        workCard.classList.remove('hidden');
        optCard.classList.remove('hidden');

        const c = imageDataToCanvas(imageData);
        c.className = 'resize-canvas';
        preview.insertBefore(c, overlay);

        cropX.set(0); cropY.set(0);
        cropW.set(imageData.width); cropH.set(imageData.height);
        width.set(imageData.width); height.set(imageData.height);
        percent.set(100);
        ratioSel.set('free');

        srcInfo.textContent = `${file.name} · ${imageData.width}×${imageData.height} · ${fmtBytes(file.size)}`;
        srcInfo.className = 'hint';
        sync();
        updateOverlay();
        await render();
      } catch (err) {
        stat.textContent = '解码失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    function updateOverlay() {
      if (!source) return;
      const W = source.imageData.width;
      const H = source.imageData.height;
      overlay.style.left = (cropX.get() / W * 100) + '%';
      overlay.style.top = (cropY.get() / H * 100) + '%';
      overlay.style.width = (Math.min(cropW.get(), W - cropX.get()) / W * 100) + '%';
      overlay.style.height = (Math.min(cropH.get(), H - cropY.get()) / H * 100) + '%';
    }

    // 拖动裁剪框
    let dragging = false;
    let start = null;
    overlay.addEventListener('pointerdown', (e) => {
      dragging = true;
      start = { x: e.clientX, y: e.clientY, cx: cropX.get(), cy: cropY.get() };
      try { overlay.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
      e.preventDefault();
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!dragging || !source) return;
      const rect = preview.getBoundingClientRect();
      if (!rect.width) return;
      const kx = source.imageData.width / rect.width;
      const ky = source.imageData.height / rect.height;
      const nx = Math.max(0, Math.min(source.imageData.width - cropW.get(), start.cx + (e.clientX - start.x) * kx));
      const ny = Math.max(0, Math.min(source.imageData.height - cropH.get(), start.cy + (e.clientY - start.y) * ky));
      cropX.set(Math.round(nx));
      cropY.set(Math.round(ny));
      updateOverlay();
    });
    const stopDrag = () => { if (dragging) { dragging = false; schedule(); } };
    overlay.addEventListener('pointerup', stopDrag);
    overlay.addEventListener('pointercancel', stopDrag);

    function schedule() {
      updateOverlay();
      clearTimeout(timer);
      timer = setTimeout(() => render().catch((e) => console.error(e)), 180);
    }

    async function render() {
      if (!source) return;
      try {
        let img = source.imageData;
        const mode = modeSel.get();

        if (mode === 'crop' || mode === 'both') {
          const W = img.width;
          const H = img.height;
          const cx = Math.max(0, Math.min(W - 1, Math.round(cropX.get())));
          const cy = Math.max(0, Math.min(H - 1, Math.round(cropY.get())));
          const cw = Math.max(1, Math.min(W - cx, Math.round(cropW.get())));
          const ch = Math.max(1, Math.min(H - cy, Math.round(cropH.get())));
          const c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          const ctx = c.getContext('2d');
          ctx.drawImage(imageDataToCanvas(img), cx, cy, cw, ch, 0, 0, cw, ch);
          img = ctx.getImageData(0, 0, cw, ch, { colorSpace: 'srgb' });
        }

        if (mode === 'resize' || mode === 'both') {
          let tw;
          let th;
          if (byPercent.get()) {
            tw = Math.max(1, Math.round((img.width * percent.get()) / 100));
            th = Math.max(1, Math.round((img.height * percent.get()) / 100));
          } else {
            tw = Math.max(1, Math.round(width.get() || img.width));
            th = Math.max(1, Math.round(height.get() || img.height));
          }
          img = await resizeImageData(img, { width: tw, height: th, method: method.get() });
        }

        const fmt = formatSel.get();
        const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
        const q = fmt === 'png' ? undefined : quality.get() / 100;
        const blob = await canvasToBlob(imageDataToCanvas(img), mime, q);
        out = { blob, width: img.width, height: img.height };

        cmp.replaceChildren(el('div', { class: 'cmp-metric' },
          el('span', { class: 'cmp-metric-label', text: '输出尺寸' }),
          el('strong', { text: `${img.width}×${img.height}` }),
          el('span', { class: 'hint', text: `原始 ${source.imageData.width}×${source.imageData.height}` }),
        ), el('div', { class: 'cmp-metric' },
          el('span', { class: 'cmp-metric-label', text: '输出体积' }),
          el('strong', { text: fmtBytes(blob.size) }),
          el('span', { class: 'hint', text: `原始 ${fmtBytes(source.size)}` }),
        ));

        stat.textContent = `已生成 ${img.width}×${img.height} 的 ${fmt.toUpperCase()}，${fmtBytes(blob.size)}`;
        stat.className = 'hint ok';
      } catch (err) {
        stat.textContent = '处理失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    sync();
    return () => { clearTimeout(timer); };
  },
};
