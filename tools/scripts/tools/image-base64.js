import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  toast, fileZone, copyWithFeedback,
} from '../ui.js';
import { base64 } from '../lib/encode-text.js';
import { fmtBytes, download, baseName, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: '图片转 Base64',
      icon: '🧬',
      desc: '把图片转成 Base64 / Data URL / CSS 背景 / HTML img 标签，可直接内联进网页或样式表，省一次请求。',
    });

    let items = [];
    let uid = 0;
    let activeId = null;

    const listBox = el('div', { class: 'filelist' });
    const preview = el('div', { class: 'b64-preview' });
    const output = el('textarea', { class: 'input mono', rows: 10, readonly: true, 'aria-label': '转换结果' });
    const stat = note('拖入图片开始');

    const formSel = select({
      label: '输出形式', value: 'dataurl',
      options: [
        ['dataurl', 'Data URL —— data:image/png;base64,…'],
        ['raw', '纯 Base64 字符串'],
        ['css', 'CSS background-image'],
        ['html', 'HTML <img> 标签'],
        ['md', 'Markdown 图片语法'],
        ['js', 'JavaScript 字符串常量'],
      ],
      onChange: render,
    });
    const wrap = toggle({ label: '长字符串自动换行（每 76 字符）', value: false, onChange: render });
    const withSize = toggle({ label: '在结果里附带体积信息', value: true, onChange: render });

    page.add(
      el('div', { class: 'card' },
        fileZone({
          title: '拖入图片，或点击选择',
          hint: '可以一次拖多张，逐个切换查看',
          icon: '🖼️', accept: 'image/*',
          onFiles: (files) => addFiles(files),
        }).root,
      ),
      el('div', { class: 'card hidden', id: 'b64Card' },
        el('p', { class: 'field-hint', text: '文件' }),
        listBox,
        el('div', { class: 'grid2' },
          el('div', {}, el('p', { class: 'field-hint', text: '预览' }), preview),
          el('div', {}, el('p', { class: 'field-hint', text: '转换结果' }), output),
        ),
      ),
      fieldset('输出格式', formSel, grid(wrap, withSize)),
      el('div', { class: 'card' }, stat),
    );
    page.setActions(
      button('复制结果', () => copyWithFeedback(output.value, '已复制'), { primary: true }),
      button('下载结果', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        const it = items.find((x) => x.id === activeId);
        const ext = formSel.get() === 'html' || formSel.get() === 'md' ? 'html' : formSel.get() === 'css' ? 'css' : 'txt';
        download(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), `${baseName(it?.name || 'image')}_base64.${ext}`);
        toast('已下载', 'ok');
      }),
      button('导出全部 txt', () => {
        if (!items.length) { toast('还没有图片', 'error'); return; }
        const text = items.map((it) => `/* ${it.name} — ${fmtBytes(it.size)} */\n${it.dataUrl}`).join('\n\n');
        download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `图片base64_${stamp()}.txt`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    const b64Card = page.root.querySelector('#b64Card');

    async function addFiles(files) {
      for (const f of files) {
        if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|bmp|gif|avif|svg)$/i.test(f.name)) continue;
        const buf = new Uint8Array(await f.arrayBuffer());
        const b64 = base64.encode(buf);
        const mime = f.type || 'image/png';
        items.push({
          id: ++uid,
          name: f.name,
          size: f.size,
          mime,
          b64,
          dataUrl: `data:${mime};base64,${b64}`,
        });
      }
      if (!activeId && items.length) activeId = items[0].id;
      b64Card.classList.remove('hidden');
      renderList();
      render();
    }

    function renderList() {
      listBox.replaceChildren();
      for (const it of items) {
        const row = el('div', { class: 'file-row' + (it.id === activeId ? ' active' : '') },
          el('span', { class: 'file-name', text: it.name, title: it.name }),
          el('span', { class: 'file-note', text: `${fmtBytes(it.size)} → Base64 ${fmtBytes(it.b64.length)}` }),
          button('查看', () => { activeId = it.id; renderList(); render(); }, { small: true }),
          button('移除', () => {
            items = items.filter((x) => x.id !== it.id);
            if (activeId === it.id) activeId = items[0]?.id ?? null;
            renderList();
            render();
          }, { small: true, danger: true }),
        );
        listBox.append(row);
      }
    }

    function chunk(s, size = 76) {
      if (!wrap.get()) return s;
      const out = [];
      for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
      return out.join('\n');
    }

    function render() {
      const it = items.find((x) => x.id === activeId);
      preview.replaceChildren();
      if (!it) {
        output.value = '';
        stat.textContent = '拖入图片开始';
        stat.className = 'hint';
        return;
      }

      const im = el('img', { src: it.dataUrl, alt: it.name, class: 'b64-img' });
      preview.append(im);

      const overhead = Math.round((it.b64.length / it.size) * 100 - 100);
      const sizeNote = `/* ${it.name} · 原始 ${fmtBytes(it.size)} · Base64 ${fmtBytes(it.b64.length)} · 增大约 ${overhead}% */`;

      let text;
      switch (formSel.get()) {
        case 'raw': text = chunk(it.b64); break;
        case 'css': text = `.bg {\n  background-image: url("${wrap.get() ? it.dataUrl : it.dataUrl}");\n  background-size: cover;\n  background-position: center;\n}`; break;
        case 'html': text = `<img src="${it.dataUrl}" alt="${it.name.replace(/"/g, '&quot;')}" />`; break;
        case 'md': text = `![${baseName(it.name)}](${it.dataUrl})`; break;
        case 'js': text = `export const ${baseName(it.name).replace(/[^\w$]/g, '_')}DataUrl =\n  '${wrap.get() ? it.dataUrl : it.dataUrl}';`; break;
        default: text = it.dataUrl;
      }
      if (withSize.get()) text = sizeNote + '\n' + text;
      if (wrap.get() && (formSel.get() === 'dataurl' || formSel.get() === 'css' || formSel.get() === 'html' || formSel.get() === 'md' || formSel.get() === 'js')) {
        text = text.replace(it.dataUrl, chunk(it.dataUrl));
      }

      output.value = text;
      stat.textContent = `${it.name} · 原始 ${fmtBytes(it.size)} → Base64 ${fmtBytes(it.b64.length)}（增大约 ${overhead}%）`
        + (it.b64.length > 200000 ? ' · 体积偏大，内联进 HTML 会明显拖慢首屏' : '');
      stat.className = it.b64.length > 200000 ? 'hint warn' : 'hint ok';
    }

    return () => { };
  },
};
