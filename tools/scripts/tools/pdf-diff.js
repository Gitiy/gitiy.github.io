import { toolPage, fileZone, el, button, note, toast, progress, select, fieldset } from '../ui.js';
import { openPdf, renderPage, pageText } from '../lib/pdfkit.js';
import { diffLines } from './text-diff.js';
import { fmtBytes, baseName } from '../lib/files.js';

/**
 * PDF 文档对比：文字差异 + 像素差异。
 * 文字走行级 LCS（复用文本比较那套），像素按同一画布尺寸逐点比对。
 */

const CMP_W = 620;      // 像素对比的归一化宽度
const DIFF_THRESHOLD = 28;  // 单通道差值超过这个才算「变了」，滤掉抗锯齿噪声

export const tool = {
  init(app) {
    /** @type {{file:File, bytes:Uint8Array, pdfjs:any, name:string}|null} */
    let A = null;
    let B = null;
    let report = null;

    const page = toolPage({
      title: 'PDF 文档对比',
      icon: '🔬',
      desc: '对比两份 PDF 的文字与版面差异。文字差异按行给出增删，像素差异用红色标出改动的区域。',
    });

    const infoA = note('左侧：原始版本');
    const dzA = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '🅰️',
      title: '原始 PDF', hint: '作为对比基准',
      onFiles: (f) => pick('a', f[0]),
    });
    const infoB = note('右侧：修改后的版本');
    const dzB = fileZone({
      accept: '.pdf,application/pdf', multiple: false, icon: '🅱️',
      title: '修改后的 PDF', hint: '和左边逐页比对',
      onFiles: (f) => pick('b', f[0]),
    });

    const bar = progress();
    const summary = el('div');
    const detail = el('div');
    const pageSel = select({ label: '查看某一页的文字差异', options: [['', '（先对比）']], value: '', onChange: renderDetail });
    const pageSelBox = fieldset('逐页详情', pageSel);
    pageSelBox.classList.add('hidden');

    const btnRun = button('开始对比', run, { primary: true });
    btnRun.disabled = true;

    page.add(dzA, infoA, dzB, infoB, bar.root, btnRun, summary, pageSelBox, detail);
    page.setActions(btnRun);
    app.main.appendChild(page.root);

    /* ---------------- 加载 ---------------- */

    async function pick(which, file) {
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdfjs = await openPdf(bytes);
        const rec = { file, bytes, pdfjs, name: file.name };
        if (which === 'a') { A = rec; infoA.textContent = `${file.name} · ${pdfjs.numPages} 页 · ${fmtBytes(bytes.length)}`; infoA.className = 'hint'; }
        else { B = rec; infoB.textContent = `${file.name} · ${pdfjs.numPages} 页 · ${fmtBytes(bytes.length)}`; infoB.className = 'hint'; }
        btnRun.disabled = !(A && B);
      } catch (err) {
        toast('打不开这个 PDF：' + err.message, 'error');
      }
    }

    /* ---------------- 对比 ---------------- */

    async function run() {
      if (!A || !B) return;
      btnRun.disabled = true;
      summary.replaceChildren();
      detail.replaceChildren();
      pageSelBox.classList.add('hidden');
      bar.show(0, '正在对比…');

      try {
        const total = Math.max(A.pdfjs.numPages, B.pdfjs.numPages);
        const pages = [];

        for (let i = 1; i <= total; i++) {
          bar.set((i - 1) / total, `第 ${i}/${total} 页`);

          const hasA = i <= A.pdfjs.numPages;
          const hasB = i <= B.pdfjs.numPages;

          const rec = { page: i, hasA, hasB, add: 0, del: 0, same: 0, pixel: null, diff: [] };

          if (hasA && hasB) {
            const ta = await pageText(A.pdfjs, i);
            const tb = await pageText(B.pdfjs, i);
            const la = ta.text ? ta.text.split('\n') : [];
            const lb = tb.text ? tb.text.split('\n') : [];
            rec.diff = diffLines(la, lb);
            for (const d of rec.diff) {
              if (d.type === 'add') rec.add++;
              else if (d.type === 'del') rec.del++;
              else rec.same++;
            }
            rec.pixel = await pixelDiff(A.pdfjs, B.pdfjs, i);
          } else if (hasA) {
            rec.del = -1;   // 表示整页只在左侧存在
          } else {
            rec.add = -1;
          }

          pages.push(rec);
        }

        report = { total, pages };
        bar.set(1, '对比完成');
        renderSummary();
      } catch (err) {
        bar.hide?.();
        toast('对比失败：' + err.message, 'error');
      } finally {
        btnRun.disabled = false;
      }
    }

    /** 把两页画到同样大小的画布上逐点比，返回差异比例与可视化 canvas */
    async function pixelDiff(a, b, n) {
      const ra = await renderPage(a, n, 1);
      const rb = await renderPage(b, n, 1);

      const W = Math.max(ra.canvas.width, rb.canvas.width);
      const H = Math.max(ra.canvas.height, rb.canvas.height);
      const scale = Math.min(1, CMP_W / W);
      const w = Math.max(1, Math.round(W * scale));
      const h = Math.max(1, Math.round(H * scale));

      const fit = (src) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        // 居中绘制，避免页面尺寸不同直接拉伸变形
        const dw = Math.round(src.width * scale);
        const dh = Math.round(src.height * scale);
        ctx.drawImage(src, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
        return ctx.getImageData(0, 0, w, h);
      };

      const da = fit(ra.canvas).data;
      const db = fit(rb.canvas).data;

      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const octx = out.getContext('2d');
      const img = octx.createImageData(w, h);
      const od = img.data;

      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (d > DIFF_THRESHOLD * 3) {
          changed++;
          // 改动处标红
          od[i] = 220; od[i + 1] = 38; od[i + 2] = 38; od[i + 3] = 255;
        } else {
          // 未改动处压成浅灰底
          const g = Math.round((da[i] + da[i + 1] + da[i + 2]) / 3);
          const v = 235 - Math.round((255 - g) * 0.18);
          od[i] = v; od[i + 1] = v; od[i + 2] = v; od[i + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);

      const total = w * h;
      return { ratio: changed / total, changed, total, canvas: out };
    }

    /* ---------------- 结果展示 ---------------- */

    function renderSummary() {
      const { total, pages } = report;
      // 用「实际变化的像素数」而不是比例：改几个字时比例会低到 0.03%，
      // 用比例判断会误报成「没变」。
      const isPixelChanged = (p) => !!p.pixel && p.pixel.changed >= 30;
      const changedText = pages.filter((p) => p.add > 0 || p.del > 0).length;
      const changedPixel = pages.filter(isPixelChanged).length;
      const added = pages.filter((p) => p.hasB && !p.hasA).length;
      const removed = pages.filter((p) => p.hasA && !p.hasB).length;

      const sameCount = pages.filter((p) => p.hasA && p.hasB && p.add === 0 && p.del === 0
        && !isPixelChanged(p)).length;

      summary.replaceChildren(
        el('div', { class: 'card' },
          el('h3', { text: '对比结果' }),
          el('ul', { class: 'diff-summary' },
            el('li', { text: `页数：${A.pdfjs.numPages} → ${B.pdfjs.numPages}${total ? `（共比对 ${total} 页）` : ''}` }),
            el('li', { text: `完全一致：${sameCount} 页` }),
            el('li', { text: `文字有变化：${changedText} 页` }),
            el('li', { text: `版面有变化：${changedPixel} 页` }),
            added ? el('li', { class: 'warn', text: `新增页面：${added} 页` }) : null,
            removed ? el('li', { class: 'warn', text: `删除页面：${removed} 页` }) : null,
          ),
          el('p', { class: 'hint', text: '文字变化按行统计（新增/删除行数）；版面变化按像素差异，少于 30 个像素的改动视为渲染噪点忽略。' }),
        ),
      );

      // 页面选择器
      const opts = [['', '（选择一页）']];
      for (const p of pages) {
        const tags = [];
        if (!p.hasB) tags.push('已删除');
        else if (!p.hasA) tags.push('新增');
        else {
          if (p.add || p.del) tags.push(`+${p.add}/-${p.del}`);
          if (p.pixel && p.pixel.changed >= 30) tags.push(`版面 ${(p.pixel.ratio * 100).toFixed(2)}%`);
          if (!tags.length) tags.push('无变化');
        }
        opts.push([String(p.page), `第 ${p.page} 页 · ${tags.join(' · ')}`]);
      }
      pageSel.node.replaceChildren(...opts.map(([v, t]) => el('option', { value: v, text: t })));
      pageSelBox.classList.remove('hidden');
    }

    function renderDetail() {
      const n = Number(pageSel.get());
      if (!n) { detail.replaceChildren(); return; }
      const p = report.pages.find((x) => x.page === n);
      if (!p) return;

      const parts = [];

      if (!p.hasB) {
        parts.push(note(`第 ${n} 页只存在于原始版本中，修改后的文档里没有这一页。`, 'warn'));
      } else if (!p.hasA) {
        parts.push(note(`第 ${n} 页是修改后新增的，原始版本里没有。`, 'warn'));
      } else {
        if (p.pixel) {
          parts.push(el('div', { class: 'card' },
            el('h3', { text: `第 ${n} 页 · 版面差异 ${(p.pixel.ratio * 100).toFixed(2)}%` }),
            el('p', { class: 'hint', text: `红色为改动区域（${p.pixel.changed.toLocaleString()} / ${p.pixel.total.toLocaleString()} 像素）` }),
            el('div', { class: 'diff-canvas-wrap' }, p.pixel.canvas),
          ));
        }

        const diffBox = el('div', { class: 'diff-lines' });
        let shown = 0;
        for (const d of p.diff) {
          if (d.type === 'same') continue;
          if (shown++ > 400) { diffBox.append(el('div', { class: 'diff-row', text: '…（差异过多，只显示前 400 行）' })); break; }
          diffBox.append(el('div', { class: `diff-row ${d.type}` },
            el('span', { class: 'diff-sign', text: d.type === 'add' ? '+' : '−' }),
            el('span', { text: d.text || '（空行）' }),
          ));
        }
        if (!shown) diffBox.append(el('p', { class: 'hint', text: '文字层没有差异。' }));

        parts.push(el('div', { class: 'card' },
          el('h3', { text: `第 ${n} 页 · 文字差异（+${p.add} / −${p.del}）` }),
          diffBox,
        ));
      }

      detail.replaceChildren(...parts);
    }

    return () => {
      A?.pdfjs?.destroy?.();
      B?.pdfjs?.destroy?.();
      A = B = null;
      report = null;
    };
  },
};
