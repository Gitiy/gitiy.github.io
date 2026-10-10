import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  toast, fileZone, rangeInput, textInput, colorInput, numberInput,
} from '../ui.js';
import { decodeImage, imageDataToCanvas, canvasToBlob } from '../lib/codecs.js';
import { download, fmtBytes, baseName } from '../lib/files.js';

const POSITIONS = [
  ['tl', '左上'], ['tc', '上中'], ['tr', '右上'],
  ['ml', '左中'], ['mc', '居中'], ['mr', '右中'],
  ['bl', '左下'], ['bc', '下中'], ['br', '右下'],
];

export const tool = {
  init(app) {
    const page = toolPage({
      title: '图片加水印',
      icon: '💧',
      desc: '给图片加文字或图片水印，位置、大小、旋转、透明度、平铺都可调，实时预览。',
    });

    let source = null;
    let markImage = null;    // 图片水印的 ImageBitmap
    let out = null;
    let timer = 0;

    const canvas = el('canvas', { class: 'wm-canvas' });
    const stat = note('拖入一张图片开始');

    const kindSel = select({
      label: '水印类型', value: 'text',
      options: [['text', '文字'], ['image', '图片']],
      onChange: () => { sync(); schedule(); },
    });
    const text = textInput({ label: '水印文字', value: '仅供内部使用', onChange: schedule });
    const color = colorInput({ label: '文字颜色', value: '#e11d48', onChange: schedule });
    const fontSize = rangeInput({
      label: '字号', value: 4, min: 1, max: 30, format: (v) => v + '% 图宽',
      hint: '按图片宽度的百分比计算，所以不同尺寸的图看起来比例一致。',
      onChange: schedule,
    });
    const posSel = select({
      label: '位置', value: 'br',
      options: POSITIONS.map(([v, l]) => [v, l]),
      onChange: schedule,
    });
    const margin = rangeInput({ label: '边距', value: 3, min: 0, max: 20, format: (v) => v + '%', onChange: schedule });
    const opacity = rangeInput({ label: '透明度', value: 45, min: 1, max: 100, format: (v) => v + '%', onChange: schedule });
    const rotate = rangeInput({ label: '旋转角度', value: 0, min: -90, max: 90, format: (v) => v + '°', onChange: schedule });
    const tile = toggle({ label: '平铺整张图', value: false, onChange: () => { sync(); schedule(); } });
    const tileGap = rangeInput({ label: '平铺间距', value: 25, min: 5, max: 100, format: (v) => v + '%', onChange: schedule });
    const markScale = rangeInput({ label: '图片水印大小', value: 20, min: 2, max: 80, format: (v) => v + '% 图宽', onChange: schedule });

    page.add(
      el('div', { class: 'card' },
        fileZone({
          title: '拖入要加水印的图片',
          hint: '支持 PNG / JPG / WebP / BMP / GIF / AVIF',
          icon: '🖼️', multiple: false, accept: 'image/*',
          onFiles: ([f]) => load(f),
        }).root,
      ),
      el('div', { class: 'card hidden', id: 'wmCard' }, canvas),
      el('div', { class: 'card hidden', id: 'wmOpt' },
        fieldset('水印内容', kindSel, text, color, fontSize),
        fieldset('位置与样式', posSel, margin, opacity, rotate, tile, tileGap),
        fieldset('图片水印', markScale,
          el('div', { class: 'row' }, button('选择水印图片', () => markInput.click(), { small: true })),
        ),
      ),
      el('div', { class: 'card' }, stat),
    );
    page.setActions(
      button('下载结果', () => {
        if (!out) { toast('还没有结果', 'error'); return; }
        download(out.blob, `${baseName(source.name)}_水印.png`);
        toast('已下载 PNG', 'ok');
      }, { primary: true }),
    );
    app.main.append(page.root);

    const wmCard = page.root.querySelector('#wmCard');
    const wmOpt = page.root.querySelector('#wmOpt');
    const markInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    page.root.append(markInput);
    markInput.addEventListener('change', async () => {
      const f = markInput.files?.[0];
      markInput.value = '';
      if (!f) return;
      markImage = await createImageBitmap(f);
      kindSel.set('image');
      sync();
      schedule();
    });

    function sync() {
      const isText = kindSel.get() === 'text';
      text.root.classList.toggle('hidden', !isText);
      color.root.classList.toggle('hidden', !isText);
      fontSize.root.classList.toggle('hidden', !isText);
      markScale.root.classList.toggle('hidden', isText);
      tileGap.root.classList.toggle('hidden', !tile.get());
      posSel.root.classList.toggle('hidden', tile.get());
      margin.root.classList.toggle('hidden', tile.get());
    }

    async function load(file) {
      try {
        source = { name: file.name, size: file.size, imageData: await decodeImage(file) };
        wmCard.classList.remove('hidden');
        wmOpt.classList.remove('hidden');
        canvas.width = source.imageData.width;
        canvas.height = source.imageData.height;
        schedule();
      } catch (err) {
        stat.textContent = '解码失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => draw().catch((e) => console.error(e)), 120);
    }

    async function draw() {
      if (!source) return;
      const img = source.imageData;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.putImageData(img, 0, 0);

      const isText = kindSel.get() === 'text';
      const op = opacity.get() / 100;
      const rad = (rotate.get() * Math.PI) / 180;

      ctx.save();
      ctx.globalAlpha = op;

      if (tile.get()) {
        drawTiled(ctx, img, isText, rad);
      } else {
        drawSingle(ctx, img, isText, rad);
      }
      ctx.restore();

      const blob = await canvasToBlob(canvas, 'image/png');
      out = { blob };
      stat.textContent = `预览已更新 · 输出 PNG ${fmtBytes(blob.size)}（${img.width}×${img.height}）`;
      stat.className = 'hint ok';
    }

    /** 算出水印块的尺寸 */
    function markSize(img, isText) {
      if (isText) {
        const fontPx = Math.max(6, (fontSize.get() / 100) * img.width);
        return { w: 0, h: 0, fontPx };
      }
      if (!markImage) return null;
      const w = (markScale.get() / 100) * img.width;
      const h = (w * markImage.height) / markImage.width;
      return { w, h };
    }

    function drawSingle(ctx, img, isText, rad) {
      const m = markSize(img, isText);
      if (!m) return;
      const pad = (margin.get() / 100) * img.width;
      const [v, h] = posSel.get().split('');

      ctx.translate(img.width / 2, img.height / 2);
      ctx.rotate(rad);
      ctx.translate(-img.width / 2, -img.height / 2);

      if (isText) {
        const label = text.get() || '';
        if (!label) return;
        ctx.font = `bold ${m.fontPx}px "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = color.get();
        ctx.textBaseline = 'middle';
        const th = m.fontPx * 1.2;

        let x;
        let y;
        if (h === 'l') { ctx.textAlign = 'left'; x = pad; }
        else if (h === 'r') { ctx.textAlign = 'right'; x = img.width - pad; }
        else { ctx.textAlign = 'center'; x = img.width / 2; }
        if (v === 't') y = pad + th / 2;
        else if (v === 'b') y = img.height - pad - th / 2;
        else y = img.height / 2;

        ctx.fillText(label, x, y);
      } else {
        let x;
        let y;
        if (h === 'l') x = pad;
        else if (h === 'r') x = img.width - pad - m.w;
        else x = (img.width - m.w) / 2;
        if (v === 't') y = pad;
        else if (v === 'b') y = img.height - pad - m.h;
        else y = (img.height - m.h) / 2;
        ctx.drawImage(markImage, x, y, m.w, m.h);
      }
    }

    function drawTiled(ctx, img, isText, rad) {
      const m = markSize(img, isText);
      if (!m) return;
      const gap = (tileGap.get() / 100) * img.width;

      ctx.translate(img.width / 2, img.height / 2);
      ctx.rotate(rad);
      ctx.translate(-img.width / 2, -img.height / 2);

      const stepX = (isText ? Math.max(120, (text.get() || '').length * m.fontPx * 0.7) : m.w) + gap;
      const stepY = (isText ? m.fontPx * 1.6 : m.h) + gap;

      for (let y = -stepY; y < img.height + stepY; y += stepY) {
        for (let x = -stepX; x < img.width + stepX; x += stepX) {
          if (isText) {
            ctx.font = `bold ${m.fontPx}px "PingFang SC", "Microsoft YaHei", sans-serif`;
            ctx.fillStyle = color.get();
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';
            ctx.fillText(text.get() || '', x, y);
          } else {
            ctx.drawImage(markImage, x, y, m.w, m.h);
          }
        }
      }
    }

    sync();
    return () => { clearTimeout(timer); };
  },
};
