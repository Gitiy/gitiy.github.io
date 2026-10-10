import {
  toolPage, el, button, note, fieldset, grid, toggle,
  copyWithFeedback, toast, textInput,
} from '../ui.js';
import { base64 } from '../lib/encode-text.js';

const dec = new TextDecoder();
const jsonPretty = (o) => JSON.stringify(o, null, 2);

function b64urlToBytes(seg) {
  return base64.decode(seg);
}

function bytesToB64url(bytes) {
  return base64.encode(bytes, { urlSafe: true, pad: false });
}

/** HS256/384/512 校验签名，走 WebCrypto 的 HMAC */
async function verifySignature(token, secret) {
  const [h, p, s] = token.split('.');
  if (!s) return { ok: false, reason: '这个 token 没有签名段' };
  const header = JSON.parse(dec.decode(b64urlToBytes(h)));
  const alg = header.alg;
  const map = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
  if (!map[alg]) return { ok: false, reason: `本地只支持 HS256/384/512 校验，这个 token 用的是 ${alg}` };

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: map[alg] }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${p}`)));
  const expect = bytesToB64url(sig);
  const got = s.replace(/=+$/, '');
  return { ok: expect === got, reason: expect === got ? `签名有效（${alg}）` : `签名不匹配（${alg}）`, expect, got };
}

function timeStatus(payload) {
  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  const fmt = (t) => new Date(t * 1000).toLocaleString('zh-CN', { hour12: false });
  if (payload.exp != null) {
    rows.push({ key: 'exp 过期时间', value: `${fmt(payload.exp)}（${payload.exp > now ? '还有 ' + human(payload.exp - now) : '已过期 ' + human(now - payload.exp)}）`, bad: payload.exp <= now });
  }
  if (payload.nbf != null) {
    rows.push({ key: 'nbf 生效时间', value: `${fmt(payload.nbf)}（${payload.nbf > now ? '还没生效' : '已生效'}）`, bad: payload.nbf > now });
  }
  if (payload.iat != null) {
    rows.push({ key: 'iat 签发时间', value: `${fmt(payload.iat)}（${human(now - payload.iat)}前）`, bad: false });
  }
  return rows;
}

function human(sec) {
  const s = Math.abs(Math.round(sec));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} 小时`;
  return `${(s / 86400).toFixed(1)} 天`;
}

