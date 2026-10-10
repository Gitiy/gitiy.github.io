import {
  toolPage, el, button, select, note, grid, fieldset, toggle, textArea,
  toast, fileZone, rangeInput, numberInput, colorInput, textInput,
} from '../ui.js';
import { loadWordCloud } from '../lib/scripts.js';
import { download, stamp } from '../lib/files.js';

/* ============================================================
   分词
   ============================================================ */

const STOP_WORDS = new Set(`的 了 和 是 在 我 有 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好 自己 这 那 与 及 或 而 但 并 被 把 让 从 对 为 以 之 其 中 更 最 可以 这个 那个 我们 你们 他们 它 就是 因为 所以 如果 虽然 但是 然后 还有 已经 一个 一些 什么 怎么 这样 那样 以及 或者 并且 不过 只是 还是 没有 不是 这种 那种
the a an and or but if then of to in on at for with is are was were be been being this that these those it its as by from not no so such very can will just should would could may might do does did have has had i you he she we they them their there here what which who when where why how all any both each few more most other some only own same than too`.split(/\s+/).filter(Boolean));

/** 把文本切成词频表。中文没有词典，用 2/3 字组合近似，并做一层去重 */
function tokenize(text, { mode = 'auto', minLen = 2, minFreq = 2 } = {}) {
  const counts = new Map();
  const bump = (w, n = 1) => counts.set(w, (counts.get(w) || 0) + n);

  const latin = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  for (const w of latin) {
    const key = w.toLowerCase();
    if (key.length < minLen || STOP_WORDS.has(key)) continue;
    bump(key);
  }

  const digits = text.match(/\d{2,}/g) || [];
  for (const d of digits) bump(d);

  if (mode !== 'space') {
    // 中文按连续汉字段切，再取 2 字与 3 字组合
    const segs = text.match(/[\u4e00-\u9fff]+/g) || [];
    const tri = new Map();
    const bi = new Map();
    for (const seg of segs) {
      for (let n = 2; n <= 3; n++) {
        const bag = n === 3 ? tri : bi;
        for (let i = 0; i + n <= seg.length; i++) {
          const w = seg.slice(i, i + n);
          if (STOP_WORDS.has(w)) continue;
          bag.set(w, (bag.get(w) || 0) + 1);
        }
      }
    }
    // 3 字词优先：若某个 2 字词被一个出现次数不少于它的 3 字词包含，就丢掉它
    const keptTri = [...tri.entries()].filter(([, c]) => c >= minFreq);
    for (const [w, c] of bi) {
      if (c < minFreq) continue;
      const covered = keptTri.some(([t, tc]) => t.includes(w) && tc >= c);
      if (!covered) counts.set(w, (counts.get(w) || 0) + c);
    }
    for (const [w, c] of keptTri) counts.set(w, (counts.get(w) || 0) + c);
  }

  return [...counts.entries()]
    .filter(([w, c]) => c >= minFreq && w.length >= minLen)
    .sort((a, b) => b[1] - a[1]);
}

/** 手动模式：每行「词 权重」或「词,权重」 */
function parseManual(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(.*?)[\s,，\t]+([\d.]+)$/);
    if (m) out.push([m[1].trim(), Number(m[2])]);
    else out.push([t, 1]);
  }
  return out;
}

/* ============================================================
   配色
   ============================================================ */

const PALETTES = {
  ocean: ['#0f766e', '#0e7490', '#1d4ed8', '#4338ca', '#0f172a'],
  sunset: ['#b91c1c', '#c2410c', '#d97706', '#a16207', '#7c2d12'],
  forest: ['#15803d', '#4d7c0f', '#166534', '#3f6212', '#14532d'],
  berry: ['#be185d', '#a21caf', '#7e22ce', '#9d174d', '#831843'],
  ink: ['#111827', '#374151', '#4b5563', '#1f2937', '#6b7280'],
};

const SHAPES = [
  ['square', '矩形铺满'],
  ['circle', '圆形'],
  ['cardioid', '心形'],
  ['diamond', '菱形'],
  ['triangle-forward', '三角形'],
  ['pentagon', '五边形'],
  ['star', '星形'],
];

const SIZES = [
  ['900x600', '横向 900 × 600'],
  ['1200x675', '横向 1200 × 675（16:9）'],
  ['800x800', '正方形 800 × 800'],
  ['600x900', '竖向 600 × 900'],
];

