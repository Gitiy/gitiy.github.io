import {
  toolPage, el, button, note, grid, fieldset, toggle,
  copyWithFeedback, toast, fileZone, numberInput,
} from '../ui.js';
import { optimizeSvg, OPTIONS } from '../lib/svg.js';
import { download, fmtBytes, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'SVG 压缩优化',
      icon: '🪶',
      desc: '压缩 SVG：去掉编辑器残留的元数据与注释、收敛坐标小数位、清理没人引用的 id 和 defs。画面完全不变。',
    });

    const input = el('textarea', { class: 'input mono', rows: 12, placeholder: '把 SVG 源码粘贴到这里，或拖入 .svg 文件…', 'aria-label': 'SVG 输入' });
    const output = el('textarea', { class: 'input mono', rows: 12, readonly: true, 'aria-label': '压缩结果' });
    const stat = note('等待输入');
    const statsBox = el('div', { class: 'kv-list' });

    const precision = numberInput({
      label: '小数保留位数', value: 3, min: 0, max: 8,
      hint: '坐标里的小数位数。3 位对屏幕显示已经足够，降到 1 位还能再省一些。',
      onChange: run,
    });

    const optBox = el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '.5rem .9rem' } });
    const optState = {};
    for (const o of OPTIONS) {
      optState[o.id] = o.default;
      const t = toggle({
        label: o.label, value: o.default, hint: o.desc,
        onChange: (v) => { optState[o.id] = v; run(); },
      });
      optBox.append(t.root);
    }

    const showPreview = toggle({ label: '显示预览', value: true, onChange: renderPreview });
    const preview = el('div', { class: 'svg-preview' });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'SVG 源码' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('选择文件', () => fileInput.click(), { small: true }),
          button('示例', () => { input.value = SAMPLE; run(); }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; preview.replaceChildren(); statsBox.replaceChildren(); stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
        fileZone({
          title: '也可以把 .svg 拖到这里',
          hint: '文件不会上传',
          icon: '🖼️', multiple: false, accept: '.svg,image/svg+xml',
          onFiles: async ([f]) => { input.value = await f.text(); run(); },
        }).root,
      ),
      fieldset('优化选项', precision, optBox, showPreview),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '压缩结果' }), output, stat),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '这次做了什么' }), statsBox),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '预览（压缩后的结果）' }), preview),
    );
    page.setActions(
      button('压缩', run, { primary: true }),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
      button('下载 svg', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        download(new Blob([output.value], { type: 'image/svg+xml;charset=utf-8' }), `优化_${stamp()}.svg`);
        toast('已下载', 'ok');
      }),
    );
    app.main.append(page.root);

    const fileInput = el('input', { type: 'file', accept: '.svg,image/svg+xml', hidden: true });
    page.root.append(fileInput);
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      input.value = await f.text();
      run();
    });

    let timer = 0;
    function run() {
      clearTimeout(timer);
      timer = setTimeout(doRun, 200);
    }

    function doRun() {
      const src = input.value.trim();
      statsBox.replaceChildren();
      if (!src) { output.value = ''; preview.replaceChildren(); stat.textContent = '等待输入'; stat.className = 'hint'; return; }
      if (!/<svg[\s>]/i.test(src)) {
        stat.textContent = '看起来不是 SVG：没找到 <svg> 标签';
        stat.className = 'hint error';
        return;
      }

      try {
        const res = optimizeSvg(src, {
          precision: Math.max(0, Math.min(8, Math.round(precision.get() ?? 3))),
          ...optState,
        });
        output.value = res.data;

        const saved = res.before - res.after;
        const pct = Math.round((saved / res.before) * 100);
        stat.textContent = `${fmtBytes(res.before)} → ${fmtBytes(res.after)}`
          + (pct > 0 ? `（减小 ${pct}%）` : pct < 0 ? `（增大了 ${-pct}%，可关掉「保留缩进」再试）` : '（体积未变）');
        stat.className = pct > 0 ? 'hint ok' : pct === 0 ? 'hint' : 'hint warn';

        const rows = [
          ['注释', res.stats.comments],
          ['元数据元素', res.stats.metadata],
          ['原有 id 数', res.stats.ids],
        ].filter(([, v]) => v > 0);
        if (!rows.length) rows.push(['提示', '这个文件已经很干净了']);
        for (const [k, v] of rows) {
          statsBox.append(el('div', { class: 'kv-row' },
            el('span', { class: 'kv-key', text: k }),
            el('code', { class: 'kv-val', text: String(v) }),
          ));
        }
        renderPreview();
      } catch (err) {
        output.value = '';
        stat.textContent = '优化失败：' + err.message;
        stat.className = 'hint error';
        preview.replaceChildren();
      }
    }

    function renderPreview() {
      preview.replaceChildren();
      if (!showPreview.get()) return;
      const svg = output.value || input.value;
      if (!/<svg[\s>]/i.test(svg)) return;
      // 用 blob URL + <img> 而不是直接 innerHTML：SVG 里的 <script> 不会被执行
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const im = el('img', { src: url, alt: 'SVG 预览', class: 'svg-img' });
      im.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      preview.append(im);
    }

    run();
    return () => { clearTimeout(timer); };
  },
};

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     width="200.0000" height="200.0000" viewBox="0 0 200 200">
  <!-- 生成工具留下的注释 -->
  <metadata>Created with Some Editor 3.2.1</metadata>
  <desc>一个示例图形</desc>
  <sodipodi:namedview inkscape:zoom="1.0000" inkscape:cx="100.0000" inkscape:cy="100.0000"/>
  <defs>
    <linearGradient id="unusedGradient" x1="0.0000" y1="0.0000" x2="1.0000" y2="1.0000">
      <stop offset="0.0000" stop-color="#ffffff"/>
      <stop offset="1.0000" stop-color="#000000"/>
    </linearGradient>
    <linearGradient id="grad" x1="0.0000" y1="0.0000" x2="1.0000" y2="1.0000">
      <stop offset="0.0000" stop-color="#2563eb"/>
      <stop offset="1.0000" stop-color="#16a34a"/>
    </linearGradient>
  </defs>
  <g id="layer1" inkscape:label="图层 1" inkscape:groupmode="layer">
    <rect x="10.0000" y="10.0000" width="180.0000" height="180.0000" rx="24.0000" fill="url(#grad)" stroke="none" stroke-width="1" opacity="1"/>
    <circle cx="100.0000" cy="100.0000" r="48.0000" fill="#ffffff" fill-opacity="0.9000"/>
    <text x="100.0000" y="112.0000" font-family="sans-serif" font-size="32.0000" text-anchor="middle" fill="#0f172a">SVG</text>
  </g>
  <g></g>
</svg>`;
