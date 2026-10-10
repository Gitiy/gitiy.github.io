import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  copyWithFeedback, toast, numberInput,
} from '../ui.js';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 用 BigInt 解析，避免超过 2^53 就精度丢失 —— 64 位 ID 很常见 */
function parseInBase(text, base) {
  let s = String(text).trim().replace(/[\s_,]/g, '');
  if (!s) return null;
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  s = s.toLowerCase().replace(/^0x/, '').replace(/^0b/, '').replace(/^0o/, '');
  if (!s) return null;

  let value = 0n;
  const b = BigInt(base);
  for (const ch of s) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) throw new Error(`「${ch}」不是 ${base} 进制里的合法数字`);
    value = value * b + BigInt(d);
  }
  return neg ? -value : value;
}

function toBase(value, base) {
  if (value === 0n) return '0';
  const neg = value < 0n;
  let v = neg ? -value : value;
  const b = BigInt(base);
  let out = '';
  while (v > 0n) {
    out = DIGITS[Number(v % b)] + out;
    v /= b;
  }
  return (neg ? '-' : '') + out;
}

const groupBits = (bin, size) => bin.replace(new RegExp(`\\B(?=(.{${size}})+$)`, 'g'), ' ');

export const tool = {
  init(app) {
    const page = toolPage({
      title: '进制转换',
      icon: '🔢',
      desc: '在 2–36 任意进制之间互转，用 BigInt 计算所以 64 位以上的大整数也不会丢精度。附带位运算视图。',
    });

    const input = el('input', { type: 'text', class: 'input mono', placeholder: '输入数字，例如 255 或 0xff 或 11111111', 'aria-label': '输入数字' });
    const fromBase = select({
      label: '输入进制', value: '10',
      options: [2, 8, 10, 16, 32, 36].map((b) => [String(b), `${b} 进制${b === 10 ? '（十进制）' : b === 16 ? '（十六进制）' : b === 2 ? '（二进制）' : b === 8 ? '（八进制）' : ''}`]),
      onChange: run,
    });
    const autoDetect = toggle({ label: '按前缀自动识别（0x / 0b / 0o）', value: true, onChange: run });
    const padWidth = numberInput({ label: '补零到多少位（0 表示不补）', value: 0, min: 0, max: 128, onChange: run });

    const table = el('div', { class: 'kv-list' });
    const bitView = el('pre', { class: 'bit-view' });
    const stat = note('等待输入');

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '数字' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => { input.value = '9007199254740993'; fromBase.set('10'); run(); }, { small: true }),
          button('清空', () => { input.value = ''; run(); }, { small: true }),
        ),
      ),
      fieldset('选项', grid(fromBase, autoDetect), padWidth),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '各进制结果' }), table),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '二进制位视图' }), bitView, stat),
    );
    page.setActions(
      button('复制全部结果', () => {
        const text = [...table.querySelectorAll('.kv-row')]
          .map((r) => `${r.querySelector('.kv-key').textContent.padEnd(10)} ${r.querySelector('.kv-val').textContent}`)
          .join('\n');
        return copyWithFeedback(text, '已复制');
      }, { primary: true }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    function run() {
      table.replaceChildren();
      bitView.textContent = '';
      const raw = input.value;
      if (!raw.trim()) {
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      let base = Number(fromBase.get());
      if (autoDetect.get()) {
        const t = raw.trim().toLowerCase();
        if (t.startsWith('0x')) base = 16;
        else if (t.startsWith('0b')) base = 2;
        else if (t.startsWith('0o')) base = 8;
      }

      let value;
      try {
        value = parseInBase(raw, base);
      } catch (err) {
        stat.textContent = err.message;
        stat.className = 'hint error';
        return;
      }
      if (value === null) {
        stat.textContent = '请输入数字';
        stat.className = 'hint';
        return;
      }

      const width = Math.max(0, Math.round(padWidth.get() || 0));
      const pad = (s) => {
        if (!width) return s;
        const neg = s.startsWith('-');
        const body = neg ? s.slice(1) : s;
        return (neg ? '-' : '') + body.padStart(width, '0');
      };

      const rows = [
        ['二进制 (2)', toBase(value, 2), '0b'],
        ['八进制 (8)', toBase(value, 8), '0o'],
        ['十进制 (10)', toBase(value, 10), ''],
        ['十六进制 (16)', toBase(value, 16), '0x'],
        ['32 进制', toBase(value, 32), ''],
        ['36 进制', toBase(value, 36), ''],
      ];
      for (const [label, v, prefix] of rows) {
        const shown = pad(v);
        table.append(el('div', { class: 'kv-row' },
          el('span', { class: 'kv-key', text: label }),
          el('code', { class: 'kv-val', text: prefix + shown }),
          button('复制', async () => {
            const { copyText } = await import('../ui.js');
            const ok = await copyText(prefix + shown);
            toast(ok ? '已复制' : '复制失败', ok ? 'ok' : 'error');
          }, { small: true }),
        ));
      }

      // 位视图
      const bits = toBase(value < 0n ? -value : value, 2);
      const grouped = groupBits(bits, 4);
      const bytes = Math.ceil(bits.length / 8);
      bitView.textContent = [
        `位宽 ${bits.length} 位（${bytes} 字节）`,
        grouped,
        '',
        `字节视图：${bits.padStart(bytes * 8, '0').match(/.{8}/g).map((b) => parseInt(b, 2).toString(16).padStart(2, '0')).join(' ')}`,
      ].join('\n');

      stat.textContent = `按 ${base} 进制解析 · 十进制值 ${toBase(value, 10)}`;
      stat.className = 'hint ok';
    }

    run();
    return () => { };
  },
};
