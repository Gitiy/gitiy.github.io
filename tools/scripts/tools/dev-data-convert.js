import {
  toolPage, el, button, select, note, toggle, grid, fieldset,
  copyWithFeedback, toast, textInput,
} from '../ui.js';
import { FORMATS, parseData, stringifyData, detectFormat } from '../lib/formats.js';
import { download, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: '数据格式转换',
      icon: '🔀',
      desc: 'JSON / YAML / TOML / XML / CSV / TSV 之间互转。CSV 与 JSON 互转时按首行做字段名。',
    });

    const input = el('textarea', { class: 'input mono', rows: 12, placeholder: '把源数据粘贴到这里…', 'aria-label': '源数据' });
    const output = el('textarea', { class: 'input mono', rows: 12, readonly: true, 'aria-label': '转换结果' });
    const stat = note('等待输入');

    const from = select({
      label: '源格式', value: 'json',
      options: [['auto', '自动识别'], ...FORMATS.map((f) => [f.id, f.label])],
      onChange: run,
    });
    const to = select({
      label: '目标格式', value: 'yaml',
      options: FORMATS.map((f) => [f.id, f.label]),
      onChange: run,
    });
    const indent = textInput({ label: '缩进空格数（JSON / YAML）', value: '2', onChange: run });
    const delimiter = textInput({ label: 'CSV 分隔符', value: ',', onChange: run });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '源数据' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例 JSON', () => { input.value = SAMPLE_JSON; from.set('json'); run(); }, { small: true }),
          button('示例 CSV', () => { input.value = SAMPLE_CSV; from.set('csv'); run(); }, { small: true }),
          button('示例 YAML', () => { input.value = SAMPLE_YAML; from.set('yaml'); run(); }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('转换设置', grid(from, to), grid(indent, delimiter)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '转换结果' }), output, stat),
    );
    page.setActions(
      button('复制结果', () => copyWithFeedback(output.value, '已复制'), { primary: true }),
      button('下载文件', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        const f = FORMATS.find((x) => x.id === to.get());
        download(new Blob([output.value], { type: f.mime + ';charset=utf-8' }), `转换结果_${stamp()}.${f.ext}`);
        toast('已下载', 'ok');
      }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    let timer = 0;
    function run() {
      clearTimeout(timer);
      timer = setTimeout(doRun, 120);
    }

    async function doRun() {
      const raw = input.value;
      if (!raw.trim()) {
        output.value = '';
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      const src = from.get() === 'auto' ? detectFormat(raw) : from.get();
      const dst = to.get();
      if (src === dst) {
        output.value = raw;
        stat.textContent = `源格式与目标格式都是 ${src}，原样输出`;
        stat.className = 'hint';
        return;
      }

      try {
        const value = await parseData(raw, src);
        const text = await stringifyData(value, dst, {
          indent: Math.max(0, Math.min(8, Number(indent.get()) || 2)),
          delimiter: delimiter.get() === '\\t' ? '\t' : (delimiter.get() || ','),
        });
        output.value = text;
        stat.textContent = `${src.toUpperCase()} → ${dst.toUpperCase()} · ${raw.length} 字符 → ${text.length} 字符`;
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = `转换失败（${src} 解析或 ${dst} 序列化）：` + err.message;
        stat.className = 'hint error';
      }
    }

    run();
    return () => { };
  },
};

const SAMPLE_JSON = JSON.stringify({
  service: 'ScanLike',
  version: '1.0.0',
  offline: true,
  dpi: 150,
  formats: ['pdf', 'png', 'jpg'],
  author: { name: 'demo', contact: 'demo@example.com' },
}, null, 2);

const SAMPLE_CSV = `姓名,部门,工号,入职年份
张伟,研发,1001,2019
李娜,设计,1002,2021
王强,运营,1003,2020`;

const SAMPLE_YAML = `database:
  host: 127.0.0.1
  port: 5432
  name: appdb
  pool:
    min: 2
    max: 10
features:
  - name: cache
    enabled: true
  - name: metrics
    enabled: false
`;
