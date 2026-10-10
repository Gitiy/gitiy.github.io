import {
  toolPage, el, button, select, note, grid, fieldset,
  copyWithFeedback, toast, numberInput, textInput,
} from '../ui.js';
import { loadSqlFormatter } from '../lib/scripts.js';
import { download, stamp } from '../lib/files.js';

const LANGUAGES = [
  ['sql', '标准 SQL'], ['mysql', 'MySQL'], ['mariadb', 'MariaDB'], ['postgresql', 'PostgreSQL'],
  ['sqlite', 'SQLite'], ['transactsql', 'SQL Server (T-SQL)'], ['plsql', 'Oracle PL/SQL'],
  ['bigquery', 'BigQuery'], ['snowflake', 'Snowflake'], ['spark', 'Spark SQL'], ['redshift', 'Redshift'],
];

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'SQL 格式化',
      icon: '🗄️',
      desc: '把挤成一行的 SQL 排成可读的缩进结构，支持十多种数据库方言，可调关键字大小写与缩进宽度。',
    });

    const input = el('textarea', { class: 'input mono', rows: 12, placeholder: '把 SQL 粘贴到这里…', 'aria-label': 'SQL 输入' });
    const output = el('textarea', { class: 'input mono', rows: 16, readonly: true, 'aria-label': '格式化结果' });
    const stat = note('等待输入');

    const lang = select({
      label: 'SQL 方言', value: 'sql',
      options: LANGUAGES.map(([v, l]) => [v, l]),
      onChange: run,
    });
    const keywordCase = select({
      label: '关键字大小写', value: 'upper',
      options: [['upper', '全大写（SELECT）'], ['lower', '全小写（select）'], ['preserve', '保持原样']],
      onChange: run,
    });
    const indent = numberInput({ label: '缩进空格数', value: 2, min: 0, max: 8, onChange: run });
    const tabWidth = numberInput({ label: 'Tab 宽度', value: 2, min: 1, max: 8, onChange: run });
    const linesBetween = numberInput({ label: '语句之间空几行', value: 1, min: 0, max: 3, onChange: run });
    const exprWidth = textInput({
      label: '表达式换行宽度（0 = 不换行）', value: '50',
      hint: 'SELECT 列表很长时，超过这个宽度就换行。',
      onChange: run,
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'SQL' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => { input.value = SAMPLE; run(); }, { small: true }),
          button('压成一行', () => {
            if (!output.value) { toast('先格式化一次', 'error'); return; }
            output.value = output.value.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
            stat.textContent = '已压成一行（关键字大小写保留）';
            stat.className = 'hint ok';
          }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('格式设置', grid(lang, keywordCase), grid(indent, tabWidth), grid(linesBetween, exprWidth)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '格式化结果' }), output, stat),
    );
    page.setActions(
      button('格式化', run, { primary: true }),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
      button('导出 sql', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        download(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), `格式化_${stamp()}.sql`);
        toast('已导出', 'ok');
      }),
    );
    app.main.append(page.root);

    let timer = 0;
    input.addEventListener('input', run);

    function run() {
      clearTimeout(timer);
      timer = setTimeout(doRun, 180);
    }

    async function doRun() {
      const src = input.value;
      if (!src.trim()) { output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; return; }
      try {
        const sqlFormatter = await loadSqlFormatter();
        const text = sqlFormatter.format(src, {
          language: lang.get(),
          keywordCase: keywordCase.get(),
          tabWidth: Math.max(0, Math.round(indent.get() ?? 2)),
          useTabs: false,
          linesBetweenQueries: Math.max(0, Math.round(linesBetween.get() ?? 1)),
          expressionWidth: Math.max(0, Number(exprWidth.get()) || 50),
        });
        output.value = text;
        stat.textContent = `已格式化 · ${src.split('\n').length} 行 → ${text.split('\n').length} 行 · 方言 ${lang.get()}`;
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = '格式化失败：' + err.message + '（这个方言可能不认识某些语法，换一个方言试试）';
        stat.className = 'hint error';
      }
    }

    run();
    return () => { clearTimeout(timer); };
  },
};

const SAMPLE = `select u.id,u.name,u.email,count(o.id) as order_count,sum(o.total) as total_amount from users u left join orders o on o.user_id=u.id and o.status in ('paid','shipped') where u.created_at>='2026-01-01' and u.deleted_at is null group by u.id,u.name,u.email having count(o.id)>3 order by total_amount desc limit 20;`;
