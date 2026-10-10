import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  copyWithFeedback, toast, textInput,
} from '../ui.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');

function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtUtc(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

const rel = (sec) => {
  const s = Math.abs(sec);
  const dir = sec >= 0 ? '前' : '后';
  if (s < 60) return `${s} 秒${dir}`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟${dir}`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时${dir}`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)} 天${dir}`;
  return `${(s / 86400 / 365).toFixed(1)} 年${dir}`;
};

export const tool = {
  init(app) {
    const page = toolPage({
      title: '时间戳转换',
      icon: '🕐',
      desc: 'Unix 时间戳与日期字符串互转，支持秒/毫秒自动识别、时区切换、常见格式解析与相对时间显示。',
    });

    const input = el('input', { type: 'text', class: 'input mono', value: String(Math.floor(Date.now() / 1000)), placeholder: '时间戳、日期字符串或 ISO 8601', 'aria-label': '输入' });
    const out = el('div', { class: 'kv-list' });
    const stat = note('');

    const unit = select({
      label: '输入单位', value: 'auto',
      options: [['auto', '自动识别'], ['s', '秒'], ['ms', '毫秒']],
      onChange: run,
    });
    const useUtc = toggle({ label: '按 UTC 显示日期', value: false, onChange: run });
    const fmt = textInput({
      label: '自定义格式（可选）', value: '',
      placeholder: 'YYYY-MM-DD HH:mm:ss',
      onChange: run,
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '输入' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('现在', () => { input.value = String(Math.floor(Date.now() / 1000)); run(); }, { small: true }),
          button('今天零点', () => { const d = new Date(); d.setHours(0, 0, 0, 0); input.value = String(Math.floor(d.getTime() / 1000)); run(); }, { small: true }),
          button('清空', () => { input.value = ''; out.replaceChildren(); stat.textContent = ''; }, { small: true }),
        ),
      ),
      fieldset('选项', grid(unit, useUtc), fmt),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '转换结果' }), out, stat),
    );
    page.setActions(
      button('复制全部', () => {
        const text = [...out.querySelectorAll('.kv-row')]
          .map((r) => `${r.querySelector('.kv-key').textContent.padEnd(14)} ${r.querySelector('.kv-val').textContent}`)
          .join('\n');
        return copyWithFeedback(text, '已复制');
      }, { primary: true }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    function applyFormat(d, pattern) {
      const map = {
        YYYY: d.getFullYear(),
        MM: pad(d.getMonth() + 1),
        DD: pad(d.getDate()),
        HH: pad(d.getHours()),
        mm: pad(d.getMinutes()),
        ss: pad(d.getSeconds()),
        SSS: pad(d.getMilliseconds(), 3),
      };
      return pattern.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, (m) => map[m]);
    }

    function row(key, value, copy) {
      return el('div', { class: 'kv-row' },
        el('span', { class: 'kv-key', text: key }),
        el('code', { class: 'kv-val', text: value }),
        button('复制', () => copyWithFeedback(copy ?? value, '已复制'), { small: true }),
      );
    }

    function run() {
      out.replaceChildren();
      const raw = input.value.trim();
      if (!raw) { stat.textContent = ''; return; }

      let date = null;
      let how = '';

      if (/^-?\d+(\.\d+)?$/.test(raw)) {
        let n = Number(raw);
        let u = unit.get();
        if (u === 'auto') {
          // 10 位左右是秒，13 位左右是毫秒；用 1e11 做分界（约公元 5138 年）
          u = Math.abs(n) > 1e11 ? 'ms' : 's';
          how = `按${u === 'ms' ? '毫秒' : '秒'}解析（自动识别）`;
        } else {
          how = `按${u === 'ms' ? '毫秒' : '秒'}解析（手动指定）`;
        }
        date = new Date(u === 'ms' ? n : n * 1000);
      } else {
        const parsed = Date.parse(raw);
        if (Number.isNaN(parsed)) {
          stat.textContent = '无法识别这个输入。可以试试：1700000000、1700000000000、2026-10-10T10:00:00Z、2026-10-10 10:00:00';
          stat.className = 'hint error';
          return;
        }
        date = new Date(parsed);
        how = '按日期字符串解析';
      }

      if (Number.isNaN(date.getTime())) {
        stat.textContent = '这个时间戳超出了可表示范围';
        stat.className = 'hint error';
        return;
      }

      const sec = Math.floor(date.getTime() / 1000);
      const ms = date.getTime();
      const utc = useUtc.get();

      out.append(
        row('Unix 秒', String(sec)),
        row('Unix 毫秒', String(ms)),
        row('本地时间', fmtLocal(date)),
        row('UTC 时间', fmtUtc(date)),
        row('ISO 8601', date.toISOString()),
        row('RFC 2822', date.toUTCString()),
        row('相对现在', rel(Math.floor((Date.now() - ms) / 1000))),
        row('星期', '周' + '日一二三四五六'[utc ? date.getUTCDay() : date.getDay()]),
        row('本年第几天', String(Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000))),
        row('时区偏移', `UTC${-date.getTimezoneOffset() >= 0 ? '+' : ''}${-date.getTimezoneOffset() / 60}`),
      );

      const pattern = fmt.get().trim();
      if (pattern) out.append(row('自定义格式', applyFormat(date, pattern)));

      stat.textContent = `${how} · 当前时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
      stat.className = 'hint ok';
    }

    run();
    return () => { };
  },
};
