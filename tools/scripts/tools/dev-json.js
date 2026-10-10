import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  copyWithFeedback, actions, toast, textArea,
} from '../ui.js';
import { download, stamp } from '../lib/files.js';

/** 解析失败时给出「第几行第几列」，比原生的 "Unexpected token" 有用得多 */
function describeJsonError(text, err) {
  const m = String(err.message).match(/position (\d+)/);
  if (!m) return err.message;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  const lineText = text.split('\n')[line - 1] ?? '';
  return `${err.message}\n位置：第 ${line} 行 第 ${col} 列\n该行内容：${lineText.trim().slice(0, 120)}`;
}

/** 递归按键名排序，数组顺序保持不动 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

/** 统计结构信息，给用户一个「这文件多大」的直观感受 */
function summarize(value) {
  let keys = 0, strings = 0, numbers = 0, bools = 0, nulls = 0, arrays = 0, objects = 0, maxDepth = 0;
  const walk = (v, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    if (v === null) { nulls++; return; }
    if (Array.isArray(v)) { arrays++; v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === 'object') {
      objects++;
      for (const [k, x] of Object.entries(v)) { keys++; walk(x, depth + 1); }
      return;
    }
    if (typeof v === 'string') strings++;
    else if (typeof v === 'number') numbers++;
    else if (typeof v === 'boolean') bools++;
  };
  walk(value, 1);
  return { keys, strings, numbers, bools, nulls, arrays, objects, maxDepth };
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'JSON 格式化与校验',
      icon: '{ }',
      desc: '格式化、压缩、校验并分析 JSON。出错时直接告诉你第几行第几列，而不是一句 Unexpected token。',
    });

    const input = el('textarea', { class: 'input mono', rows: 12, placeholder: '把 JSON 粘贴到这里，或拖入 .json 文件…', 'aria-label': 'JSON 输入' });
    const output = el('textarea', { class: 'input mono', rows: 12, readonly: true, 'aria-label': '处理结果' });
    const stat = note('等待输入');

    const indent = select({
      label: '缩进', value: '2',
      options: [['2', '2 空格'], ['4', '4 空格'], ['tab', 'Tab'], ['0', '压缩成一行']],
      onChange: run,
    });
    const sort = toggle({ label: '按键名排序', value: false, onChange: run });
    const dropNull = toggle({ label: '去掉 null 值的字段', value: false, onChange: run });
    const asciiSafe = toggle({ label: '非 ASCII 转成 \\u 转义', value: false, onChange: run });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'JSON 输入' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('选择文件', () => pickFile(), { small: true }),
          button('示例', () => { input.value = SAMPLE; run(); }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('选项', grid(indent, sort), grid(dropNull, asciiSafe)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '处理结果' }), output, stat),
    );
    page.setActions(
      button('复制结果', () => copyWithFeedback(output.value, '已复制'), { primary: true }),
      button('导出 json', () => {
        if (!output.value) { toast('没有可导出的内容', 'error'); return; }
        download(new Blob([output.value], { type: 'application/json' }), `格式化_${stamp()}.json`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    const fileInput = el('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true });
    page.root.append(fileInput);
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      input.value = await f.text();
      run();
    });

    function pickFile() { fileInput.click(); }

    input.addEventListener('input', run);

    function run() {
      const raw = input.value;
      if (!raw.trim()) {
        output.value = '';
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      let value;
      try {
        value = JSON.parse(raw);
      } catch (err) {
        output.value = '';
        stat.textContent = '解析失败\n' + describeJsonError(raw, err);
        stat.className = 'hint error';
        return;
      }

      if (sort.get()) value = sortKeys(value);
      if (dropNull.get()) value = JSON.parse(JSON.stringify(value, (k, v) => (v === null ? undefined : v)));

      const ind = indent.get();
      const space = ind === 'tab' ? '\t' : Number(ind);
      let text = JSON.stringify(value, null, space);

      if (asciiSafe.get()) {
        text = text.replace(/[\u007f-\uffff]/g, (c) =>
          '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
      }

      output.value = text;
      const s = summarize(value);
      stat.textContent = [
        `有效 JSON`,
        `原始 ${raw.length} 字符 → 输出 ${text.length} 字符`,
        `深度 ${s.maxDepth}`,
        `${s.keys} 个键`,
        `${s.objects} 个对象 / ${s.arrays} 个数组`,
        `${s.strings} 字符串 / ${s.numbers} 数字`,
      ].join(' · ');
      stat.className = 'hint ok';
    }

    run();
    return () => { };
  },
};

const SAMPLE = JSON.stringify({
  name: 'ScanLike',
  version: '1.0.0',
  features: ['PDF 转扫描件', 'Office 支持', '签名与印章'],
  config: { dpi: 150, colorMode: 'color', noise: 32, nested: { deep: { level: 4 } } },
  deprecated: null,
  enabled: true,
}, null, 2);
