import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  copyWithFeedback, toast, fileZone,
} from '../ui.js';
import {
  TECHNIQUES, CLEAN_OPTIONS, deobfuscate, inspect, loadBeautify,
} from '../lib/deobfuscate.js';
import { runInSandbox, disposeSandbox } from '../lib/sandbox.js';
import { download, fmtBytes, stamp, baseName } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'JS 反混淆',
      icon: '🧿',
      desc: '还原被混淆的 JavaScript：Packer / Obfuscator.io / JSFuck / JJEncode / AAEncode / 十六进制转义等。需要执行代码时会放进隔离沙箱，跑不到本站的 DOM 与存储。',
    });

    const input = el('textarea', {
      class: 'input mono', rows: 12, spellcheck: 'false',
      placeholder: '把混淆后的 JS 粘贴到这里，或拖入 .js 文件…', 'aria-label': '混淆代码',
    });
    const output = el('textarea', {
      class: 'input mono', rows: 20, readonly: true, spellcheck: 'false', 'aria-label': '反混淆结果',
    });
    const stat = note('等待输入');
    const hintBox = el('div', { class: 'hint-list' });

    const technique = select({
      label: '反混淆方式', value: 'auto',
      options: TECHNIQUES.map((t) => [t.id, `${t.label} —— ${t.desc}`]),
      onChange: () => { renderCleanOptions(); },
    });

    const cleanBox = el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '.5rem .9rem' } });
    const cleanState = {};
    for (const o of CLEAN_OPTIONS) {
      cleanState[o.id] = o.default;
      const t = toggle({
        label: o.label, value: o.default, hint: o.desc,
        onChange: (v) => { cleanState[o.id] = v; },
      });
      cleanBox.append(t.root);
    }

    const safeNotice = el('p', { class: 'hint' });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: '混淆代码' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('选择文件', () => fileInput.click(), { small: true }),
          button('粘贴示例', async () => { input.value = SAMPLE; await analyze(); }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; hintBox.replaceChildren(); stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '识别到的混淆特征' }), hintBox),
      fieldset('设置', technique, el('p', { class: 'field-hint', text: '文本清理项（只做纯文本变换，不执行代码）' }), cleanBox, safeNotice),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '还原结果' }), output, stat),
    );
    page.setActions(
      button('开始反混淆', run, { primary: true }),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
      button('下载 js', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        const name = lastFileName ? baseName(lastFileName) + '_deobf.js' : `反混淆_${stamp()}.js`;
        download(new Blob([output.value], { type: 'text/javascript;charset=utf-8' }), name);
        toast('已下载', 'ok');
      }),
    );
    app.main.append(page.root);

    const fileInput = el('input', { type: 'file', accept: '.js,.mjs,.cjs,text/javascript,application/javascript', hidden: true });
    page.root.append(fileInput);
    let lastFileName = '';

    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      lastFileName = f.name;
      input.value = await f.text();
      await analyze();
    });

    // 拖放也支持
    const dz = fileZone({
      title: '也可以把 .js 文件拖到这里',
      hint: '文件不会上传，全程在本机处理',
      icon: '📜',
      onFiles: async ([f]) => {
        lastFileName = f.name;
        input.value = await f.text();
        await analyze();
      },
    });
    page.root.querySelector('.tool-body')?.append(dz.root);

    input.addEventListener('input', () => { analyze(); });

    let timer = 0;
    function analyze() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        hintBox.replaceChildren();
        const src = input.value;
        if (!src.trim()) {
          hintBox.append(el('p', { class: 'hint', text: '粘贴代码后这里会列出识别结果' }));
          return;
        }
        const hints = inspect(src);
        if (!hints.length) {
          hintBox.append(el('p', { class: 'hint', text: '没有识别到已知的混淆特征。可以试试「清理与还原」或「仅格式化」。' }));
          return;
        }
        for (const h of hints) {
          hintBox.append(el('div', { class: 'kv-row' },
            el('span', { class: 'chip ok', text: h.label }),
            el('span', { class: 'hint', text: h.detail }),
          ));
        }
      }, 150);
    }

    function renderCleanOptions() {
      const t = technique.get();
      const usesClean = t === 'clean' || t === 'auto' || t === 'packer' || t === 'obfuscatorIo' || t === 'jsObfuscator' || t === 'myObfuscate';
      cleanBox.parentElement?.classList.toggle('dim', !usesClean);
      safeNotice.textContent = t === 'format'
        ? '只做缩进美化，完全不改动代码内容。'
        : '这些替换只作用于代码区，字符串内容不会被动。';
    }

    async function run() {
      const src = input.value;
      if (!src.trim()) { toast('先粘贴要反混淆的代码', 'error'); return; }

      const t = technique.get();
      const btn = page.root.querySelector('.tool-actions .primary');
      const old = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }

      try {
        await loadBeautify().catch(() => {});
        stat.textContent = '正在处理…';
        stat.className = 'hint';

        const res = await deobfuscate(src, {
          technique: t,
          clean: cleanState,
          runInSandbox,
          onProgress: (msg) => { stat.textContent = msg; },
        });

        output.value = res.text;
        const ratio = src.length ? Math.round(res.text.length / src.length * 100) : 100;
        stat.textContent = `${res.method} · ${fmtBytes(src.length)} → ${fmtBytes(res.text.length)}（${ratio}%）`
          + (res.note ? ` · ${res.note}` : '');
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = '失败：' + err.message;
        stat.className = 'hint error';
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = old; }
      }
    }

    renderCleanOptions();
    analyze();

    return () => { disposeSandbox(); };
  },
};

/*
 * 一段真实的 Dean Edwards Packer 输出（radix=8，字典 8 项，索引 0-7 各占一个字符）。
 * 解开后是：var el=document.createElement("div");el.textContent="Hello 世界你好!"
 * 用真实产物而不是手写的假样本，这样「解包」按钮点下去能直接看出效果。
 */
const SAMPLE = "eval(function(p,a,c,k,e,r){e=String;if(!''.replace(/^/,String)){while(c--)r[c]=k[c]||c;k=[function(e){return r[e]}];e=function(){return'\\\\w+'};c=1};while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c]);return p}('0 1=2.3(\"4\");1.5=\"6 7!\"',8,8,'var|el|document|createElement|div|Hello|textContent|世界你好'.split('|'),0,{}))";
