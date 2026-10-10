import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  copyWithFeedback, toast, fileZone,
} from '../ui.js';
import { loadOpenCC } from '../lib/scripts.js';
import { download, baseName, stamp } from '../lib/files.js';

/**
 * 方向 → (词典包, from, to)
 *
 * 词典分两个包：cn2t 负责简→繁（1.1MB，含词组表，能正确处理「头发→頭髮」这类
 * 需要看词境的情况），t2cn 负责繁→简（107KB）。按方向按需加载，不白下载。
 *
 * flip 指向反方向那一条的下标，「交换」按钮用它保持地区变体不变。
 */
const DIRECTIONS = [
  { bundle: 'cn2t', from: 'cn', to: 'twp', label: '简体 → 繁体（台湾正体）', short: '简 → 繁（台湾）', flip: 3 },
  { bundle: 'cn2t', from: 'cn', to: 'hkp', label: '简体 → 繁体（香港）', short: '简 → 繁（香港）', flip: 4 },
  { bundle: 'cn2t', from: 'cn', to: 't', label: '简体 → 繁体（通用）', short: '简 → 繁（通用）', flip: 5 },
  { bundle: 't2cn', from: 'tw', to: 'cn', label: '繁体 → 简体（台湾）', short: '繁 → 简（台湾）', flip: 0 },
  { bundle: 't2cn', from: 'hk', to: 'cn', label: '繁体 → 简体（香港）', short: '繁 → 简（香港）', flip: 1 },
  { bundle: 't2cn', from: 't', to: 'cn', label: '繁体 → 简体（通用）', short: '繁 → 简（通用）', flip: 2 },
];
// id 有重复，用索引做 value
const DIR_INDEX = DIRECTIONS.map((d, i) => [String(i), d.label]);

export const tool = {
  init(app) {
    const page = toolPage({
      title: '简繁转换',
      icon: '🀄',
      desc: '简体与繁体互转，支持台湾正体、香港繁体与通用繁体。用 OpenCC 的词组词典，能正确处理「头发 → 頭髮」这类要看词境的转换。',
    });

    const input = el('textarea', { class: 'input mono', rows: 10, placeholder: '把要转换的文字粘贴到这里…', 'aria-label': '原文' });
    const output = el('textarea', { class: 'input mono', rows: 10, readonly: true, 'aria-label': '转换结果' });
    const stat = note('等待输入');

    const dirSel = select({
      label: '转换方向', value: '0',
      options: DIR_INDEX,
      onChange: run,
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '原文' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => { input.value = SAMPLE; run(); }, { small: true }),
          button('交换', () => {
            // 把结果放回原文，同时反转方向（保持台湾/香港/通用变体不变）
            const curIdx = Number(dirSel.get()) || 0;
            const cur = DIRECTIONS[curIdx] || DIRECTIONS[0];
            const t = input.value;
            input.value = output.value;
            output.value = t;
            dirSel.set(String(cur.flip));
            run();
          }, { small: true, title: '把结果放回原文，并反转转换方向' }),
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
        fileZone({
          title: '也可以拖入 .txt / .md 文件',
          hint: '文件不会上传',
          icon: '📄', multiple: false, accept: '.txt,.md,.csv,text/plain',
          onFiles: async ([f]) => { input.value = await f.text(); run(); },
        }).root,
      ),
      fieldset('转换设置', dirSel),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '转换结果' }), output, stat),
    );
    page.setActions(
      button('转换', run, { primary: true }),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
      button('导出 txt', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        download(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), `简繁转换_${stamp()}.txt`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    let timer = 0;
    let lastDir = null;

    input.addEventListener('input', () => schedule());

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(run, 300);
    }

    async function run() {
      const text = input.value;
      if (!text.trim()) {
        output.value = '';
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      const dir = DIRECTIONS[Number(dirSel.get())] || DIRECTIONS[0];
      try {
        if (lastDir !== dir.bundle) {
          stat.textContent = dir.bundle === 'cn2t'
            ? '正在加载简→繁词典（约 1.1 MB，只需一次）…'
            : '正在加载繁→简词典…';
          stat.className = 'hint';
          lastDir = dir.bundle;
        }
        const Converter = await loadOpenCC(dir.bundle);
        const convert = Converter({ from: dir.from, to: dir.to });
        const out = convert(text);
        output.value = out;

        const changed = [...text].filter((c, i) => out[i] !== c).length;
        stat.textContent = `${dir.short} · ${text.length} 字 → 改动 ${changed} 字`;
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = '转换失败：' + err.message;
        stat.className = 'hint error';
        lastDir = null;
      }
    }

    run();
    return () => { clearTimeout(timer); };
  },
};

const SAMPLE = `这个软件的后台数据处理模块支持离线运行，用户可以在网络不稳定的情况下继续工作。
项目负责人表示，头发丝那么细的误差都能被发现，而且还支持导出多种格式。
我们计划在下个月发布新版本，届时会提供更完善的文档与示例代码。`;
