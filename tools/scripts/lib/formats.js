/**
 * 数据格式互转：JSON / YAML / TOML / XML / CSV / TSV。
 *
 * 每种格式都交给各自领域里成熟的库，不自己写解析器：
 *   JSON  原生
 *   YAML  js-yaml（YAML 1.2 的坑太多，手写必错）
 *   TOML  smol-toml
 *   XML   fast-xml-parser
 *   CSV   SheetJS（已经为表格工具引入了）
 */

import { loadYaml, loadToml, loadXml, loadXLSX } from './scripts.js';

export const FORMATS = [
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', mime: 'text/yaml' },
  { id: 'toml', label: 'TOML', ext: 'toml', mime: 'text/plain' },
  { id: 'xml', label: 'XML', ext: 'xml', mime: 'application/xml' },
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
  { id: 'tsv', label: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values' },
];

/* ============================================================
   解析
   ============================================================ */

export async function parseData(text, format) {
  switch (format) {
    case 'json':
      return JSON.parse(text);

    case 'yaml': {
      const yaml = await loadYaml();
      return yaml.load(text);
    }

    case 'toml': {
      const toml = await loadToml();
      return toml.parse(text);
    }

    case 'xml': {
      const fxp = await loadXml();
      const parser = new fxp.XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@',
        textNodeName: '#text',
        parseAttributeValue: true,
        parseTagValue: true,
        trimValues: true,
      });
      return parser.parse(text);
    }

    case 'csv':
    case 'tsv': {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(text, { type: 'string', raw: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
      return rowsToObjects(rows, format === 'tsv' ? '\t' : ',');
    }

    default:
      throw new Error('不支持的输入格式：' + format);
  }
}

/** 首行当表头，其余转成对象数组 —— 这样和 JSON/YAML 的结构才对得上 */
function rowsToObjects(rows, delim) {
  if (!rows.length) return [];
  const [head, ...body] = rows;
  return body.map((r) => {
    const o = {};
    head.forEach((k, i) => { o[String(k || `col${i + 1}`)] = r[i] ?? ''; });
    return o;
  });
}

/* ============================================================
   序列化
   ============================================================ */

export async function stringifyData(value, format, opts = {}) {
  switch (format) {
    case 'json':
      return JSON.stringify(value, null, opts.indent ?? 2);

    case 'yaml': {
      const yaml = await loadYaml();
      return yaml.dump(value, { indent: opts.indent ?? 2, lineWidth: opts.lineWidth ?? 100, noRefs: true });
    }

    case 'toml': {
      const toml = await loadToml();
      return toml.stringify(normalizeForToml(value));
    }

    case 'xml': {
      const fxp = await loadXml();
      const builder = new fxp.XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@',
        textNodeName: '#text',
        format: true,
        indentBy: '  ',
        suppressEmptyNode: true,
      });
      return builder.build(wrapForXml(value));
    }

    case 'csv':
    case 'tsv': {
      const XLSX = await loadXLSX();
      const delim = opts.delimiter ?? (format === 'tsv' ? '\t' : ',');
      const rows = objectsToRows(value);
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      let csv = XLSX.utils.sheet_to_csv(sheet, { FS: delim });
      // Excel 打开 UTF-8 CSV 需要 BOM
      if (opts.bom !== false && format === 'csv') csv = '\ufeff' + csv;
      return csv;
    }

    default:
      throw new Error('不支持的输出格式：' + format);
  }
}

function objectsToRows(value) {
  if (Array.isArray(value) && value.length && typeof value[0] === 'object' && value[0] !== null) {
    const keys = [...new Set(value.flatMap((o) => Object.keys(o)))];
    return [keys, ...value.map((o) => keys.map((k) => (o[k] == null ? '' : o[k])))];
  }
  if (Array.isArray(value)) return value.map((v) => (Array.isArray(v) ? v : [v]));
  if (value && typeof value === 'object') {
    return [['key', 'value'], ...Object.entries(value)];
  }
  return [[String(value)]];
}

/**
 * TOML 不支持顶层数组和 null，序列化前要调整结构，
 * 否则 smol-toml 会直接抛错。
 */
function normalizeForToml(value) {
  if (Array.isArray(value)) return { items: value };
  if (value === null || typeof value !== 'object') return { value };
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) out[k] = v.map((x) => (x === null ? '' : x));
    else out[k] = v;
  }
  return out;
}

/** XML 需要单一根节点 */
function wrapForXml(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1) return value;
    return { root: value };
  }
  if (Array.isArray(value)) return { root: { item: value } };
  return { root: value };
}

/* ============================================================
   XML ↔ JS 对象的对称处理
   ============================================================ */

/** XML 解析结果里属性带 @ 前缀、文本在 #text，转成干净的对象 */
export function cleanXmlNode(node) {
  if (Array.isArray(node)) return node.map(cleanXmlNode);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '#text') continue;
    out[k.replace(/^@/, '')] = cleanXmlNode(v);
  }
  // 只有文本内容的节点直接降级成字符串
  if (Object.keys(out).length === 0 && '#text' in node) return node['#text'];
  if ('#text' in node && Object.keys(out).length === 0) return node['#text'];
  return out;
}

/** 猜格式：给「自动识别」用 */
export function detectFormat(text) {
  const t = text.trim();
  if (!t) return 'json';
  if (/^[\[{]/.test(t)) {
    try { JSON.parse(t); return 'json'; } catch { /* 继续 */ }
  }
  if (/^<\?xml|^<[A-Za-z_][\w.:-]*[\s/>]/.test(t)) return 'xml';
  if (/^\s*(\[.+\]|\w+\s*=\s*.+)$/m.test(t) && !/:\s/.test(t.split('\n')[0])) return 'toml';
  if (/^[\w.-]+\s*[:=]\s*/m.test(t) && /\n/.test(t)) return 'yaml';
  if (/,/.test(t.split('\n')[0])) return 'csv';
  if (/\t/.test(t.split('\n')[0])) return 'tsv';
  return 'yaml';
}
