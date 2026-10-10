import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  copyWithFeedback, toast, numberInput,
} from '../ui.js';
import { download, stamp } from '../lib/files.js';

const hex = (n, pad) => n.toString(16).padStart(pad, '0');
const rnd = (n) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

/* ---------------- UUID ---------------- */

function uuidV4() {
  const b = rnd(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmtUuid(b);
}

/** v1：时间戳 + 随机节点号（不用真实 MAC，避免泄露设备信息） */
function uuidV1() {
  const b = rnd(16);
  // 100 纳秒间隔，从 1582-10-15 起算
  const gregorian = (Date.now() + 12219292800000) * 10000;
  const timeLow = gregorian % 0x100000000;
  const timeMid = Math.floor(gregorian / 0x100000000) % 0x10000;
  const timeHi = Math.floor(gregorian / 0x1000000000000) % 0x1000;

  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, timeLow, false);
  dv.setUint16(4, timeMid, false);
  dv.setUint16(6, (timeHi & 0x0fff) | 0x1000, false);
  out[8] = (b[8] & 0x3f) | 0x80;
  out.set(b.slice(9, 15), 9);
  out[15] = b[15];
  return fmtUuid(out);
}

/** v7：前 48 位是毫秒时间戳，天然按时间递增，适合做数据库主键 */
function uuidV7() {
  const b = rnd(16);
  const ms = Date.now();
  b[0] = (ms / 0x10000000000) & 0xff;
  b[1] = (ms / 0x100000000) & 0xff;
  b[2] = (ms / 0x1000000) & 0xff;
  b[3] = (ms / 0x10000) & 0xff;
  b[4] = (ms / 0x100) & 0xff;
  b[5] = ms & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmtUuid(b);
}

function fmtUuid(b) {
  const s = [...b].map((x) => hex(x, 2)).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ---------------- ULID ---------------- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid() {
  const out = new Array(26);
  let time = Date.now();
  for (let i = 9; i >= 0; i--) { out[i] = CROCKFORD[time % 32]; time = Math.floor(time / 32); }
  const r = rnd(16);
  for (let i = 0; i < 16; i++) out[10 + i] = CROCKFORD[r[i] % 32];
  return out.join('');
}

/* ---------------- NanoID ---------------- */

const NANO_DEFAULT = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

function nanoid(size = 21, alphabet = NANO_DEFAULT) {
  const mask = (2 << Math.floor(Math.log2(alphabet.length - 1))) - 1;
  const step = Math.ceil((1.6 * mask * size) / alphabet.length);
  let id = '';
  while (id.length < size) {
    const bytes = rnd(step);
    for (let i = 0; i < step && id.length < size; i++) {
      const idx = bytes[i] & mask;
      if (idx < alphabet.length) id += alphabet[idx];
    }
  }
  return id;
}

/* ---------------- 短 ID（类雪花） ---------------- */

function shortId(len = 12) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = rnd(len);
  return [...b].map((x) => A[x % A.length]).join('');
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'UUID / ULID 生成',
      icon: '🆔',
      desc: '批量生成 UUID v4 / v7 / v1、ULID、NanoID、短 ID，并可校验已有 UUID 的格式与版本。',
    });

    const kind = select({
      label: '类型', value: 'v4',
      options: [
        ['v4', 'UUID v4 —— 完全随机，最常用'],
        ['v7', 'UUID v7 —— 带时间戳，按时间递增，适合做主键'],
        ['v1', 'UUID v1 —— 时间戳 + 随机节点'],
        ['ulid', 'ULID —— 26 位，按时间递增，可排序'],
        ['nanoid', 'NanoID —— 21 位 URL 安全字符串'],
        ['short', '短 ID —— 12 位，去掉了易混字符'],
      ],
      onChange: run,
    });
    const count = numberInput({ label: '生成数量', value: 10, min: 1, max: 1000, onChange: run });
    const upper = toggle({ label: '转成大写', value: false, onChange: () => render() });
    const noDash = toggle({ label: '去掉 UUID 里的短横线', value: false, onChange: () => render() });
    const unique = toggle({ label: '保证互不重复', value: true, onChange: run });

    const out = el('textarea', { class: 'input mono', rows: 14, readonly: true, 'aria-label': '生成结果' });
    const stat = note('等待生成');

    const checkInput = el('input', { type: 'text', class: 'input mono', placeholder: '粘贴一个 UUID 校验格式与版本…' });
    const checkOut = note('');

    page.add(
      fieldset('生成选项', kind, grid(count, upper), grid(noDash, unique)),
      el('div', { class: 'card' },
        el('p', { class: 'field-hint', text: '生成结果' }),
        out, stat,
      ),
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'UUID 校验' }), checkInput),
        checkOut,
      ),
    );
    page.setActions(
      button('重新生成', run, { primary: true }),
      button('复制全部', () => copyWithFeedback(out.value, '已复制')),
      button('导出 txt', () => {
        if (!out.value) { toast('还没有结果', 'error'); return; }
        download(new Blob([out.value], { type: 'text/plain' }), `uuid_${stamp()}.txt`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    let items = [];

    function render() {
      const up = upper.get();
      const strip = noDash.get() && kind.get().startsWith('v');
      const shown = items.map((s) => {
        let v = strip ? s.replace(/-/g, '') : s;
        return up ? v.toUpperCase() : v;
      });
      out.value = shown.join('\n');
    }

    function run() {
      const n = Math.max(1, Math.min(1000, Math.round(count.get() || 1)));
      const k = kind.get();
      const set = new Set();
      const gen = () => {
        switch (k) {
          case 'v4': return uuidV4();
          case 'v7': return uuidV7();
          case 'v1': return uuidV1();
          case 'ulid': return ulid();
          case 'nanoid': return nanoid();
          case 'short': return shortId();
          default: return uuidV4();
        }
      };

      const dedupe = unique.get();
      let guard = 0;
      while (set.size < n && guard < n * 20) { set.add(gen()); guard++; }
      items = [...set].slice(0, n);

      render();
      const len = items[0]?.length ?? 0;
      stat.textContent = `已生成 ${items.length} 个 · 每个 ${len} 字符 · ${k.toUpperCase()}`;
      stat.className = 'hint ok';
    }

    checkInput.addEventListener('input', () => {
      const v = checkInput.value.trim();
      if (!v) { checkOut.textContent = ''; checkOut.className = 'hint'; return; }
      const m = v.match(UUID_RE);
      if (m) {
        const ver = m[1];
        const names = { 1: 'v1（时间戳 + 节点）', 2: 'v2（DCE 安全）', 3: 'v3（MD5 命名空间）', 4: 'v4（随机）', 5: 'v5（SHA-1 命名空间）', 6: 'v6（重排的时间戳）', 7: 'v7（Unix 时间戳）', 8: 'v8（自定义）' };
        checkOut.textContent = `格式有效 · 版本 ${names[ver] || ver} · 变体 RFC 4122`;
        checkOut.className = 'hint ok';
      } else if (/^[0-9a-f-]+$/i.test(v.replace(/\s/g, '')) && v.replace(/\s/g, '').length === 36) {
        checkOut.textContent = '看起来像 UUID，但格式不合规（第 13 位应为版本号 1-8，第 17 位应为 8/9/a/b）';
        checkOut.className = 'hint error';
      } else {
        checkOut.textContent = '不是合法的 UUID';
        checkOut.className = 'hint error';
      }
    });

    run();
    return () => { };
  },
};
