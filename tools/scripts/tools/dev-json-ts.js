import {
  toolPage, el, button, select, toggle, note, grid, fieldset,
  copyWithFeedback, toast, textInput,
} from '../ui.js';
import { download, stamp } from '../lib/files.js';

/* ============================================================
   类型推断
   ============================================================ */

const pascal = (s) => {
  const words = String(s).replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(name) ? '_' + name : (name || 'Item');
};

/** 把若干个 JSON 值合并成一个「形状」描述，用于数组里元素结构不一致的情况 */
function mergeValues(values) {
  if (!values.length) return { kind: 'any' };
  const kinds = new Set(values.map(kindOf));
  if (kinds.size === 1 && kinds.has('object')) {
    const keys = new Set();
    values.forEach((v) => Object.keys(v).forEach((k) => keys.add(k)));
    const fields = {};
    for (const k of keys) {
      const present = values.filter((v) => Object.prototype.hasOwnProperty.call(v, k));
      fields[k] = {
        shape: mergeValues(present.map((v) => v[k])),
        optional: present.length < values.length,
      };
    }
    return { kind: 'object', fields };
  }
  if (kinds.size === 1 && kinds.has('array')) {
    return { kind: 'array', item: mergeValues(values.flat()) };
  }
  if (kinds.size === 1) return { kind: [...kinds][0] };
  // 混合类型：null 和其他类型合并时，其他类型优先（可空另外标注）
  const nonNull = [...kinds].filter((k) => k !== 'null');
  if (nonNull.length === 1) return { kind: nonNull[0], nullable: true };
  return { kind: 'union', of: [...kinds].filter((k) => k !== 'any') };
}

function kindOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'number') return Number.isInteger(v) ? 'number' : 'number';
  return typeof v;   // string / boolean
}

/* ============================================================
   各语言输出
   ============================================================ */

const PRIM = {
  ts: { string: 'string', number: 'number', boolean: 'boolean', null: 'null', any: 'any' },
  go: { string: 'string', number: 'float64', boolean: 'bool', null: 'interface{}', any: 'interface{}' },
  java: { string: 'String', number: 'Double', boolean: 'Boolean', null: 'Object', any: 'Object' },
  python: { string: 'str', number: 'float', boolean: 'bool', null: 'None', any: 'Any' },
  rust: { string: 'String', number: 'f64', boolean: 'bool', null: '()', any: 'serde_json::Value' },
};

