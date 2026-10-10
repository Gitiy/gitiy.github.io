import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  toast, fileZone, rangeInput, progress,
} from '../ui.js';
import { CODECS, codecById, decodeImage, encodeImage, resizeImageData, preloadCodecs, fitSize, sizeDelta } from '../lib/codecs.js';
import { download, fmtBytes, baseName, makeZip, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: '批量图片压缩',
      icon: '📦',
      desc: '一次拖入多张图片，用同一套参数压缩，完成后打包 zip 下载。会逐张报告压缩前后的体积。',
    });

    let items = [];   // { id, file, name, size, imageData, out, error }
    let running = false;
    let uid = 0;

    const listBox = el('div', { class: 'batch-list' });
    const bar = progress();
    const stat = note('拖入图片开始');

    const formatSel = select({
      label: '输出格式', value: 'mozjpeg',
      options: CODECS.map((c) => [c.id, `${c.label} —— ${c.desc}`]),
      onChange: syncControls,
    });
    const quality = rangeInput({ label: '质量', value: 75, min: 1, max: 100, format: (v) => v + '%' });
    const oxiLevel = rangeInput({ label: 'OxiPNG 等级', value: 3, min: 1, max: 6, format: (v) => 'Lv ' + v });
    const maxWidth = rangeInput({
      label: '最大宽度（0 = 不缩放）', value: 0, min: 0, max: 8000, step: 100,
      hint: '超过这个宽度的图片会等比缩小。批量处理时通常设 1920 或 1280 就够了。',
      format: (v) => (Number(v) ? v + ' px' : '不缩放'),
    });
    const skipSmaller = toggle({
      label: '压缩后反而更大时，保留原文件', value: true,
      hint: '已经压过的图再压一次常常会变大，打开这个可以避免。',
    });

    page.add(
      el('div', { class: 'card' },
        fileZone({
          title: '拖入多张图片，或点击选择',
          hint: '支持 PNG / JPG / WebP / BMP / GIF / AVIF',
          icon: '🗂️',
          accept: 'image/*',
          onFiles: (files) => addFiles(files),
        }).root,
      ),
      fieldset('压缩参数', formatSel, quality, oxiLevel, maxWidth, skipSmaller),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '文件列表' }), listBox, bar.root, stat),
    );
    page.setActions(
      button('开始压缩', run, { primary: true }),
      button('下载 zip', () => {
        const done = items.filter((i) => i.out);
        if (!done.length) { toast('还没有处理完成的图片', 'error'); return; }
        const entries = done.map((i) => ({ name: i.outName, data: i.out.bytes }));
        makeZip(entries).then((blob) => {
          download(blob, `压缩结果_${done.length}张_${stamp()}.zip`);
          toast(`已打包 ${done.length} 张`, 'ok');
        }).catch((e) => toast('打包失败：' + e.message, 'error'));
      }),
      button('清空', () => { items = []; render(); stat.textContent = '拖入图片开始'; stat.className = 'hint'; }),
    );
    app.main.append(page.root);

    preloadCodecs('mozjpeg');

    function syncControls() {
      const c = codecById(formatSel.get());
      quality.root.classList.toggle('hidden', !c.lossy);
      oxiLevel.root.classList.toggle('hidden', c.id !== 'oxipng');
    }

    async function addFiles(files) {
      for (const f of files) {
        if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(f.name)) {
          items.push({ id: ++uid, file: f, name: f.name, size: f.size, error: '不是图片格式' });
          continue;
        }
        const item = { id: ++uid, file: f, name: f.name, size: f.size };
        items.push(item);
        try {
          item.imageData = await decodeImage(f);
        } catch (err) {
          item.error = '解码失败：' + err.message;
        }
      }
      render();
      stat.textContent = `已加入 ${items.length} 张`;
      stat.className = 'hint';
    }

    function render() {
      listBox.replaceChildren();
      if (!items.length) {
        listBox.append(el('p', { class: 'hint', text: '还没有文件' }));
        return;
      }
      for (const it of items) {
        const d = it.out ? sizeDelta(it.size, it.out.bytes.length) : null;
        listBox.append(el('div', { class: 'batch-row' },
          el('span', { class: 'batch-name', text: it.name, title: it.name }),
          el('span', { class: 'batch-dim', text: it.imageData ? `${it.imageData.width}×${it.imageData.height}` : '—' }),
          el('span', { class: 'batch-size', text: fmtBytes(it.size) }),
          el('span', { class: 'batch-arrow', text: '→' }),
          el('span', {
            class: 'batch-size' + (d ? (d.better ? ' good' : ' warn') : ''),
            text: it.error ? '失败' : (it.out ? fmtBytes(it.out.bytes.length) : '待处理'),
          }),
          el('span', { class: 'batch-delta' + (d ? (d.better ? ' good' : ' warn') : ''), text: d ? d.text : (it.error || '') }),
          button('移除', () => { items = items.filter((x) => x.id !== it.id); render(); }, { small: true, danger: true }),
        ));
      }
    }

    async function run() {
      if (running) return;
      const todo = items.filter((i) => i.imageData && !i.error);
      if (!todo.length) { toast('没有可处理的图片', 'error'); return; }
      running = true;
      bar.show(0, '准备中…');

      const fmt = codecById(formatSel.get());
      const mw = Math.round(maxWidth.get()) || 0;
      let totalBefore = 0;
      let totalAfter = 0;

      try {
        for (let i = 0; i < todo.length; i++) {
          const it = todo[i];
          bar.set(i / todo.length, `正在处理 ${it.name}（${i + 1}/${todo.length}）`);
          try {
            let img = it.imageData;
            if (mw && img.width > mw) {
              const target = fitSize(img.width, img.height, { width: mw, height: Math.round((mw * img.height) / img.width) }, 'stretch');
              img = await resizeImageData(img, { width: target.width, height: target.height });
            }
            const enc = await encodeImage(img, {
              codec: fmt.id,
              quality: quality.get() / 100,
              level: Math.round(oxiLevel.get()),
            });

            let bytes = enc.bytes;
            let ext = enc.ext;
            let mime = enc.mime;
            if (skipSmaller.get() && bytes.length >= it.size) {
              // 压缩后更大，保留原文件
              bytes = new Uint8Array(await it.file.arrayBuffer());
              ext = (it.name.match(/\.([^.]+)$/)?.[1] || 'png').toLowerCase();
              mime = it.file.type || 'application/octet-stream';
              it.keptOriginal = true;
            } else {
              it.keptOriginal = false;
            }

            it.out = { bytes, mime };
            it.outName = `${baseName(it.name)}_压缩.${ext}`;
            totalBefore += it.size;
            totalAfter += bytes.length;
          } catch (err) {
            it.error = '处理失败：' + err.message;
          }
          render();
          // 让出主线程，界面不至于卡住
          await new Promise((r) => setTimeout(r, 0));
        }

        bar.set(1, '完成');
        const d = totalBefore ? sizeDelta(totalBefore, totalAfter) : null;
        const kept = items.filter((i) => i.keptOriginal).length;
        stat.textContent = `处理完成 ${todo.filter((i) => i.out).length} 张 · 合计 ${fmtBytes(totalBefore)} → ${fmtBytes(totalAfter)}`
          + (d ? `（${d.text}）` : '') + (kept ? ` · ${kept} 张因压缩后更大而保留原文件` : '');
        stat.className = 'hint ok';
      } finally {
        running = false;
        setTimeout(() => bar.hide(), 1200);
      }
    }

    syncControls();
    render();
    return () => { };
  },
};