export const tool = {
  init(app) {
    const page = toolPage({
      title: '词云图生成',
      icon: '☁️',
      desc: '把一段文字做成词云图。中文没有内置词典，用 2/3 字组合近似分词；需要精确结果可以用手动模式自己给词与权重。',
    });

    const canvas = el('canvas', { class: 'wc-canvas', width: 900, height: 600 });
    const stat = note('等待输入');
    const wordStat = note('');

    const input = el('textarea', { class: 'input mono', rows: 8, placeholder: '把要做词云的文本粘贴到这里…', 'aria-label': '文本' });
    const manual = el('textarea', {
      class: 'input mono', rows: 6, 'aria-label': '手动词表',
      placeholder: '每行一个词，可带权重，例如：\n扫描件 30\n离线 18\n中文 12',
    });
    // el() 返回的是裸元素，不是控件对象（没有 .root），所以自己包一层方便显隐
    const manualWrap = el('div', { class: 'field-row' },
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '词表（每行一个词，可带权重）' }),
        manual,
      ),
      el('p', { class: 'field-hint', text: '权重可以省略；省略时按 1 计。' }),
    );

    const modeSel = select({
      label: '取词方式', value: 'auto',
      options: [
        ['auto', '自动（中英混合，中文按 2/3 字组合近似）'],
        ['space', '按空格/标点切分（适合英文）'],
        ['manual', '手动给词与权重'],
      ],
      onChange: sync,
    });
    const minFreq = numberInput({ label: '最小出现次数', value: 2, min: 1, max: 50, onChange: render });
    const maxWords = numberInput({ label: '最多显示词数', value: 120, min: 5, max: 500, onChange: render });
    const minLen = numberInput({ label: '最短词长', value: 2, min: 1, max: 8, onChange: render });
    const stopWords = textInput({
      label: '额外停用词（空格分隔）', value: '',
      onChange: render,
    });

    const sizeSel = select({ label: '画布尺寸', value: '900x600', options: SIZES, onChange: render });
    const paletteSel = select({
      label: '配色', value: 'ocean',
      options: [['ocean', '深海蓝绿'], ['sunset', '落日暖橙'], ['forest', '森林绿'], ['berry', '浆果紫红'], ['ink', '墨色'], ['mono', '单色（用下面的颜色）']],
      onChange: render,
    });
    const baseColor = colorInput({ label: '单色模式的颜色', value: '#0f766e', onChange: render });
    const bgColor = colorInput({ label: '背景色', value: '#ffffff', onChange: render });
    const transparentBg = toggle({ label: '透明背景（导出 PNG 时）', value: false, onChange: render });
    const fontFamily = textInput({
      label: '字体', value: '"PingFang SC", "Microsoft YaHei", sans-serif',
      onChange: render,
    });
    const sizeRange = rangeInput({ label: '最大字号', value: 88, min: 24, max: 200, format: (v) => v + ' px', onChange: render });
    const rotateRatio = rangeInput({ label: '旋转词占比', value: 0.25, min: 0, max: 1, step: 0.05, format: (v) => Math.round(v * 100) + '%', onChange: render });
    const shapeSel = select({ label: '外形', value: 'square', options: SHAPES, onChange: render });
    const ellipticity = rangeInput({ label: '横向拉伸', value: 0.75, min: 0.4, max: 1, step: 0.05, format: (v) => v.toFixed(2), onChange: render });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '文本' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => { input.value = SAMPLE; modeSel.set('auto'); sync(); render(); }, { small: true }),
          button('清空', () => { input.value = ''; manual.value = ''; render(); }, { small: true }),
        ),
        fileZone({
          title: '也可以拖入 .txt / .md 文件',
          hint: '文件不会上传',
          icon: '📄', multiple: false, accept: '.txt,.md,.csv,text/plain',
          onFiles: async ([f]) => { input.value = await f.text(); render(); },
        }).root,
      ),
      fieldset('取词', modeSel, manualWrap, grid(minFreq, maxWords), grid(minLen, stopWords)),
      fieldset('外观', grid(sizeSel, shapeSel), grid(paletteSel, baseColor), grid(bgColor, fontFamily),
        grid(sizeRange, ellipticity), grid(rotateRatio, transparentBg)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '预览' }), canvas, wordStat, stat),
    );
    page.setActions(
      button('重新生成', render, { primary: true }),
      button('下载 PNG', () => {
        // 用 blob URL 而不是 data: URL —— 900×600 的画布转成 base64 有 1MB 左右，
        // 这么大的 data: URL 下载会被浏览器间歇性拒绝（实测偶发失败）
        canvas.toBlob((blob) => {
          if (!blob) { toast('导出失败', 'error'); return; }
          download(blob, `词云_${stamp()}.png`);
          toast('已导出 PNG', 'ok');
        }, 'image/png');
      }),
      button('复制词频表', async () => {
        if (!lastWords.length) { toast('还没有词频数据', 'error'); return; }
        const { copyWithFeedback } = await import('../ui.js');
        await copyWithFeedback(lastWords.map(([w, c]) => `${w}\t${c}`).join('\n'), '已复制词频表');
      }),
    );
    app.main.append(page.root);

    let lastWords = [];
    let timer = 0;

    // 两个输入框都要能触发重绘（之前漏了，打字没反应，只能靠点按钮）
    for (const area of [input, manual]) {
      area.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(doRender, 400);
      });
    }

    function sync() {
      const m = modeSel.get();
      manualWrap.classList.toggle('hidden', m !== 'manual');
      minFreq.root.classList.toggle('hidden', m === 'manual');
      minLen.root.classList.toggle('hidden', m === 'manual');
      render();
    }

    function colorFor(word, weight, fontSize) {
      const p = paletteSel.get();
      if (p === 'mono') return baseColor.get();
      const arr = PALETTES[p] || PALETTES.ocean;
      // 按字号分档，让大词用深色、小词用浅色，层次更清楚
      const idx = Math.min(arr.length - 1, Math.floor((1 - fontSize / Math.max(1, sizeRange.get())) * arr.length));
      return arr[idx];
    }

    function render() {
      clearTimeout(timer);
      timer = setTimeout(doRender, 120);
    }

    async function doRender() {
      const mode = modeSel.get();
      let words;

      if (mode === 'manual') {
        words = parseManual(manual.value);
      } else {
        const text = input.value;
        if (!text.trim()) {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          wordStat.textContent = '';
          stat.textContent = '等待输入';
          stat.className = 'hint';
          return;
        }
        const extra = new Set(stopWords.get().split(/\s+/).filter(Boolean));
        const all = tokenize(text, { mode, minLen: Math.max(1, Math.round(minLen.get() || 2)), minFreq: Math.max(1, Math.round(minFreq.get() || 2)) });
        words = all.filter(([w]) => !extra.has(w));
      }

      const cap = Math.max(5, Math.round(maxWords.get() || 120));
      words = words.slice(0, cap);

      if (!words.length) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        wordStat.textContent = '没提取到词：可以把「最小出现次数」调低，或改用手动模式';
        wordStat.className = 'hint error';
        return;
      }
      lastWords = words;

      // 尺寸下拉框万一取到非法值（比如被脚本设成了不存在的选项），
      // 会算出 0×0 的画布，后面 getImageData 直接抛错，所以这里兜一下
      const [w, h] = (sizeSel.get() || '').split('x').map(Number);
      const cw = Number.isFinite(w) && w > 0 ? w : 900;
      const ch = Number.isFinite(h) && h > 0 ? h : 600;
      canvas.width = cw;
      canvas.height = ch;

      try {
        const WordCloud = await loadWordCloud();
        const max = words[0][1];
        const min = words[words.length - 1][1];
        const maxPx = Math.round(sizeRange.get());
        const minPx = Math.max(11, Math.round(maxPx * 0.22));

        WordCloud.stop();
        WordCloud(canvas, {
          list: words,
          gridSize: Math.round(Math.max(4, cw / 180)),
          weightFactor: (weight) => {
            if (max === min) return maxPx;
            const t = (weight - min) / (max - min);
            return minPx + t * (maxPx - minPx);
          },
          fontFamily: fontFamily.get() || 'sans-serif',
          fontWeight: '700',
          color: colorFor,
          backgroundColor: transparentBg.get() ? 'rgba(0,0,0,0)' : bgColor.get(),
          rotateRatio: rotateRatio.get(),
          rotationSteps: 2,
          shape: shapeSel.get(),
          ellipticity: ellipticity.get(),
          clearCanvas: true,
          shrinkToFit: true,
          drawOutOfBound: false,
          minSize: 8,
        });

        wordStat.textContent = `共 ${words.length} 个词 · 最高频「${words[0][0]}」出现 ${words[0][1]} 次`;
        wordStat.className = 'hint ok';
        stat.textContent = `已生成 ${cw} × ${ch} 的词云图`;
        stat.className = 'hint ok';
      } catch (err) {
        console.error(err);
        stat.textContent = '生成失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    sync();
    return () => { clearTimeout(timer); };
  },
};

const SAMPLE = `扫描件生成器可以把 PDF、Word、Excel、PowerPoint 和图片变成逼真的扫描件。
所有处理都在浏览器本地完成，文件不会上传到服务器，断网也能继续使用。
支持调节模糊、噪点、旋转角度、纸张泛黄、边缘阴影等扫描效果，实时预览所见即所得。
还可以添加签名、印章与自定义水印，导出时写入 PDF 元数据。
离线能力依靠 Service Worker 缓存全部资源，首次访问之后即使没有网络也能完整转换。
扫描件的本质是位图 PDF，文字会被拍平，不能再次选中，这与真实的扫描仪输出一致。`;
