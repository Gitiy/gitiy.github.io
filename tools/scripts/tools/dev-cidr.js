import {
  toolPage, el, button, note, grid, fieldset, select,
  copyWithFeedback, toast, textInput,
} from '../ui.js';

const toInt = (ip) => ip.split('.').reduce((acc, o) => (acc * 256 + Number(o)) >>> 0, 0) >>> 0;
const toIp = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const bin = (n) => (n >>> 0).toString(2).padStart(32, '0');

function validIp(s) {
  const parts = String(s).trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/** 私网与特殊网段判断 */
function classify(n) {
  const tags = [];
  const a = (n >>> 24) & 255;
  const b = (n >>> 16) & 255;

  if (a === 10) tags.push('私有（10.0.0.0/8）');
  if (a === 172 && b >= 16 && b <= 31) tags.push('私有（172.16.0.0/12）');
  if (a === 192 && b === 168) tags.push('私有（192.168.0.0/16）');
  if (a === 127) tags.push('回环地址');
  if (a === 169 && b === 254) tags.push('链路本地（APIPA）');
  if (a === 100 && b >= 64 && b <= 127) tags.push('运营商级 NAT（100.64.0.0/10）');
  if (a === 224 || (a >= 224 && a <= 239)) tags.push('组播');
  if (a >= 240) tags.push('保留');
  if (a === 0) tags.push('本网络');
  if (a === 255 && b === 255) tags.push('广播');
  if (a < 128) tags.push('A 类');
  else if (a < 192) tags.push('B 类');
  else if (a < 224) tags.push('C 类');
  if (!tags.some((t) => t.includes('私有'))) tags.push('公网可路由');
  return tags;
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'CIDR / 子网计算',
      icon: '🌐',
      desc: '输入 CIDR 或「IP + 掩码」，算出网络地址、广播地址、可用主机范围、掩码写法，并给出二进制视图。',
    });

    const input = el('input', { type: 'text', class: 'input mono', value: '192.168.1.10/24', placeholder: '192.168.1.0/24 或 10.0.0.1 255.255.255.0', 'aria-label': 'CIDR' });
    const out = el('div', { class: 'kv-list' });
    const binView = el('pre', { class: 'bit-view' });
    const stat = note('');

    const modeSel = select({
      label: '输入形式', value: 'cidr',
      options: [['cidr', 'CIDR（IP/前缀长度）'], ['mask', 'IP + 点分十进制掩码'], ['wildcard', 'IP + 通配符掩码']],
      onChange: run,
    });
    const second = textInput({
      label: '掩码（后两种形式需要）', value: '255.255.255.0',
      placeholder: '255.255.255.0 或 0.0.0.255',
      onChange: run,
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '网络' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('10.0.0.1/8', () => { modeSel.set('cidr'); input.value = '10.0.0.1/8'; run(); }, { small: true }),
          button('172.16.5.5/20', () => { modeSel.set('cidr'); input.value = '172.16.5.5/20'; run(); }, { small: true }),
          button('192.168.1.0/26', () => { modeSel.set('cidr'); input.value = '192.168.1.0/26'; run(); }, { small: true }),
        ),
      ),
      fieldset('输入形式', modeSel, second),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '计算结果' }), out),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '二进制视图' }), binView, stat),
    );
    page.setActions(
      button('复制结果', () => {
        const text = [...out.querySelectorAll('.kv-row')]
          .map((r) => `${r.querySelector('.kv-key').textContent.padEnd(16)} ${r.querySelector('.kv-val').textContent}`)
          .join('\n');
        return copyWithFeedback(text, '已复制');
      }, { primary: true }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    function row(key, value) {
      return el('div', { class: 'kv-row' },
        el('span', { class: 'kv-key', text: key }),
        el('code', { class: 'kv-val', text: value }),
        button('复制', () => copyWithFeedback(value, '已复制'), { small: true }),
      );
    }

    function run() {
      out.replaceChildren();
      binView.textContent = '';
      const raw = input.value.trim();
      if (!raw) { stat.textContent = ''; return; }

      let ipStr = raw;
      let prefix = null;
      const mode = modeSel.get();

      if (raw.includes('/')) {
        const [a, b] = raw.split('/');
        ipStr = a.trim();
        prefix = Number(b);
        if (mode === 'cidr' && !Number.isInteger(prefix)) prefix = null;
      } else if (mode === 'cidr') {
        stat.textContent = 'CIDR 形式要写成 192.168.1.0/24 这样';
        stat.className = 'hint error';
        return;
      }

      if (!validIp(ipStr)) {
        stat.textContent = `「${ipStr}」不是合法的 IPv4 地址（需要四段 0-255 的数字）`;
        stat.className = 'hint error';
        return;
      }

      // 由掩码推算前缀长度
      if (prefix === null && (mode === 'mask' || mode === 'wildcard')) {
        const m = second.get().trim();
        if (!validIp(m)) {
          stat.textContent = `掩码「${m}」不是合法的 IPv4 形式`;
          stat.className = 'hint error';
          return;
        }
        let maskInt = toInt(m);
        if (mode === 'wildcard') maskInt = (~maskInt) >>> 0;
        // 掩码必须是连续的 1
        const bits = bin(maskInt);
        if (!/^1*0*$/.test(bits)) {
          stat.textContent = `掩码 ${m} 的二进制不是连续的 1（${bits}），这不是合法的子网掩码`;
          stat.className = 'hint error';
          return;
        }
        prefix = bits.split('0')[0].length;
      }

      if (prefix === null || prefix < 0 || prefix > 32) {
        stat.textContent = '前缀长度要在 0 到 32 之间';
        stat.className = 'hint error';
        return;
      }

      const ipInt = toInt(ipStr);
      const maskInt = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
      const wildcardInt = (~maskInt) >>> 0;
      const netInt = (ipInt & maskInt) >>> 0;
      const bcastInt = (netInt | wildcardInt) >>> 0;

      const total = 2 ** (32 - prefix);
      const usable = prefix >= 31 ? total : total - 2;
      const firstHost = prefix >= 31 ? netInt : netInt + 1;
      const lastHost = prefix >= 31 ? bcastInt : bcastInt - 1;

      out.append(
        row('网络地址', `${toIp(netInt)}/${prefix}`),
        row('广播地址', toIp(bcastInt)),
        row('子网掩码', toIp(maskInt)),
        row('通配符掩码', toIp(wildcardInt)),
        row('可用主机范围', `${toIp(firstHost)} – ${toIp(lastHost)}`),
        row('可用主机数', usable.toLocaleString('en-US')),
        row('地址总数', total.toLocaleString('en-US')),
        row('输入的 IP', `${toIp(ipInt)}${ipInt === netInt ? '（就是网络地址）' : ipInt === bcastInt ? '（是广播地址）' : ''}`),
        row('地址类型', classify(netInt).join('、')),
        row('反向解析名', `${[...toIp(netInt).split('.').reverse()].join('.')}.in-addr.arpa`),
        row('十六进制', '0x' + netInt.toString(16).padStart(8, '0')),
      );

      const ipBin = bin(ipInt);
      const mkBin = bin(maskInt);
      binView.textContent = [
        `IP       ${ipBin.match(/.{8}/g).join(' . ')}   ${toIp(ipInt)}`,
        `掩码     ${mkBin.match(/.{8}/g).join(' . ')}   ${toIp(maskInt)}   /${prefix}`,
        `         ${mkBin.replace(/1/g, '^').replace(/0/g, ' ')}`,
        `网络     ${bin(netInt).match(/.{8}/g).join(' . ')}   ${toIp(netInt)}`,
        `广播     ${bin(bcastInt).match(/.{8}/g).join(' . ')}   ${toIp(bcastInt)}`,
      ].join('\n');

      stat.textContent = `/${prefix} · 每个子网 ${total.toLocaleString('en-US')} 个地址，可用 ${usable.toLocaleString('en-US')} 个`
        + (prefix >= 31 ? '（/31 与 /32 是点对点与单机场景，没有网络号与广播号的保留）' : '');
      stat.className = 'hint ok';
    }

    run();
    return () => { };
  },
};