/** 简单单数化：items → item、tags → tag。用来给数组元素类型起个自然的名字。 */
function singular(word) {
  if (!word) return 'Item';
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(?:s|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/ss$/i.test(word)) return word;
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

function typeNameFor(path) {
  return path.length ? path.map(pascal).join('') : 'Root';
}

/** 收集所有需要单独声明的对象类型 */
function collectShapes(shape, path, out) {
  if (shape.kind === 'object') {
    const name = typeNameFor(path);
    out.set(name, { shape, path });
    for (const [k, f] of Object.entries(shape.fields)) collectShapes(f.shape, [...path, k], out);
  } else if (shape.kind === 'array') {
    collectShapes(shape.item, [...path.slice(0, -1), singular(path[path.length - 1])], out);
  }
}

function tsType(shape, path, opts) {
  const P = PRIM.ts;
  switch (shape.kind) {
    case 'object': {
      const name = typeNameFor(path);
      return shape.nullable ? `${name} | null` : name;
    }
    case 'array': {
      const inner = tsType(shape.item, [...path.slice(0, -1), singular(path[path.length - 1])], opts);
      const t = /[|&]/.test(inner) ? `(${inner})` : inner;
      return (shape.nullable ? `${t}[] | null` : `${t}[]`);
    }
    case 'union': {
      const parts = [...new Set(shape.of.map((k) => P[k] ?? 'any'))];
      return parts.join(' | ');
    }
    default: {
      const t = P[shape.kind] ?? 'any';
      return shape.nullable ? `${t} | null` : t;
    }
  }
}

function emitTs(shape, opts) {
  const shapes = new Map();
  collectShapes(shape, [], shapes);
  const blocks = [];
  for (const [name, info] of shapes) {
    const lines = [];
    for (const [k, f] of Object.entries(info.shape.fields)) {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      const opt = f.optional ? '?' : '';
      lines.push(`  ${opts.readonly ? 'readonly ' : ''}${key}${opt}: ${tsType(f.shape, [...info.path, k], opts)};`);
    }
    blocks.push(`${opts.exportKeyword ? 'export ' : ''}${opts.useInterface ? 'interface' : 'type'} ${name} ${opts.useInterface ? '{' : '= {'}\n${lines.join('\n')}\n}`);
  }
  return blocks.join('\n');
}

function emitGo(shape, opts) {
  const shapes = new Map();
  collectShapes(shape, [], shapes);
  const goType = (s, path) => {
    switch (s.kind) {
      case 'object': return '*' + typeNameFor(path);
      case 'array': return '[]' + goType(s.item, [...path.slice(0, -1), singular(path[path.length - 1])]);
      case 'union': return 'interface{}';
      default: return PRIM.go[s.kind] ?? 'interface{}';
    }
  };
  const blocks = [];
  for (const [name, info] of shapes) {
    const lines = [];
    for (const [k, f] of Object.entries(info.shape.fields)) {
      const jsonTag = f.optional ? `${k},omitempty` : k;
      lines.push(`\t${pascal(k)} ${goType(f.shape, [...info.path, k])} \`json:"${jsonTag}"\``);
    }
    blocks.push(`type ${name} struct {\n${lines.join('\n')}\n}`);
  }
  return blocks.join('\n\n');
}

function emitJava(shape) {
  const shapes = new Map();
  collectShapes(shape, [], shapes);
  const javaType = (s, path) => {
    switch (s.kind) {
      case 'object': return typeNameFor(path);
      case 'array': return 'List<' + javaType(s.item, [...path.slice(0, -1), singular(path[path.length - 1])]) + '>';
      case 'union': return 'Object';
      default: return PRIM.java[s.kind] ?? 'Object';
    }
  };
  const blocks = ['import java.util.List;', ''];
  for (const [name, info] of shapes) {
    const lines = [];
    for (const [k, f] of Object.entries(info.shape.fields)) {
      lines.push(`    private ${javaType(f.shape, [...info.path, k])} ${k.replace(/[^\w]/g, '_')};`);
    }
    const getters = Object.entries(info.shape.fields).map(([k, f]) =>
      `    public ${javaType(f.shape, [...info.path, k])} get${pascal(k)}() { return this.${k.replace(/[^\w]/g, '_')}; }`);
    blocks.push(`public class ${name} {\n${lines.join('\n')}\n\n${getters.join('\n')}\n}`);
  }
  return blocks.join('\n\n');
}

function emitPython(shape) {
  const shapes = new Map();
  collectShapes(shape, [], shapes);
  const pyType = (s, path) => {
    switch (s.kind) {
      case 'object': return `'${typeNameFor(path)}'`;
      case 'array': return `List[${pyType(s.item, [...path.slice(0, -1), singular(path[path.length - 1])])}]`;
      case 'union': return 'Any';
      default: return PRIM.python[s.kind] ?? 'Any';
    }
  };
  const blocks = ['from dataclasses import dataclass', 'from typing import List, Optional, Any', ''];
  for (const [name, info] of shapes) {
    const lines = [];
    for (const [k, f] of Object.entries(info.shape.fields)) {
      let t = pyType(f.shape, [...info.path, k]);
      if (f.optional) t = `Optional[${t.replace(/^'(.*)'$/, "'$1'")}]`;
      lines.push(`    ${k.replace(/[^\w]/g, '_')}: ${t}`);
    }
    blocks.push(`@dataclass\nclass ${name}:\n${lines.length ? lines.join('\n') : '    pass'}`);
  }
  return blocks.join('\n\n');
}

function emitRust(shape) {
  const shapes = new Map();
  collectShapes(shape, [], shapes);
  const rustType = (s, path) => {
    switch (s.kind) {
      case 'object': return typeNameFor(path);
      case 'array': return `Vec<${rustType(s.item, [...path.slice(0, -1), singular(path[path.length - 1])])}>`;
      case 'union': return 'serde_json::Value';
      default: return PRIM.rust[s.kind] ?? 'serde_json::Value';
    }
  };
  const blocks = ['use serde::{Deserialize, Serialize};', ''];
  for (const [name, info] of shapes) {
    const lines = [];
    for (const [k, f] of Object.entries(info.shape.fields)) {
      let t = rustType(f.shape, [...info.path, k]);
      if (f.optional) t = `Option<${t}>`;
      lines.push(`    pub ${k.replace(/[^\w]/g, '_')}: ${t},`);
    }
    blocks.push(`#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${name} {\n${lines.join('\n')}\n}`);
  }
  return blocks.join('\n\n');
}

const LANGS = [
  { id: 'ts', label: 'TypeScript', ext: 'ts', emit: emitTs },
  { id: 'go', label: 'Go', ext: 'go', emit: emitGo },
  { id: 'java', label: 'Java', ext: 'java', emit: emitJava },
  { id: 'python', label: 'Python (dataclass)', ext: 'py', emit: emitPython },
  { id: 'rust', label: 'Rust (serde)', ext: 'rs', emit: emitRust },
];

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'JSON 转类型定义',
      icon: '🧬',
      desc: '把 JSON 样本推断成 TypeScript / Go / Java / Python / Rust 的类型声明。数组元素结构不一致时会自动合并并把缺字段标成可选。',
    });

    const input = el('textarea', { class: 'input mono', rows: 10, placeholder: '把 JSON 粘贴到这里…', 'aria-label': 'JSON 输入' });
    const output = el('textarea', { class: 'input mono', rows: 18, readonly: true, 'aria-label': '生成结果' });
    const stat = note('等待输入');

    const lang = select({
      label: '目标语言', value: 'ts',
      options: LANGS.map((l) => [l.id, l.label]),
      onChange: run,
    });
    const rootName = textInput({ label: '根类型名', value: 'Root', onChange: run });
    const useInterface = toggle({ label: 'TypeScript 用 interface 而非 type', value: true, onChange: run });
    const exportKeyword = toggle({ label: 'TypeScript 加 export', value: true, onChange: run });
    const readonly = toggle({ label: 'TypeScript 加 readonly', value: false, onChange: run });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'JSON 样本' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例', () => { input.value = SAMPLE; run(); }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('选项', grid(lang, rootName), grid(useInterface, exportKeyword, readonly)),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '生成的类型定义' }), output, stat),
    );
    page.setActions(
      button('复制代码', () => copyWithFeedback(output.value, '已复制'), { primary: true }),
      button('下载文件', () => {
        if (!output.value) { toast('还没有内容', 'error'); return; }
        const l = LANGS.find((x) => x.id === lang.get());
        download(new Blob([output.value], { type: 'text/plain' }), `${rootName.get() || 'types'}.${l.ext}`);
        toast('已下载', 'ok');
      }),
    );
    app.main.append(page.root);

    input.addEventListener('input', run);

    function run() {
      const raw = input.value.trim();
      if (!raw) { output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; return; }

      let value;
      try {
        value = JSON.parse(raw);
      } catch (err) {
        output.value = '';
        stat.textContent = 'JSON 解析失败：' + err.message;
        stat.className = 'hint error';
        return;
      }

      const shape = mergeValues([value]);
      const l = LANGS.find((x) => x.id === lang.get());
      const opts = {
        useInterface: useInterface.get(),
        exportKeyword: exportKeyword.get(),
        readonly: readonly.get(),
        rootName: rootName.get().trim() || 'Root',
      };

      try {
        let code = l.emit(shape, opts);
        // 根类型名替换（各语言生成器统一用 Root）
        const rn = opts.rootName;
        if (rn && rn !== 'Root') code = code.replace(/\bRoot\b/g, rn);
        output.value = code;
        const shapes = new Map();
        collectShapes(shape, [], shapes);
        stat.textContent = `${l.label} · 生成 ${shapes.size} 个类型 · ${code.split('\n').length} 行`;
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = '生成失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    run();
    return () => { };
  },
};

const SAMPLE = JSON.stringify({
  id: 1001,
  name: 'ScanLike',
  active: true,
  score: 98.5,
  tags: ['pdf', 'scan', 'offline'],
  owner: { id: 7, email: 'owner@example.com', profile: { city: 'Shanghai', age: 30 } },
  items: [
    { sku: 'A-1', qty: 2, price: 19.9 },
    { sku: 'B-2', qty: 1, price: 5, note: '促销' },
  ],
  deletedAt: null,
}, null, 2);
