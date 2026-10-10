import {
  toolPage, el, button, note, grid, fieldset, toggle,
  toast, fileZone, copyWithFeedback, numberInput,
} from '../ui.js';
import { decodeImage, imageDataToCanvas } from '../lib/codecs.js';

const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const toHsl = (r, g, b) => {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
    else if (max === G) h = ((B - R) / d + 2) / 6;
    else h = ((R - G) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

/**
 * 中位切分法取主色。
 * 比「按出现次数投票」好：投票会被大片背景色垄断，
 * 中位切分按颜色空间划分，能同时抓到背景和点缀色。
 */
function medianCut(pixels, count) {
  let boxes = [pixels];
  while (boxes.length < count) {
    // 挑出颜色跨度最大的盒子来切
    let bestIdx = -1;
    let bestRange = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const chans = [0, 1, 2].map((c) => {
        let min = 255, max = 0;
        for (const p of box) { const v = p[c]; if (v < min) min = v; if (v > max) max = v; }
        return max - min;
      });
      const range = Math.max(...chans);
      if (range > bestRange) { bestRange = range; bestIdx = i; }
    });
    if (bestIdx < 0 || bestRange <= 0) break;

    const box = boxes[bestIdx];
    const chans = [0, 1, 2].map((c) => {
      let min = 255, max = 0;
      for (const p of box) { const v = p[c]; if (v < min) min = v; if (v > max) max = v; }
      return max - min;
    });
    const ch = chans.indexOf(Math.max(...chans));
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(box.length / 2);
    boxes.splice(bestIdx, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.filter((b) => b.length).map((box) => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    const n = box.length;
    return {
      r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n),
      share: n / pixels.length,
    };
  }).sort((a, b) => b.share - a.share);
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: '图片取色器',
      icon: '🎨',
      desc: '在图片上点一下取任意位置的精确颜色，或自动提取主色板（中位切分法）。给出 HEX / RGB / HSL 三种写法。',
    });

    let source = null;
    let imageData = null;

    const canvas = el('canvas', { class: 'pick-canvas', title: '点击取色' });
    const picked = el('div', { class: 'picked-box' });
    const palette = el('div', { class: 'palette' });
    const stat = note('拖入一张图片开始');

    const colorCount = numberInput({ label: '主色数量', value: 8, min: 2, max: 24, onChange: () => extract() });
    const skipWhite = toggle({
      label: '忽略接近白色/透明的像素', value: true,
      hint: '截图的背景常常是大片纯白，忽略它才能看出真正的主色。',
      onChange: () => extract(),
    });

    page.add(
      el('div', { class: 'card' },
        fileZone({
          title: '拖入图片，或点击选择',
          hint: '支持 PNG / JPG / WebP / BMP / GIF / AVIF',
          icon: '🖼️', multiple: false, accept: 'image/*',
          onFiles: ([f]) => load(f),
        }).root,
      ),
      el('div', { class: 'card hidden', id: 'pickCard' },
        el('p', { class: 'field-hint', text: '点击图片任意位置取色（带十字准线）' }),
        canvas,
      ),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '取到的颜色' }), picked),
      el('div', { class: 'card' }, fieldset('主色板', grid(colorCount, skipWhite), palette), stat),
    );
    page.setActions(
      button('复制主色板', () => {
        const hexes = [...palette.querySelectorAll('.swatch')].map((s) => s.dataset.hex);
        if (!hexes.length) { toast('还没有提取主色', 'error'); return; }
        return copyWithFeedback(hexes.join('\n'), `已复制 ${hexes.length} 个颜色`);
      }, { primary: true }),
    );
    app.main.append(page.root);

    const pickCard = page.root.querySelector('#pickCard');
    let ctx = null;

    async function load(file) {
      try {
        imageData = await decodeImage(file);
        source = file;
        pickCard.classList.remove('hidden');

        // 显示用的画布限制在 900px 以内，取色坐标再换算回原图
        const maxW = 900;
        const k = Math.min(1, maxW / imageData.width);
        canvas.width = Math.round(imageData.width * k);
        canvas.height = Math.round(imageData.height * k);
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(imageDataToCanvas(imageData), 0, 0, canvas.width, canvas.height);

        picked.replaceChildren(el('p', { class: 'hint', text: '还没取色，点一下图片' }));
        extract();
        stat.textContent = `${file.name} · ${imageData.width}×${imageData.height}`;
        stat.className = 'hint';
      } catch (err) {
        stat.textContent = '解码失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    canvas.addEventListener('click', (e) => {
      if (!imageData || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const cx = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
      const cy = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
      const sx = Math.round((cx / canvas.width) * imageData.width);
      const sy = Math.round((cy / canvas.height) * imageData.height);
      if (sx < 0 || sy < 0 || sx >= imageData.width || sy >= imageData.height) return;

      const idx = (sy * imageData.width + sx) * 4;
      const d = imageData.data;
      const r = d[idx], g = d[idx + 1], b = d[idx + 2], a = d[idx + 3];
      showPicked({ r, g, b, a, x: sx, y: sy });
      markPoint(cx, cy);
    });

    let markerTimer = 0;
    function markPoint(x, y) {
      // 在原图预览上画一个临时的取色十字
      if (!source) return;
      clearTimeout(markerTimer);
      const restore = () => {
        ctx.drawImage(imageDataToCanvas(imageData), 0, 0, canvas.width, canvas.height);
      };
      restore();
      ctx.save();
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y);
      ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16);
      ctx.stroke();
      ctx.restore();
      markerTimer = setTimeout(restore, 1500);
    }

    function showPicked({ r, g, b, a, x, y }) {
      const hex = toHex(r, g, b);
      const hsl = toHsl(r, g, b);
      picked.replaceChildren(
        el('div', { class: 'picked-row' },
          el('span', { class: 'picked-chip', style: { background: hex } }),
          el('div', { class: 'picked-lines' },
            line('HEX', hex, `rgb(${r}, ${g}, ${b})`),
            line('RGB', `${r}, ${g}, ${b}`, `rgb(${r}, ${g}, ${b})`),
            line('HSL', `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`, `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`),
            line('坐标', `${x}, ${y}`, `alpha ${(a / 255).toFixed(2)}`),
          ),
        ),
      );
    }

    function line(label, value, copy) {
      return el('div', { class: 'picked-line' },
        el('span', { class: 'picked-key', text: label }),
        el('code', { class: 'picked-val', text: value }),
        button('复制', () => copyWithFeedback(copy, '已复制 ' + label), { small: true }),
      );
    }

    function extract() {
      if (!imageData) return;
      const d = imageData.data;
      const step = Math.max(1, Math.floor(Math.sqrt((imageData.width * imageData.height) / 40000)));
      const pixels = [];
      for (let y = 0; y < imageData.height; y += step) {
        for (let x = 0; x < imageData.width; x += step) {
          const i = (y * imageData.width + x) * 4;
          if (d[i + 3] < 32) continue;
          if (skipWhite.get() && d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) continue;
          pixels.push([d[i], d[i + 1], d[i + 2]]);
        }
      }
      if (!pixels.length) {
        palette.replaceChildren(el('p', { class: 'hint', text: '没有可分析的像素（整张图都是纯白或透明？试试关掉忽略选项）' }));
        return;
      }

      const colors = medianCut(pixels, Math.max(2, Math.min(24, Math.round(colorCount.get() || 8))));
      palette.replaceChildren();
      for (const c of colors) {
        const hex = toHex(c.r, c.g, c.b);
        const hsl = toHsl(c.r, c.g, c.b);
        palette.append(el('div', {
          class: 'swatch', dataset: { hex }, title: `${hex} 占 ${(c.share * 100).toFixed(1)}%`,
        },
          el('span', { class: 'swatch-color', style: { background: hex } }),
          el('code', { class: 'swatch-hex', text: hex }),
          el('span', { class: 'swatch-share', text: (c.share * 100).toFixed(1) + '%' }),
          button('复制', () => copyWithFeedback(hex, '已复制 ' + hex), { small: true }),
          el('span', { class: 'swatch-hsl', text: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` }),
        ));
      }
      stat.textContent = `从 ${pixels.length} 个采样点里提取出 ${colors.length} 个主色`;
      stat.className = 'hint ok';
    }

    return () => { clearTimeout(markerTimer); };
  },
};
