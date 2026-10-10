import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  toast, fileZone, rangeInput, numberInput, textInput, copyWithFeedback,
} from '../ui.js';
import {
  CODECS, codecById, decodeImage, encodeImage, resizeImageData, preloadCodecs,
  imageDataToCanvas, fitSize, sizeDelta,
} from '../lib/codecs.js';
import { download, fmtBytes, baseName } from '../lib/files.js';

/** 拖动分割线对比原图与压缩结果 —— squoosh 的核心交互 */
function makeCompare() {
  const wrap = el('div', { class: 'cmp' });
  const before = el('div', { class: 'cmp-side cmp-before' });
  const after = el('div', { class: 'cmp-side cmp-after' });
  const divider = el('div', { class: 'cmp-divider' }, el('span', { class: 'cmp-handle', text: '⇔' }));
  wrap.append(before, after, divider);

  let ratio = 0.5;
  const apply = () => {
    after.style.clipPath = `inset(0 0 0 ${(ratio * 100).toFixed(2)}%)`;
    divider.style.left = (ratio * 100).toFixed(2) + '%';
  };

  const setFromEvent = (e) => {
    const r = wrap.getBoundingClientRect();
    if (!r.width) return;
    ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    apply();
  };

  let dragging = false;
  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { divider.setPointerCapture(e.pointerId); } catch { /* 合成事件没有真实 pointerId */ }
    e.preventDefault();
  });
  divider.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
  divider.addEventListener('pointerup', () => { dragging = false; });
  divider.addEventListener('pointercancel', () => { dragging = false; });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) { setFromEvent(e); } });

  apply();
  return { root: wrap, before, after, setRatio: (v) => { ratio = v; apply(); } };
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: '图片压缩',
      icon: '🗜️',
      desc: '用 MozJPEG / AVIF / OxiPNG 这些真正的编解码器压缩图片，实时对比画质与体积。全部在本机完成，图片不会上传。',
    });

    let source = null;      // { name, size, imageData }
    let result = null;      // { bytes, mime, ext, blob, width, height }
    let busy = false;
    let timer = 0;

    const empty = el('div', { class: 'card' },
      fileZone({
        title: '拖入图片，或点击选择',
        hint: '支持 PNG / JPG / WebP / BMP / GIF / AVIF，单张处理',
        icon: '🖼️',
        multiple: false,
        accept: 'image/*',
        onFiles: ([f]) => load(f),
      }).root,
    );

    const cmp = makeCompare();
    const infoBar = el('div', { class: 'cmp-info' });
    const work = el('div', { class: 'card hidden' }, cmp.root, infoBar);
    const stat = note('');

    const formatSel = select({
      label: '输出格式', value: 'mozjpeg',
      options: CODECS.map((c) => [c.id, `${c.label} —— ${c.desc}`]),
      onChange: () => { syncControls(); schedule(); },
    });

    const quality = rangeInput({
      label: '质量', value: 75, min: 1, max: 100,
      format: (v) => v + '%',
      onChange: schedule,
    });

    const oxiLevel = rangeInput({
      label: 'OxiPNG 优化等级', value: 3, min: 1, max: 6,
      hint: '等级越高压得越小但越慢。3 是速度与体积的平衡点。',
      format: (v) => 'Lv ' + v,
      onChange: schedule,
    });

    const avifSpeed = rangeInput({
      label: 'AVIF 编码速度', value: 6, min: 0, max: 10,
      hint: '数字越大越快、体积略大。0 最慢但最小。',
      format: (v) => String(v),
      onChange: schedule,
    });

    const resizeOn = toggle({ label: '缩放尺寸', value: false, onChange: () => { syncControls(); schedule(); } });
    const width = numberInput({ label: '宽', value: 0, min: 1, max: 20000, onChange: () => { onSizeInput('w'); schedule(); } });
    const height = numberInput({ label: '高', value: 0, min: 1, max: 20000, onChange: () => { onSizeInput('h'); schedule(); } });
    const lockRatio = toggle({ label: '锁定宽高比', value: true, onChange: () => { syncControls(); } });
    const methodSel = select({
      label: '缩放算法', value: 'lanczos3',
      options: [['lanczos3', 'Lanczos3（WASM，画质最好）'], ['canvas', '浏览器双线性（最快）']],
      onChange: schedule,
    });

    const outName = textInput({ label: '输出文件名', value: '', placeholder: '留空则用原名加后缀' , onChange: () => {} });

    page.add(empty, work,
      el('div', { class: 'card hidden', id: 'ctrlCard' },
        fieldset('格式与质量', formatSel, quality, oxiLevel, avifSpeed),
        fieldset('尺寸', resizeOn, grid(width, height, lockRatio), methodSel),
        fieldset('输出', outName),
      ),
      el('div', { class: 'card' }, stat),
    );
    page.setActions(
      button('下载压缩结果', () => {
        if (!result) { toast('还没有可下载的结果', 'error'); return; }
        const base = baseName(source.name);
        const name = (outName.get().trim() || `${base}_压缩`) + '.' + result.ext;
        download(result.blob, name);
        toast(`已下载 ${fmtBytes(result.bytes.length)}`, 'ok');
      }, { primary: true }),
      button('换一张', () => { fileInput.click(); }),
      button('原始尺寸', () => {
        if (!source) return;
        resizeOn.set(true);
        width.set(source.imageData.width);
        height.set(source.imageData.height);
        schedule();
      }),
      button('质量-体积曲线', () => { if (source) showCurve(); }),
    );
    app.main.append(page.root);

    const ctrlCard = page.root.querySelector('#ctrlCard');
    const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    page.root.append(fileInput);
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) load(f);
    });

    // 预热：默认格式的编解码器 + 缩放器提前拉下来
    preloadCodecs('mozjpeg', 'resize');

    function syncControls() {
      const c = codecById(formatSel.get());
      quality.root.classList.toggle('hidden', !c.lossy);
      oxiLevel.root.classList.toggle('hidden', c.id !== 'oxipng');
      avifSpeed.root.classList.toggle('hidden', c.id !== 'avif');
      const on = resizeOn.get();
      width.root.classList.toggle('hidden', !on);
      height.root.classList.toggle('hidden', !on);
      lockRatio.root.classList.toggle('hidden', !on);
      methodSel.root.classList.toggle('hidden', !on);
      const needsAvif = c.id === 'avif';
      stat.textContent = needsAvif
        ? 'AVIF 编码器有 3.4 MB，第一次使用需要下载一次，之后会缓存。'
        : '';
      stat.className = 'hint';
    }

    function onSizeInput(which) {
      if (!source || !lockRatio.get()) return;
      const w = source.imageData.width;
      const h = source.imageData.height;
      if (which === 'w') {
        const nw = Math.max(1, Math.round(width.get() || w));
        height.set(Math.max(1, Math.round((nw * h) / w)));
      } else {
        const nh = Math.max(1, Math.round(height.get() || h));
        width.set(Math.max(1, Math.round((nh * w) / h)));
      }
    }

    async function load(file) {
      try {
        stat.textContent = '正在解码图片…';
        stat.className = 'hint';
        const imageData = await decodeImage(file);
        source = { name: file.name, size: file.size, imageData, file };
        result = null;

        empty.classList.add('hidden');
        work.classList.remove('hidden');
        ctrlCard.classList.remove('hidden');

        cmp.before.replaceChildren(canvasOf(imageData));
        cmp.after.replaceChildren(canvasOf(imageData));
        outName.set(baseName(file.name) + '_压缩');

        width.set(imageData.width);
        height.set(imageData.height);

        // 大图默认开启缩放建议
        if (imageData.width * imageData.height > 4e6) {
          resizeOn.set(true);
          width.set(Math.round(imageData.width / 2));
          height.set(Math.round(imageData.height / 2));
        }

        syncControls();
        await render();
      } catch (err) {
        stat.textContent = '图片解码失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    function canvasOf(imageData) {
      const c = imageDataToCanvas(imageData);
      c.className = 'cmp-canvas';
      return c;
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { render().catch((e) => console.error(e)); }, 160);
    }

    async function render() {
      if (!source || busy) return;
      busy = true;
      const t0 = performance.now();
      try {
        const fmt = codecById(formatSel.get());
        if (fmt.heavy) stat.textContent = '正在加载 AVIF 编码器（首次约 3.4 MB）…';

        let img = source.imageData;
        if (resizeOn.get()) {
          const target = fitSize(img.width, img.height, {
            width: width.get() || img.width,
            height: height.get() || img.height,
          }, 'stretch');
          img = await resizeImageData(img, {
            width: target.width,
            height: target.height,
            method: methodSel.get(),
          });
        }

        const enc = await encodeImage(img, {
          codec: formatSel.get(),
          quality: quality.get() / 100,
          level: Math.round(oxiLevel.get()),
          speed: Math.round(avifSpeed.get()),
        });

        result = {
          bytes: enc.bytes,
          mime: enc.mime,
          ext: enc.ext,
          blob: new Blob([enc.bytes], { type: enc.mime }),
          width: img.width,
          height: img.height,
          ms: performance.now() - t0,
        };

        // 结果预览：用 blob URL 而不是 canvas，避免大图再占一份内存
        const url = URL.createObjectURL(result.blob);
        const im = el('img', { class: 'cmp-canvas', src: url, alt: '压缩结果' });
        im.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
        cmp.after.replaceChildren(im);

        renderInfo();
      } catch (err) {
        console.error(err);
        stat.textContent = '压缩失败：' + err.message;
        stat.className = 'hint error';
      } finally {
        busy = false;
      }
    }

    function renderInfo() {
      if (!result) return;
      const d = sizeDelta(source.size, result.bytes.length);
      const fmt = codecById(formatSel.get());
      infoBar.replaceChildren(
        el('div', { class: 'cmp-metric' },
          el('span', { class: 'cmp-metric-label', text: '原始' }),
          el('strong', { text: fmtBytes(source.size) }),
          el('span', { class: 'hint', text: `${source.imageData.width}×${source.imageData.height}` }),
        ),
        el('div', { class: 'cmp-metric' },
          el('span', { class: 'cmp-metric-label', text: '压缩后' }),
          el('strong', { class: d.better ? 'good' : 'warn', text: fmtBytes(result.bytes.length) }),
          el('span', { class: 'hint', text: `${result.width}×${result.height}` }),
        ),
        el('div', { class: 'cmp-metric' },
          el('span', { class: 'cmp-metric-label', text: '变化' }),
          el('strong', { class: d.better ? 'good' : 'warn', text: d.text }),
          el('span', { class: 'hint', text: `${fmt.label} · ${result.ms.toFixed(0)} ms` }),
        ),
      );
      stat.textContent = `已生成 ${fmt.label} 结果 · ${fmtBytes(result.bytes.length)}`;
      stat.className = 'hint ok';
    }

    /** 扫一遍质量档位，让用户看着曲线挑 —— 比盲调滑块直观得多 */
    async function showCurve() {
      const fmt = codecById(formatSel.get());
      if (!fmt.lossy) { toast('无损格式没有质量可调，试试切换成有损格式', 'error'); return; }
      stat.textContent = '正在计算质量-体积曲线…';
      stat.className = 'hint';

      let img = source.imageData;
      if (resizeOn.get()) {
        img = await resizeImageData(img, {
          width: width.get() || img.width,
          height: height.get() || img.height,
          method: methodSel.get(),
        });
      }

      const rows = [];
      for (const q of [20, 30, 40, 50, 60, 70, 80, 90, 100]) {
        try {
          const enc = await encodeImage(img, { codec: fmt.id, quality: q / 100, speed: Math.round(avifSpeed.get()) });
          rows.push({ q, size: enc.bytes.length });
        } catch { /* 跳过失败的档位 */ }
      }
      if (!rows.length) { toast('曲线计算失败', 'error'); return; }

      const max = Math.max(...rows.map((r) => r.size));
      const list = el('div', { class: 'curve' });
      for (const r of rows) {
        const d = sizeDelta(source.size, r.size);
        list.append(el('div', { class: 'curve-row' },
          el('span', { class: 'curve-q', text: 'Q' + r.q }),
          el('span', { class: 'curve-bar' }, el('i', { style: { width: (r.size / max * 100).toFixed(1) + '%' } })),
          el('span', { class: 'curve-size', text: fmtBytes(r.size) }),
          el('span', { class: 'curve-delta' + (d.better ? ' good' : ' warn'), text: d.text }),
          button('用这个', () => { quality.set(r.q); schedule(); toast('已切到 Q' + r.q, 'ok'); }, { small: true }),
        ));
      }

      page.result.replaceChildren(el('div', { class: 'card' },
        el('p', { class: 'field-hint', text: `质量-体积曲线（${fmt.label}）—— 点「用这个」套用该档位` }),
        list,
      ));
      stat.textContent = '曲线已生成';
      stat.className = 'hint ok';
    }

    syncControls();
    stat.textContent = '拖入一张图片开始';
    return () => { clearTimeout(timer); };
  },
};
