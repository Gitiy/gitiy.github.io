import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  copyWithFeedback, toast, numberInput, textInput,
} from '../ui.js';
import { base64 } from '../lib/encode-text.js';
import { download, stamp } from '../lib/files.js';

/** ArrayBuffer → PEM（每 64 字符换行，标准 PEM 格式） */
function pem(bytes, label) {
  const b64 = base64.encode(bytes);
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

const ALGOS = {
  'RSA-OAEP': {
    label: 'RSA（加密 / OAEP）',
    sizes: [2048, 3072, 4096],
    make: (size) => ({
      generateKey: { name: 'RSA-OAEP', modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      usages: ['encrypt', 'decrypt'],
      note: '用于加密小段数据或封装对称密钥。',
    }),
  },
  'RSASSA-PKCS1-v1_5': {
    label: 'RSA（签名 / PKCS#1 v1.5）',
    sizes: [2048, 3072, 4096],
    make: (size) => ({
      generateKey: { name: 'RSASSA-PKCS1-v1_5', modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      usages: ['sign', 'verify'],
      note: '兼容性最好的签名算法，老系统基本都支持。',
    }),
  },
  'ECDSA-P256': {
    label: 'ECDSA（P-256）',
    sizes: [256],
    make: () => ({
      generateKey: { name: 'ECDSA', namedCurve: 'P-256' },
      usages: ['sign', 'verify'],
      note: '密钥短、签名快，现代系统的默认选择。',
    }),
  },
  'ECDSA-P384': {
    label: 'ECDSA（P-384）',
    sizes: [384],
    make: () => ({
      generateKey: { name: 'ECDSA', namedCurve: 'P-384' },
      usages: ['sign', 'verify'],
      note: '安全强度更高，签名也更长。',
    }),
  },
  'Ed25519': {
    label: 'Ed25519',
    sizes: [256],
    make: () => ({
      generateKey: { name: 'Ed25519' },
      usages: ['sign', 'verify'],
      note: '最快的签名算法，密钥只有 32 字节。需要较新的浏览器。',
    }),
  },
  'ECDH-P256': {
    label: 'ECDH（P-256，密钥协商）',
    sizes: [256],
    make: () => ({
      generateKey: { name: 'ECDH', namedCurve: 'P-256' },
      usages: ['deriveKey', 'deriveBits'],
      note: '用于双方协商出共享密钥，本身不做签名。',
    }),
  },
};

export const tool = {
  init(app) {
    const page = toolPage({
      title: '密钥对生成',
      icon: '🔑',
      desc: '在浏览器里生成 RSA / ECDSA / Ed25519 / ECDH 密钥对，导出 PEM 与 JWK。私钥始终只在本机内存里。',
    });

    const algo = select({
      label: '算法', value: 'ECDSA-P256',
      options: Object.entries(ALGOS).map(([k, v]) => [k, v.label]),
      onChange: sync,
    });
    const size = select({
      label: '密钥长度', value: '2048',
      options: [['2048', '2048 位'], ['3072', '3072 位'], ['4096', '4096 位']],
      onChange: run,
    });
    const fmtSel = select({
      label: '导出格式', value: 'pem',
      options: [['pem', 'PEM（-----BEGIN…）'], ['jwk', 'JWK（JSON）'], ['both', '两者都要']],
      onChange: () => { if (lastKeys) render(); },
    });
    const passphrase = textInput({
      label: '私钥口令（可选）', value: '',
      hint: '留空则导出未加密的 PKCS#8。浏览器 WebCrypto 不支持 PEM 口令加密，填了只会在输出里标注提醒。',
      onChange: () => { if (lastKeys) render(); },
    });

    const out = el('div', { class: 'key-out' });
    const stat = note('点「生成密钥对」开始');

    page.add(
      fieldset('算法与格式', algo, size, fmtSel, passphrase),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '密钥对' }), out, stat),
      el('div', { class: 'card' },
        el('p', { class: 'field-hint', text: '安全提示' }),
        el('p', { class: 'hint', text: '密钥由浏览器的 WebCrypto 生成，随机源来自操作系统。私钥不会离开本机，也不会被保存 —— 刷新页面就没了，请及时复制或下载。生产环境请使用 openssl 或云 KMS 生成并妥善保管。' }),
      ),
    );
    page.setActions(
      button('生成密钥对', run, { primary: true }),
      button('下载全部', () => {
        if (!lastKeys) { toast('先生成密钥对', 'error'); return; }
        download(new Blob([lastKeys.text], { type: 'text/plain;charset=utf-8' }), `密钥对_${stamp()}.txt`);
        toast('已下载（注意妥善保管）', 'ok');
      }),
      button('只复制公钥', () => {
        if (!lastKeys) { toast('先生成密钥对', 'error'); return; }
        return copyWithFeedback(lastKeys.publicText, '公钥已复制');
      }),
    );
    app.main.append(page.root);

    let lastKeys = null;

    function sync() {
      const a = ALGOS[algo.get()];
      const isRsa = a.sizes.length > 1;
      size.root.classList.toggle('hidden', !isRsa);
      if (isRsa) {
        size.node.replaceChildren();
        for (const s of a.sizes) size.node.append(el('option', { value: String(s), text: `${s} 位` }));
        size.node.value = String(a.sizes[0]);
      }
    }

    async function run() {
      const a = ALGOS[algo.get()];
      // RSA 用下拉框选的位数；椭圆曲线固定位数，不能沿用下拉框里残留的 2048
      const isRsa = a.sizes.length > 1;
      const keySize = isRsa ? (Number(size.get()) || a.sizes[0]) : a.sizes[0];
      const spec = a.make(keySize);

      stat.textContent = `正在生成 ${a.label}${isRsa ? `（${keySize} 位）` : ''}…`;
      stat.className = 'hint';
      out.replaceChildren();
      const t0 = performance.now();

      try {
        const pair = await crypto.subtle.generateKey(spec.generateKey, true, spec.usages);
        const ms = performance.now() - t0;

        const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
        const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
        const jwkPub = await crypto.subtle.exportKey('jwk', pair.publicKey);
        const jwkPriv = await crypto.subtle.exportKey('jwk', pair.privateKey);

        lastKeys = {
          algo: a.label,
          size: keySize,
          isRsa,
          note: spec.note,
          ms,
          publicPem: pem(new Uint8Array(spki), 'PUBLIC KEY'),
          privatePem: pem(new Uint8Array(pkcs8), 'PRIVATE KEY'),
          publicJwk: JSON.stringify(jwkPub, null, 2),
          privateJwk: JSON.stringify(jwkPriv, null, 2),
        };
        lastKeys.publicText = lastKeys.publicPem;
        lastKeys.text = [
          `# ${a.label}${isRsa ? ' · ' + keySize + ' 位' : ''} · 生成耗时 ${ms.toFixed(0)} ms`,
          `# 生成时间 ${new Date().toISOString()}`,
          '',
          '## 公钥（PEM）', lastKeys.publicPem, '',
          '## 私钥（PEM，未加密）', lastKeys.privatePem, '',
          '## 公钥（JWK）', lastKeys.publicJwk, '',
          '## 私钥（JWK）', lastKeys.privateJwk, '',
        ].join('\n');

        render();
        stat.textContent = `已生成 ${a.label}${isRsa ? ` · ${keySize} 位` : ''} · 耗时 ${ms.toFixed(0)} ms`;
        stat.className = 'hint ok';
      } catch (err) {
        stat.textContent = `生成失败：${err.message}${/Ed25519/.test(a.label) ? '（这个浏览器可能还不支持 Ed25519，换 ECDSA 试试）' : ''}`;
        stat.className = 'hint error';
      }
    }

    function block(title, text, warn) {
      // 注意：textarea 的内容不能用 setAttribute('value') 设置，必须赋给 .value 属性
      const area = el('textarea', {
        class: 'input mono', rows: warn ? 10 : 6, readonly: true, spellcheck: 'false',
        'aria-label': title,
      });
      area.value = text;
      return el('div', { class: 'key-block' },
        el('div', { class: 'row' },
          el('p', { class: 'field-hint' + (warn ? ' warn' : ''), text: title }),
          el('span', { class: 'grow' }),
          button('复制', () => copyWithFeedback(text, title + ' 已复制'), { small: true }),
        ),
        area,
      );
    }

    function render() {
      if (!lastKeys) return;
      const mode = fmtSel.get();
      const pw = passphrase.get().trim();
      out.replaceChildren();

      const sizeText = lastKeys.isRsa ? ` · ${lastKeys.size} 位` : '';
      out.append(el('p', { class: 'hint', text: `${lastKeys.algo}${sizeText} · ${lastKeys.note}` }));

      if (mode === 'pem' || mode === 'both') {
        out.append(block('公钥（SPKI PEM）', lastKeys.publicPem, false));
        out.append(block('私钥（PKCS#8 PEM）', lastKeys.privatePem, true));
      }
      if (mode === 'jwk' || mode === 'both') {
        out.append(block('公钥（JWK）', lastKeys.publicJwk, false));
        out.append(block('私钥（JWK）', lastKeys.privateJwk, true));
      }
      if (pw) {
        out.append(el('p', { class: 'hint warn', text: '注意：浏览器 WebCrypto 不支持给 PEM 私钥加口令。你填的口令不会生效，导出的是未加密私钥。需要加密的话请用 openssl：openssl pkcs8 -topk8 -in key.pem -out enc.pem' }));
      }
    }

    sync();
    stat.textContent = '选好算法后点「生成密钥对」（RSA 4096 大约需要 1–3 秒）';
    return () => { };
  },
};