const CLAIM_NAMES = {
  iss: '签发者', sub: '主体', aud: '受众', exp: '过期时间', nbf: '生效时间',
  iat: '签发时间', jti: '唯一标识', scope: '授权范围', azp: '授权方',
  email: '邮箱', name: '姓名', preferred_username: '用户名', roles: '角色',
};

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'JWT 解码与校验',
      icon: '🎫',
      desc: '拆解 JSON Web Token 的头部与载荷，解析时间类声明，并用密钥校验 HS256/384/512 签名。全程本地，token 不会外发。',
    });

    const input = el('textarea', { class: 'input mono', rows: 6, placeholder: '粘贴 JWT（形如 eyJhbGciOi... 的三段式字符串）…', 'aria-label': 'JWT 输入' });
    const headerBox = el('pre', { class: 'code-block' });
    const payloadBox = el('pre', { class: 'code-block' });
    const claimBox = el('div', { class: 'kv-list' });
    const sigBox = note('');
    const stat = note('等待输入');

    const secret = textInput({ label: '密钥（用于校验 HS 系列签名）', placeholder: '留空则只解码不校验', onChange: () => verify() });
    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'JWT' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例（含可校验的签名）', async () => {
            input.value = await makeSampleToken();
            secret.set(SAMPLE_SECRET);
            run();
          }, { small: true }),
          button('清空', () => { input.value = ''; run(); }, { small: true }),
        ),
      ),
      el('div', { class: 'grid2' },
        el('div', { class: 'card' }, el('p', { class: 'field-hint', text: 'Header' }), headerBox),
        el('div', { class: 'card' }, el('p', { class: 'field-hint', text: 'Payload' }), payloadBox),
      ),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '声明解析' }), claimBox),
      fieldset('签名校验', secret),
      el('div', { class: 'card' }, sigBox, stat),
    );
    page.setActions(
      button('复制 Payload', () => copyWithFeedback(payloadBox.textContent, '已复制'), { primary: true }),
      button('复制 Header', () => copyWithFeedback(headerBox.textContent, '已复制')),
    );
    app.main.append(page.root);

    let parsedToken = null;
    input.addEventListener('input', run);

    function run() {
      headerBox.textContent = '';
      payloadBox.textContent = '';
      claimBox.replaceChildren();
      sigBox.textContent = '';
      sigBox.className = 'hint';

      const raw = input.value.trim();
      if (!raw) {
        stat.textContent = '等待输入';
        stat.className = 'hint';
        parsedToken = null;
        return;
      }

      const parts = raw.split('.');
      if (parts.length < 2) {
        stat.textContent = '不是合法的 JWT：至少要有「头部.载荷」两段（用 . 分隔）';
        stat.className = 'hint error';
        return;
      }

      let header, payload;
      try {
        header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
      } catch (err) {
        stat.textContent = '头部解析失败：' + err.message;
        stat.className = 'hint error';
        return;
      }
      try {
        payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
      } catch {
        // payload 可能不是 JSON（JWE 之类的加密内容）
        payload = null;
      }

      headerBox.textContent = jsonPretty(header);
      payloadBox.textContent = payload ? jsonPretty(payload) : '（载荷不是 JSON，可能是加密的 JWE）';

      if (payload) {
        for (const r of timeStatus(payload)) {
          claimBox.append(el('div', { class: 'kv-row' },
            el('span', { class: 'kv-key', text: r.key }),
            el('code', { class: 'kv-val' + (r.bad ? ' bad' : ''), text: r.value }),
          ));
        }
        for (const [k, v] of Object.entries(payload)) {
          if (['exp', 'nbf', 'iat'].includes(k)) continue;
          const name = CLAIM_NAMES[k];
          claimBox.append(el('div', { class: 'kv-row' },
            el('span', { class: 'kv-key', text: name ? `${k}（${name}）` : k }),
            el('code', { class: 'kv-val', text: typeof v === 'object' ? JSON.stringify(v) : String(v) }),
          ));
        }
      }

      parsedToken = { header, payload, parts };
      stat.textContent = `算法 ${header.alg || '未知'} · ${header.typ || '无 typ'} · ${parts.length} 段`;
      stat.className = 'hint ok';
      verify();
    }

    async function verify() {
      if (!parsedToken) return;
      const s = secret.get().trim();
      if (!s) { sigBox.textContent = '填入密钥可校验签名'; sigBox.className = 'hint'; return; }
      try {
        const r = await verifySignature(input.value.trim(), s);
        sigBox.textContent = r.reason + (r.ok ? '' : `\n期望：${r.expect}\n实际：${r.got}`);
        sigBox.className = 'hint ' + (r.ok ? 'ok' : 'error');
      } catch (err) {
        sigBox.textContent = '校验失败：' + err.message;
        sigBox.className = 'hint error';
      }
    }

    run();
    return () => { };
  },
};

/** 用 HS256 签一个 token —— 示例 token 由它现场生成，保证签名一定能校验通过 */
async function signHS256(header, payload, secret) {
  const enc = new TextEncoder();
  const seg = (o) => bytesToB64url(enc.encode(JSON.stringify(o)));
  const h = seg(header);
  const p = seg(payload);
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${bytesToB64url(sig)}`;
}

const SAMPLE_SECRET = 'scanlike-demo';

async function makeSampleToken() {
  return signHS256(
    { alg: 'HS256', typ: 'JWT' },
    {
      sub: '1234567890',
      name: 'demo-user',
      email: 'user@example.com',
      roles: ['admin', 'user'],
      iss: 'scanlike-demo',
      iat: 1700000000,
      exp: 2000000000,
    },
    SAMPLE_SECRET,
  );
}
