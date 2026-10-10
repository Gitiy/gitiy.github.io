import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  copyWithFeedback, toast, numberInput,
} from '../ui.js';
import { download, stamp } from '../lib/files.js';

/* ============================================================
   假数据字典
   ============================================================ */

const SURNAMES = '王李张刘陈杨黄赵周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const GIVEN_1 = '伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂英建华文博子豪雨欣思远佳怡语嫣一诺浩然若曦';
const GIVEN_2 = '华明强军伟杰涛峰宇轩然泽睿欣怡婷妍璐瑶浩宁康乐安泰和顺丰裕达昌盛';

const CITIES = [
  ['北京市', '北京市', '朝阳区'], ['上海市', '上海市', '浦东新区'], ['广东省', '深圳市', '南山区'],
  ['广东省', '广州市', '天河区'], ['浙江省', '杭州市', '西湖区'], ['江苏省', '南京市', '鼓楼区'],
  ['四川省', '成都市', '武侯区'], ['湖北省', '武汉市', '洪山区'], ['陕西省', '西安市', '雁塔区'],
  ['福建省', '厦门市', '思明区'], ['山东省', '青岛市', '市南区'], ['湖南省', '长沙市', '岳麓区'],
];
const STREETS = ['人民路', '解放路', '中山路', '建设大道', '科技园路', '文化街', '长江路', '黄河大街', '创业路', '学院路'];

const COMPANIES = ['科技', '网络', '信息', '数据', '智能', '云计算', '软件', '电子', '通信', '文化传播'];
const COMPANY_SUFFIX = ['有限公司', '股份有限公司', '集团有限公司', '有限责任公司'];
const INDUSTRIES = ['互联网', '金融', '制造', '医疗健康', '教育', '物流', '能源', '零售', '传媒', '政务'];

const DEPARTMENTS = ['研发部', '产品部', '设计部', '市场部', '销售部', '运营部', '人事部', '财务部', '法务部', '客服部'];
const TITLES = ['工程师', '高级工程师', '架构师', '产品经理', '设计师', '主管', '总监', '经理', '专员', '分析师'];
const DOMAINS = ['example.com', 'test.org', 'demo.net', 'sample.io', 'mail.com'];
const TLDS = ['com', 'cn', 'net', 'org'];
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const int = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 用确定性随机源生成合法身份证号（校验位按 GB 11643 计算） */
function idCard() {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = '10X98765432';
  const area = pick(['110105', '310115', '440305', '440106', '330106', '320106', '510107', '420111', '610113', '350203']);
  const year = int(1965, 2005);
  const month = pad(int(1, 12));
  const day = pad(int(1, 28));
  const seq = pad(int(1, 999), 3);
  const body = `${area}${year}${month}${day}${seq}`;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(body[i]) * weights[i];
  return body + codes[sum % 11];
}

function lorem(words) {
  const out = [];
  for (let i = 0; i < words; i++) out.push(pick(LOREM));
  return out.join(' ').replace(/^./, (c) => c.toUpperCase()) + '.';
}

