import {
  toolPage, el, button, select, note, fieldset, grid, toggle,
  copyWithFeedback, toast, numberInput,
} from '../ui.js';
import { loadCronstrue } from '../lib/scripts.js';

const PRESETS = [
  ['*/5 * * * *', '每 5 分钟'],
  ['0 * * * *', '每小时整点'],
  ['0 9 * * 1-5', '工作日早上 9 点'],
  ['30 2 * * *', '每天凌晨 2:30'],
  ['0 0 1 * *', '每月 1 号零点'],
  ['0 0 * * 0', '每周日零点'],
  ['0 0 1 1 *', '每年 1 月 1 日'],
  ['*/10 9-18 * * 1-5', '工作日 9-18 点每 10 分钟'],
];

/** 解析一个字段成允许值集合 */
function parseField(text, min, max, names) {
  const out = new Set();
  const field = String(text).trim();
  if (!field) throw new Error('字段为空');

  const normalize = (tok) => {
    if (names && names[tok.toLowerCase()] !== undefined) return names[tok.toLowerCase()];
    const n = Number(tok);
    if (!Number.isInteger(n)) throw new Error(`「${tok}」不是合法取值`);
    return n;
  };

  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) throw new Error(`步长「${stepPart}」不合法`);

    let from, to;
    if (rangePart === '*' || rangePart === '?') { from = min; to = max; }
    else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      from = normalize(a); to = normalize(b);
    } else {
      from = to = normalize(rangePart);
    }
    if (from < min || to > max || from > to) {
      throw new Error(`取值 ${rangePart} 超出范围 ${min}-${max}`);
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOWS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new Error(`需要 5 个字段（分 时 日 月 周），带秒则是 6 个；当前是 ${parts.length} 个`);
  }
  const hasSeconds = parts.length === 6;
  const [s, mi, ho, dom, mo, dow] = hasSeconds
    ? parts
    : ['0', parts[0], parts[1], parts[2], parts[3], parts[4]];

  const parsed = {
    hasSeconds,
    second: parseField(s, 0, 59),
    minute: parseField(mi, 0, 59),
    hour: parseField(ho, 0, 23),
    dayOfMonth: parseField(dom, 1, 31),
    month: parseField(mo, 1, 12, MONTHS),
    // 周日既写 0 也写 7，统一成 0
    dayOfWeek: new Set([...parseField(dow, 0, 7, DOWS)].map((d) => (d === 7 ? 0 : d))),
    domRestricted: dom !== '*' && dom !== '?',
    dowRestricted: dow !== '*' && dow !== '?',
  };
  return parsed;
}

export function cronMatches(c, date) {
  if (!c.second.has(date.getSeconds())) return false;
  if (!c.minute.has(date.getMinutes())) return false;
  if (!c.hour.has(date.getHours())) return false;
  if (!c.month.has(date.getMonth() + 1)) return false;

  const domOk = c.dayOfMonth.has(date.getDate());
  const dowOk = c.dayOfWeek.has(date.getDay());
  // 标准 cron 的怪癖：日和周都限定时取「或」，只限定一个时取「与」
  if (c.domRestricted && c.dowRestricted) return domOk || dowOk;
  if (c.domRestricted) return domOk;
  if (c.dowRestricted) return dowOk;
  return true;
}

