import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  copyWithFeedback, toast, fileZone,
} from '../ui.js';
import { BASES, encodeWith, decodeWith, base64, toBytes, fromBytes } from '../lib/encode-text.js';
import { download, fmtBytes, baseName, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'Base 系列编解码',
      icon: '🔤',
      desc: 'Base64 / URL-safe / Base32 / Base58 / 十六进制 / URL 编码 / HTML 实体互转，支持中文与 emoji，也能把文件转成 Base64。',
    });

    const input = el('textarea', { class: 'input mono', rows: 9, placeholder: '把内容粘贴到这里…', 'aria-label': '输入' });
    const output = el('textarea', { class: 'input mono', rows: 9, readonly: true, 'aria-label': '输出' });
    const stat = note('等待输入');

    const baseSel = select({
      label: '编码方式', value: 'base64',
      options: BASES.map((b) => [b.id, `${b.label} —— ${b.desc}`]),
      onChange: run,
    });
    const urlSafe = toggle({
      label: 'Base64 用 URL-safe 字母表（- _ 代替 + /）', value: false,
      onChange: run,
    });
    const noPad = toggle({ label: '去掉 Base64 末尾的 = 填充', value: false, onChange: run });
    const auto = toggle({
      label: '自动判断方向（像编码就解码，否则编码）', value: true, onChange: run,
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '输入' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('交换', () => { const t = input.value; input.value = output.value; output.value = t; run(); }, { small: true, title: '把结果放回输入框' }),
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('选项', baseSel, grid(urlSafe, noPad), auto),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '结果' }), output, stat),
    );
    page.setActions(
      button('复制结果', () => copyWithFeedback(output.value, '已复制'), { primary: true }),
      button('导出 txt', () => {
        if (!output.value) { toast('没有可导出的内容', 'error'); return; }
        download(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), `编码结果_${stamp()}.txt`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    /* ---------- 文件 → Base64 ---------- */
    const filePanel = el('div', { class: 'card' });
    const fileInfo = note('把任意文件拖进来，转成 Base64（也可以反向下回文件）');
    let currentFile = null;
    let currentDataUrl = '';

    const dz = fileZone({
      title: '拖入文件转 Base64',
      hint: '文件不会上传，全部在本机处理',
      icon: '📎',
      onFiles: async ([f]) => {
        currentFile = f;
        const bytes = new Uint8Array(await f.arrayBuffer());
        const b64 = base64.encode(bytes);
        currentDataUrl = `data:${f.type || 'application/octet-stream'};base64,${b64}`;
        input.value = b64;
        baseSel.set('base64');
        run();
        fileInfo.textContent = `${f.name} · ${fmtBytes(f.size)} → Base64 ${fmtBytes(b64.length)}（增大约 ${Math.round(b64.length / f.size * 100 - 100)}%）`;
        fileInfo.className = 'hint ok';
      },
    });

    const dlB64 = button('把输入当作 Base64 还原成文件', async () => {
      const text = (input.value || '').trim();
      if (!text) { toast('输入框是空的', 'error'); return; }
      try {
        const clean = text.replace(/^data:[^;]+;base64,/, '');
        const bytes = base64.decode(clean);
        const name = currentFile
          ? baseName(currentFile.name) + '_还原' + (currentFile.name.match(/\.[^.]+$/)?.[0] || '.bin')
          : `还原文件_${stamp()}.bin`;
        download(new Blob([bytes]), name);
        toast(`已还原 ${fmtBytes(bytes.length)}`, 'ok');
      } catch (err) {
        toast('还原失败：' + err.message, 'error');
      }
    }, { small: true });

    const dlDataUrl = button('下载 Data URL 文本', () => {
      if (!currentDataUrl) { toast('先拖入一个文件', 'error'); return; }
      download(new Blob([currentDataUrl], { type: 'text/plain' }), `dataurl_${stamp()}.txt`);
      toast('已导出', 'ok');
    }, { small: true });

    filePanel.append(
      el('p', { class: 'field-hint', text: '文件与 Base64 互转' }),
      dz.root,
      el('div', { class: 'row', style: { marginTop: '.5rem' } }, dlB64, dlDataUrl),
      fileInfo,
    );
    page.add(filePanel);

    input.addEventListener('input', run);
    urlSafe.node.addEventListener('change', syncOptionVisibility);
    baseSel.node.addEventListener('change', syncOptionVisibility);

    function syncOptionVisibility() {
      const isB64 = baseSel.get() === 'base64';
      urlSafe.root.classList.toggle('hidden', !isB64);
      noPad.root.classList.toggle('hidden', !isB64);
    }

    /** 判断这段文本更像「已编码」还是「原文」 */
    function looksEncoded(text) {
      const t = text.trim();
      if (!t) return false;
      const base = baseSel.get();
      if (base === 'base64' || base === 'base64url') return /^[A-Za-z0-9+/\-_\s=]+$/.test(t) && t.replace(/\s/g, '').length >= 4;
      if (base === 'base32') return /^[A-Z2-7\s=]+$/i.test(t);
      if (base === 'base58') return /^[1-9A-HJ-NP-Za-km-z\s]+$/.test(t);
      if (base === 'hex') return /^[0-9a-fA-F\s:,-]+$/.test(t) && t.replace(/[\s:,-]/g, '').length % 2 === 0;
      if (base === 'url') return /%[0-9a-fA-F]{2}/.test(t);
      if (base === 'html') return /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/.test(t);
      return false;
    }

    function run() {
      const raw = input.value;
      if (!raw.trim()) {
        output.value = '';
        stat.textContent = '等待输入';
        stat.className = 'hint';
        return;
      }

      const base = baseSel.get();
      const opts = base === 'base64' ? { urlSafe: urlSafe.get(), pad: !noPad.get() } : {};
      const doDecode = auto.get() && looksEncoded(raw);

      try {
        if (doDecode) {
          // decodeWith 返回的已经是字符串，不要再过一次 TextDecoder
          const text = decodeWith(raw, base);
          output.value = text;
          stat.textContent = `解码 · ${raw.trim().length} 字符 → ${text.length} 字符`;
        } else {
          let text = encodeWith(raw, base);
          if (base === 'base64' && opts.urlSafe) {
            text = base64.encode(toBytes(raw), { urlSafe: true, pad: !noPad.get() });
          } else if (base === 'base64' && noPad.get()) {
            text = base64.encode(toBytes(raw), { urlSafe: false, pad: false });
          }
          output.value = text;
          stat.textContent = `编码 · ${raw.length} 字符 → ${text.length} 字符（增大约 ${Math.round(text.length / raw.length * 100 - 100)}%）`;
        }
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = (doDecode ? '解码失败：' : '编码失败：') + err.message;
        stat.className = 'hint error';
      }
    }

    syncOptionVisibility();
    run();
    return () => { };
  },
};
