import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  copyWithFeedback, toast, textInput,
} from '../ui.js';
import { loadTurndown } from '../lib/scripts.js';
import { download, stamp } from '../lib/files.js';

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'HTML 转 Markdown',
      icon: '📝',
      desc: '把网页内容或富文本转成 Markdown。适合把文章粘进文档、Issue、笔记里，表格与代码块都能保留。',
    });

    const input = el('textarea', { class: 'input mono', rows: 12, placeholder: '把 HTML 粘贴到这里…', 'aria-label': 'HTML 输入' });
    const output = el('textarea', { class: 'input mono', rows: 12, readonly: true, 'aria-label': 'Markdown 结果' });
    const stat = note('等待输入');

    const headingStyle = select({
      label: '标题风格', value: 'atx',
      options: [['atx', '# 井号（Markdown 标准）'], ['setext', '下划线（=== / ---）']],
      onChange: run,
    });
    const hr = select({
      label: '分割线写法', value: '***',
      options: [['***', '***'], ['---', '---'], ['___', '___']],
      onChange: run,
    });
    const bullet = select({
      label: '无序列表符号', value: '-',
      options: [['-', '- 短横线'], ['*', '* 星号'], ['+', '+ 加号']],
      onChange: run,
    });
    const codeBlock = select({
      label: '代码块风格', value: 'fenced',
      options: [['fenced', '``` 围栏'], ['indented', '四空格缩进']],
      onChange: run,
    });
    const linkStyle = select({
      label: '链接风格', value: 'inlined',
      options: [['inlined', '行内 [文字](链接)'], ['referenced', '引用式 [文字][1]']],
      onChange: run,
    });
    const keepTags = textInput({
      label: '保留为原始 HTML 的标签', value: 'iframe,video,audio,source',
      hint: '这些标签 Markdown 表达不了，直接原样保留。',
      onChange: run,
    });
    const stripScript = toggle({ label: '去掉 script / style / noscript', value: true, onChange: run });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'HTML' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => { input.value = SAMPLE; run(); }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('转换选项', grid(headingStyle, hr), grid(bullet, codeBlock), grid(linkStyle, stripScript), keepTags),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: 'Markdown 结果' }), output, stat),
    );
    page.setActions(
      button('转换', run, { primary: true }),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
      button('导出 md', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        download(new Blob([output.value], { type: 'text/markdown;charset=utf-8' }), `转换_${stamp()}.md`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    let timer = 0;
    input.addEventListener('input', run);

    function run() {
      clearTimeout(timer);
      timer = setTimeout(doRun, 200);
    }

    async function doRun() {
      let src = input.value;
      if (!src.trim()) { output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; return; }

      if (stripScript.get()) {
        src = src
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
      }

      try {
        const TurndownService = await loadTurndown();
        const td = new TurndownService({
          headingStyle: headingStyle.get(),
          hr: hr.get(),
          bulletListMarker: bullet.get(),
          codeBlockStyle: codeBlock.get(),
          linkStyle: linkStyle.get(),
          emDelimiter: '*',
          strongDelimiter: '**',
        });

        // 保留 Markdown 表达不了的标签
        for (const tag of keepTags.get().split(/[,，\s]+/).filter(Boolean)) {
          td.keep([tag.trim()]);
        }
        // 表格：Turndown 默认会把 table 拍平，这里手动转成 Markdown 表格
        td.addRule('table', {
          filter: 'table',
          replacement: (content, node) => {
            const rows = [...node.querySelectorAll('tr')];
            if (!rows.length) return content;
            const grid = rows.map((tr) => [...tr.children].map((c) => (c.textContent || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()));
            const width = Math.max(...grid.map((r) => r.length));
            const pad = (r) => [...r, ...Array(width - r.length).fill('')];
            const head = pad(grid[0]);
            const body = grid.slice(1).map(pad);
            return '\n\n| ' + head.join(' | ') + ' |\n| ' + head.map(() => '---').join(' | ') + ' |\n'
              + body.map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';
          },
        });

        const md = td.turndown(src)
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        output.value = md;
        const words = md.replace(/[#*`>\[\]()_-]/g, ' ').split(/\s+/).filter(Boolean).length;
        stat.textContent = `已转换 · HTML ${src.length} 字符 → Markdown ${md.length} 字符 · 约 ${words} 个词`;
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = '转换失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    run();
    return () => { clearTimeout(timer); };
  },
};

const SAMPLE = `<h1>季度业务回顾</h1>
<p>本季度<strong>整体表现良好</strong>，营收同比增长 <em>18%</em>。详见<a href="https://example.com/report">完整报告</a>。</p>
<h2>关键指标</h2>
<table>
  <tr><th>指标</th><th>上季度</th><th>本季度</th></tr>
  <tr><td>营收</td><td>1200 万</td><td>1416 万</td></tr>
  <tr><td>新增客户</td><td>86</td><td>112</td></tr>
</table>
<h2>下一步</h2>
<ul>
  <li>扩大华东区渠道覆盖</li>
  <li>完成 v2.0 发布
    <ul><li>性能优化</li><li>离线能力</li></ul>
  </li>
</ul>
<blockquote>注：以上数据未经审计。</blockquote>
<pre><code>npm install scanlike
npm run build</code></pre>`;
