import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  copyWithFeedback, toast, fileZone, textInput,
} from '../ui.js';
import { ALGORITHMS, hash, hashAll } from '../lib/hash.js';
import { download, fmtBytes, stamp } from '../lib/files.js';

/** HMAC 走 WebCrypto，只支持 SHA 系列 */
const HMAC_ALGOS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

async function hmac(key, data, algoName) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: algoName }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: '哈希与校验和',
      icon: '#️⃣',
      desc: 'MD5、SHA-1/256/384/512、SHA-3、Keccak-256、RIPEMD-160、CRC-32、Adler-32，支持文本与文件，还能算 HMAC。',
    });

    const input = el('textarea', { class: 'input mono', rows: 8, placeholder: '输入要计算哈希的文本…', 'aria-label': '文本输入' });
    const result = el('div', { class: 'hash-list' });
    const stat = note('等待输入');

    const onlyCommon = toggle({ label: '只看常用算法', value: false, onChange: run });
    const upperCase = toggle({ label: '输出大写', value: false, onChange: () => render() });
    const hmacKey = textInput({ label: 'HMAC 密钥（留空则不计算 HMAC）', placeholder: '选填', onChange: run });
    const hmacAlgo = select({
      label: 'HMAC 算法', value: 'SHA-256',
      options: HMAC_ALGOS.map((a) => [a, a]),
      onChange: run,
    });

    let lastResults = [];
    let fileTarget = null;   // 拖入文件后优先算文件的哈希

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '输入内容' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('清空', () => { input.value = ''; run(); }, { small: true }),
        ),
      ),
      el('div', { class: 'card' },
        el('p', { class: 'field-hint', text: '文件哈希' }),
        fileZone({
          title: '拖入文件计算哈希',
          hint: '大文件也能算，全程在本机读取',
          icon: '📦',
          multiple: false,
          onFiles: async ([f]) => {
            const buf = new Uint8Array(await f.arrayBuffer());
            fileTarget = { name: f.name, bytes: buf };
            stat.textContent = `已读入 ${f.name}（${fmtBytes(f.size)}）`;
            stat.className = 'hint ok';
            await run();
          },
        }).root,
      ),
      fieldset('选项', grid(onlyCommon, upperCase), grid(hmacKey, hmacAlgo)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '计算结果' }), result, stat),
    );
    page.setActions(
      button('复制全部', async () => {
        if (!lastResults.length) { toast('还没有结果', 'error'); return; }
        const text = lastResults.map((r) => `${r.label.padEnd(12)} ${r.hex}`).join('\n');
        await copyWithFeedback(text, '已复制全部结果');
      }, { primary: true }),
      button('导出 txt', () => {
        if (!lastResults.length) { toast('还没有结果', 'error'); return; }
        const text = lastResults.map((r) => `${r.label.padEnd(12)} ${r.hex}`).join('\n');
        download(new Blob([text], { type: 'text/plain' }), `哈希结果_${stamp()}.txt`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    function render() {
      const up = upperCase.get();
      result.replaceChildren();
      if (!lastResults.length) {
        result.append(el('p', { class: 'hint', text: '暂无结果' }));
        return;
      }
      for (const r of lastResults) {
        const shown = up ? r.hex.toUpperCase() : r.hex;
        const row = el('div', { class: 'hash-row' },
          el('span', { class: 'hash-name', text: r.label }),
          el('code', { class: 'hash-value', text: shown, title: shown }),
          button('复制', async () => {
            const { copyText } = await import('../ui.js');
            const ok = await copyText(shown);
            toast(ok ? `${r.label} 已复制` : '复制失败', ok ? 'ok' : 'error');
          }, { small: true }),
        );
        result.append(row);
      }
    }

    async function run() {
      const bytes = fileTarget ? fileTarget.bytes : new TextEncoder().encode(input.value);
      if (!bytes.length) {
        lastResults = [];
        render();
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      const want = ALGORITHMS.filter((a) => !onlyCommon.get() || ['md5', 'sha1', 'sha256', 'sha512'].includes(a.id));
      const out = [];
      for (const a of want) {
        try {
          out.push({ algo: a.id, label: a.label, hex: await hash(bytes, a.id) });
        } catch (err) {
          out.push({ algo: a.id, label: a.label, hex: '（失败：' + err.message + '）' });
        }
      }

      const key = hmacKey.get().trim();
      if (key) {
        try {
          out.push({ algo: 'hmac', label: `HMAC-${hmacAlgo.get()}`, hex: await hmac(key, bytes, hmacAlgo.get()) });
        } catch (err) {
          out.push({ algo: 'hmac', label: 'HMAC', hex: '（失败：' + err.message + '）' });
        }
      }

      lastResults = out;
      render();
      const src = fileTarget ? `${fileTarget.name}（${fmtBytes(bytes.length)}）` : `${input.value.length} 个字符`;
      stat.textContent = `已计算 ${out.length} 种 · 输入 ${src}`;
      stat.className = 'hint ok';
    }

    run();
    return () => { };
  },
};