function dateStr(from, to) {
  const d = new Date(from.getTime() + Math.random() * (to.getTime() - from.getTime()));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function datetimeStr(from, to) {
  const d = new Date(from.getTime() + Math.random() * (to.getTime() - from.getTime()));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ============================================================
   字段定义
   ============================================================ */

const FIELDS = {
  name: { label: '姓名', gen: () => pick(SURNAMES.split('')) + pick(GIVEN_1.split('')) + (Math.random() < 0.6 ? pick(GIVEN_2.split('')) : '') },
  username: { label: '用户名', gen: () => (pick(['dev', 'coder', 'user', 'admin', 'test', 'demo', 'guest', 'member']) + int(10, 9999)) },
  email: { label: '邮箱', gen: () => {
    const u = (pick(['dev', 'user', 'contact', 'info', 'admin', 'hello', 'team']) + int(1, 999));
    return `${u}@${pick(DOMAINS)}`;
  } },
  phone: { label: '手机号', gen: () => pick(['138', '139', '150', '151', '158', '166', '176', '186', '188', '199']) + pad(int(0, 99999999), 8) },
  idCard: { label: '身份证号', gen: idCard },
  company: { label: '公司名', gen: () => pick(['北京', '上海', '深圳', '杭州', '成都', '广州', '南京', '武汉']) + pick(['星辰', '云端', '智慧', '远景', '恒达', '华创', '天工', '拓维']) + pick(COMPANIES) + pick(COMPANY_SUFFIX) },
  industry: { label: '行业', gen: () => pick(INDUSTRIES) },
  department: { label: '部门', gen: () => pick(DEPARTMENTS) },
  title: { label: '职位', gen: () => pick(['初级', '中级', '高级', '资深', '首席']) + pick(TITLES) },
  province: { label: '省份', gen: () => pick(CITIES)[0] },
  city: { label: '城市', gen: () => pick(CITIES)[1] },
  district: { label: '区县', gen: () => pick(CITIES)[2] },
  address: { label: '详细地址', gen: () => { const c = pick(CITIES); return `${c[0]}${c[1]}${c[2]}${pick(STREETS)}${int(1, 999)}号${int(1, 30)}栋${int(1, 2001)}室`; } },
  zipCode: { label: '邮编', gen: () => pad(int(100000, 999999), 6) },
  uuid: { label: 'UUID', gen: () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const s = [...b].map((x) => pad(x.toString(16), 2)).join(''); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`; } },
  int: { label: '整数', gen: () => int(1, 10000) },
  price: { label: '金额', gen: () => (Math.random() * 9999).toFixed(2) },
  percent: { label: '百分比', gen: () => int(0, 100) + '%' },
  bool: { label: '布尔值', gen: () => Math.random() < 0.5 },
  date: { label: '日期', gen: () => dateStr(new Date(2020, 0, 1), new Date()) },
  datetime: { label: '日期时间', gen: () => datetimeStr(new Date(2024, 0, 1), new Date()) },
  timestamp: { label: '时间戳（秒）', gen: () => Math.floor(Date.now() / 1000) - int(0, 31536000) },
  ip: { label: 'IP 地址', gen: () => `${int(1, 223)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}` },
  url: { label: '网址', gen: () => `https://${pick(['www', 'api', 'blog', 'shop', 'docs'])}.${pick(DOMAINS).split('.')[0]}.${pick(TLDS)}/${pick(['home', 'detail', 'list', 'about', 'item'])}/${int(100, 9999)}` },
  status: { label: '状态枚举', gen: () => pick(['active', 'pending', 'disabled', 'archived']) },
  lorem: { label: '段落文本', gen: () => lorem(int(8, 24)) },
  bankCard: { label: '银行卡号', gen: () => '62' + pad(int(0, 999999999999999), 15) },
  color: { label: '颜色', gen: () => '#' + pad(int(0, 0xffffff).toString(16), 6) },
};

const DEFAULT_FIELDS = ['name', 'username', 'email', 'phone', 'company', 'city', 'date', 'bool'];

export const tool = {
  init(app) {
    const page = toolPage({
      title: '测试数据生成',
      icon: '🧪',
      desc: '批量生成姓名、邮箱、手机号、身份证号（校验位正确）、地址、公司等假数据，导出 JSON / CSV / SQL / TypeScript。',
    });

    const count = numberInput({ label: '生成条数', value: 20, min: 1, max: 5000, onChange: () => schedule() });
    const format = select({
      label: '输出格式', value: 'json',
      options: [['json', 'JSON'], ['csv', 'CSV'], ['sql', 'SQL INSERT'], ['ts', 'TypeScript 数组'], ['md', 'Markdown 表格']],
      onChange: () => schedule(),
    });
    const tableName = el('input', { type: 'text', class: 'input mono', value: 'users', 'aria-label': '表名' });
    const pretty = toggle({ label: 'JSON 美化缩进', value: true, onChange: () => schedule() });

    const fieldBox = el('div', { class: 'field-picker' });
    const selected = new Set(DEFAULT_FIELDS);

    const output = el('textarea', { class: 'input mono', rows: 16, readonly: true, 'aria-label': '生成结果' });
    const stat = note('');

    for (const [id, def] of Object.entries(FIELDS)) {
      const on = selected.has(id);
      const chip = el('button', {
        type: 'button',
        class: 'pick-chip' + (on ? ' on' : ''),
        'aria-pressed': String(on),
        text: def.label,
      });
      chip.addEventListener('click', () => {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        chip.classList.toggle('on', selected.has(id));
        chip.setAttribute('aria-pressed', String(selected.has(id)));
        schedule();
      });
      fieldBox.append(chip);
    }

    page.add(
      fieldset('字段选择（点一下切换）', fieldBox),
      fieldset('输出设置', grid(count, format), grid(tableName.root, pretty)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '生成结果' }), output, stat),
    );
    page.setActions(
      button('重新生成', () => run(), { primary: true }),
      button('复制结果', () => copyWithFeedback(output.value, '已复制')),
      button('下载文件', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        const ext = { json: 'json', csv: 'csv', sql: 'sql', ts: 'ts', md: 'md' }[format.get()];
        const mime = format.get() === 'csv' ? 'text/csv' : 'text/plain';
        download(new Blob([output.value], { type: mime + ';charset=utf-8' }), `测试数据_${stamp()}.${ext}`);
        toast('已下载', 'ok');
      }),
    );
    app.main.append(page.root);

    let timer = 0;
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(run, 200);
    }

    function run() {
      const ids = Object.keys(FIELDS).filter((id) => selected.has(id));
      if (!ids.length) {
        output.value = '';
        stat.textContent = '至少选一个字段';
        stat.className = 'hint error';
        return;
      }

      const n = Math.max(1, Math.min(5000, Math.round(count.get() || 20)));
      const rows = [];
      for (let i = 0; i < n; i++) {
        const row = {};
        for (const id of ids) row[id] = FIELDS[id].gen();
        rows.push(row);
      }

      const fmt = format.get();
      let text = '';
      if (fmt === 'json') {
        text = JSON.stringify(rows, null, pretty.get() ? 2 : 0);
      } else if (fmt === 'csv') {
        const head = ids.join(',');
        const body = rows.map((r) => ids.map((id) => {
          const v = String(r[id]);
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(','));
        text = '\ufeff' + [head, ...body].join('\n');
      } else if (fmt === 'sql') {
        const table = (tableName.node.value || 'users').replace(/[^\w$]/g, '') || 'users';
        const cols = ids.join(', ');
        const lines = rows.map((r) => `INSERT INTO ${table} (${cols}) VALUES (${ids.map((id) => {
          const v = r[id];
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          if (typeof v === 'number') return String(v);
          if (/^(int|price|percent|timestamp)$/.test(id) && !Number.isNaN(Number(v))) return String(v);
          return "'" + String(v).replace(/'/g, "''") + "'";
        }).join(', ')});`);
        text = `-- ${n} 行测试数据，生成于 ${new Date().toISOString()}\n` + lines.join('\n');
      } else if (fmt === 'ts') {
        const typeName = 'SampleRow';
        const types = ids.map((id) => {
          const v = rows[0][id];
          const t = typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string';
          return `  ${id}: ${t};`;
        });
        text = `export interface ${typeName} {\n${types.join('\n')}\n}\n\nexport const samples: ${typeName}[] = ${JSON.stringify(rows, null, 2)};`;
      } else {
        const head = '| ' + ids.map((id) => FIELDS[id].label).join(' | ') + ' |';
        const sep = '| ' + ids.map(() => '---').join(' | ') + ' |';
        const body = rows.map((r) => '| ' + ids.map((id) => String(r[id]).replace(/\|/g, '\\|')).join(' | ') + ' |');
        text = [head, sep, ...body].join('\n');
      }

      output.value = text;
      stat.textContent = `已生成 ${n} 行 × ${ids.length} 个字段 · ${text.length} 字符 · 格式 ${fmt.toUpperCase()}`;
      stat.className = 'hint ok';
    }

    run();
    return () => { clearTimeout(timer); };
  },
};