export function nextRuns(expr, count = 8, from = new Date()) {
  const c = parseCron(expr);
  const stepMs = c.hasSeconds ? 1000 : 60000;
  const out = [];
  // 从下一格开始（当前这一格可能已经过了一半）
  let t = Math.floor(from.getTime() / stepMs) * stepMs + stepMs;
  const limit = t + 366 * 24 * 3600 * 1000 * 4;   // 最多向后找 4 年
  while (out.length < count && t < limit) {
    const d = new Date(t);
    if (cronMatches(c, d)) out.push(new Date(t));
    t += stepMs;
  }
  return out;
}

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ` +
  `周${'日一二三四五六'[d.getDay()]}`;

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'Cron 表达式解析',
      icon: '⏰',
      desc: '解析 5 段（分 时 日 月 周）或 6 段（带秒）的 Cron 表达式，用中文说明含义，并列出接下来若干次执行时间。',
    });

    const input = el('input', { type: 'text', class: 'input mono', value: '*/5 9-18 * * 1-5', placeholder: '*/5 * * * *', 'aria-label': 'Cron 表达式' });
    const descBox = el('div', { class: 'cron-desc' });
    const fieldTable = el('div', { class: 'kv-list' });
    const runList = el('div', { class: 'run-list' });
    const stat = note('');

    const presetSel = select({
      label: '常用示例', value: '',
      options: [['', '— 选一个填入 —'], ...PRESETS.map(([e, d]) => [e, `${e}   ${d}`])],
      onChange: (v) => { if (v) { input.value = v; run(); } },
    });
    const count = numberInput({ label: '预览次数', value: 8, min: 1, max: 50, onChange: run });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Cron 表达式' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } }, presetSel.root),
        descBox,
      ),
      fieldset('选项', count),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '各字段解析结果' }), fieldTable),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '接下来的执行时间' }), runList, stat),
    );
    page.setActions(
      button('复制执行时间', () => {
        const text = [...runList.querySelectorAll('.run-row')].map((r) => r.textContent).join('\n');
        return copyWithFeedback(text, '已复制');
      }, { primary: true }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    async function run() {
      descBox.replaceChildren();
      fieldTable.replaceChildren();
      runList.replaceChildren();
      const expr = input.value.trim();
      if (!expr) {
        stat.textContent = '';
        return;
      }

      let parsed;
      try {
        parsed = parseCron(expr);
      } catch (err) {
        descBox.append(el('p', { class: 'hint error', text: '解析失败：' + err.message }));
        stat.textContent = '';
        return;
      }

      // 中文描述交给 cronstrue（带完整 i18n）
      try {
        const cronstrue = await loadCronstrue();
        descBox.append(el('p', { class: 'cron-text', text: cronstrue.toString(expr, { locale: 'zh_CN', use24HourTimeFormat: true }) }));
      } catch {
        descBox.append(el('p', { class: 'hint', text: '（中文描述模块加载失败，不影响下面的时间计算）' }));
      }

      const setText = (set, base) => [...set].sort((a, b) => a - b)
        .map((v) => (base === 'dow' ? '周' + '日一二三四五六'[v] : String(v)))
        .join(', ');

      const rows = [
        ['秒', parsed.hasSeconds ? setText(parsed.second) : '（未指定，按 0 处理）'],
        ['分钟', setText(parsed.minute)],
        ['小时', setText(parsed.hour)],
        ['日', setText(parsed.dayOfMonth)],
        ['月', setText(parsed.month)],
        ['星期', setText(parsed.dayOfWeek, 'dow')],
        ['日/周组合', parsed.domRestricted && parsed.dowRestricted ? '两者都限定时取「或」关系' : '取「与」关系'],
      ];
      for (const [k, v] of rows) {
        fieldTable.append(el('div', { class: 'kv-row' },
          el('span', { class: 'kv-key', text: k }),
          el('code', { class: 'kv-val', text: v }),
        ));
      }

      const runs = nextRuns(expr, Math.max(1, Math.min(50, Math.round(count.get() || 8))));
      if (!runs.length) {
        runList.append(el('p', { class: 'hint error', text: '未来 4 年内找不到匹配的时间，检查一下表达式（比如 2 月 30 日永远不会到来）' }));
        stat.textContent = '';
        return;
      }
      const now = Date.now();
      runs.forEach((d, i) => {
        const diff = d.getTime() - now;
        runList.append(el('div', { class: 'run-row' },
          el('span', { class: 'run-idx', text: `#${i + 1}` }),
          el('code', { class: 'run-time', text: fmt(d) }),
          el('span', { class: 'run-in', text: `还有 ${humanShort(diff)}` }),
        ));
      });
      stat.textContent = `共 ${runs.length} 次 · 第一次在 ${humanShort(runs[0].getTime() - now)}后`;
      stat.className = 'hint ok';
    }

    function humanShort(ms) {
      const s = Math.max(0, Math.round(ms / 1000));
      if (s < 60) return `${s} 秒`;
      if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
      if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
      return `${Math.floor(s / 86400)} 天 ${Math.floor((s % 86400) / 3600)} 小时`;
    }

    run();
    return () => { };
  },
};
