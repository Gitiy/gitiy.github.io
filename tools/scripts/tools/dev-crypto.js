import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  copyWithFeedback, toast, textInput, numberInput,
} from '../ui.js';
import { base64 } from '../lib/encode-text.js';
import { md5 } from '../lib/hash.js';

const MAGIC = 'SLK1';
const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 输出格式：SLK1.<迭代次数>.<salt>.<iv>.<密文>
 * 把参数写进密文里，解密时不需要用户记住当初的设置。
 */
export async function encryptText(plain, password, iterations = 250000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return [
    MAGIC,
    String(iterations),
    base64.encode(salt, { urlSafe: true, pad: false }),
    base64.encode(iv, { urlSafe: true, pad: false }),
    base64.encode(ct, { urlSafe: true, pad: false }),
  ].join('.');
}

export async function decryptText(payload, password) {
  const parts = payload.trim().split('.');
  if (parts.length !== 5 || parts[0] !== MAGIC) {
    throw new Error('格式不对：应该是 SLK1.迭代次数.salt.iv.密文 这样五段');
  }
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000) throw new Error('迭代次数异常，密文可能已损坏');
  const salt = base64.decode(parts[2]);
  const iv = base64.decode(parts[3]);
  const ct = base64.decode(parts[4]);
  const key = await deriveKey(password, salt, iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  } catch {
    // GCM 校验失败 = 密码错或密文被改过，两者在密码学上无法区分
    throw new Error('解密失败：密码不对，或者密文被修改过');
  }
}

/** 简单混淆（不是加密，只防肉眼误读） */
const rot13 = (s) => s.replace(/[a-zA-Z]/g, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});

export const tool = {
  init(app) {
    const page = toolPage({
      title: '文本加解密',
      icon: '🔐',
      desc: '用 AES-256-GCM 加密文本，密钥由 PBKDF2 从密码派生。加密结果自带盐值与参数，换台机器也能解开。也提供 MD5 摘要与 ROT13 混淆这类轻量手段。',
    });

    const input = el('textarea', { class: 'input mono', rows: 7, placeholder: '要加密的明文，或要解密的密文…', 'aria-label': '输入' });
    const output = el('textarea', { class: 'input mono', rows: 7, readonly: true, 'aria-label': '输出' });
    const stat = note('');

    const password = el('input', { type: 'password', class: 'input', placeholder: '密码 / 口令', 'aria-label': '密码' });
    const showPw = toggle({ label: '显示密码', value: false, onChange: (v) => { password.type = v ? 'text' : 'password'; } });
    const iterations = numberInput({
      label: 'PBKDF2 迭代次数', value: 250000, min: 1000, max: 2000000, step: 10000,
      hint: '越高越难被暴力破解，但解密也更慢。25 万次在现代设备上约需 0.2 秒。',
    });

    const mode = select({
      label: '模式', value: 'aes',
      options: [
        ['aes', 'AES-256-GCM 加解密'],
        ['md5', 'MD5 摘要（不可逆，仅校验）'],
        ['rot13', 'ROT13 混淆（不是加密）'],
      ],
      onChange: () => run(),
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '输入' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = ''; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('密钥与参数',
        el('div', { class: 'card' },
          el('label', { class: 'field' }, el('span', { class: 'field-label', text: '密码' }), password),
          showPw.root,
        ),
        grid(mode, iterations),
      ),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '输出' }), output, stat),
    );
    page.setActions(
      button('加密', () => run('encrypt'), { primary: true }),
      button('解密', () => run('decrypt')),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
    );
    app.main.append(page.root);

    async function run(direction) {
      const text = input.value;
      if (!text.trim()) { output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; return; }

      const m = mode.get();

      if (m === 'md5') {
        output.value = md5(text);
        stat.textContent = 'MD5 摘要（32 位十六进制）· 摘要不可逆，不能还原原文';
        stat.className = 'hint ok';
        return;
      }

      if (m === 'rot13') {
        output.value = rot13(text);
        stat.textContent = 'ROT13 只是字符位移，任何人都能还原，不要用来保护敏感内容';
        stat.className = 'hint warn';
        return;
      }

      const pw = password.value;
      if (!pw) { toast('请先输入密码', 'error'); return; }

      // 没指定方向时：能识别出密文格式就解密，否则加密
      const dir = direction || (/^SLK1\./.test(text.trim()) ? 'decrypt' : 'encrypt');

      try {
        if (dir === 'encrypt') {
          const t0 = performance.now();
          const out = await encryptText(text, pw, Math.round(iterations.get() || 250000));
          const ms = performance.now() - t0;
          output.value = out;
          stat.textContent = `已加密 · 密文 ${out.length} 字符 · 耗时 ${ms.toFixed(0)} ms · 参数已写入密文开头`;
        } else {
          const t0 = performance.now();
          const out = await decryptText(text, pw);
          const ms = performance.now() - t0;
          output.value = out;
          stat.textContent = `已解密 · 明文 ${out.length} 字符 · 耗时 ${ms.toFixed(0)} ms`;
        }
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = err.message;
        stat.className = 'hint error';
      }
    }

    return () => { };
  },
};
