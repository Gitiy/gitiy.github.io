import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  copyWithFeedback, toast, textInput,
} from '../ui.js';
import { download, stamp } from '../lib/files.js';

/* ============================================================
   cURL 解析
   ============================================================ */

/** 把命令按 shell 规则切成参数，处理引号、转义与换行续行 */
function shellSplit(cmd) {
  const text = cmd.replace(/\\\r?\n/g, ' ').replace(/\r?\n/g, ' ').trim();
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') {
        const n = text[i + 1];
        cur += n === '"' || n === '\\' || n === '$' ? n : '\\' + (n ?? '');
        i++;
        continue;
      }
      if (c === quote) { quote = null; continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (c === '\\') { cur += text[i + 1] ?? ''; i++; started = true; continue; }
    if (/\s/.test(c)) {
      if (started || cur) { out.push(cur); cur = ''; started = false; }
      continue;
    }
    cur += c;
    started = true;
  }
  if (started || cur) out.push(cur);
  return out;
}

export function parseCurl(cmd) {
  const args = shellSplit(cmd.replace(/^\s*\$?\s*curl\s+/i, ''));
  if (!args.length) throw new Error('命令是空的');

  const req = {
    method: '', url: '', headers: [], data: null, dataRaw: null,
    user: null, cookies: [], forms: [], insecure: false, followRedirects: false,
    compressed: false, timeout: null, userAgent: null, output: null,
  };

  const needValue = (i, name) => {
    const v = args[i + 1];
    if (v === undefined) throw new Error(`${name} 后面缺少参数`);
    return v;
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-X': case '--request': req.method = needValue(i, a).toUpperCase(); i++; break;
      case '-H': case '--header': {
        const h = needValue(i, a);
        const idx = h.indexOf(':');
        if (idx < 0) throw new Error(`请求头「${h}」缺少冒号`);
        req.headers.push({ name: h.slice(0, idx).trim(), value: h.slice(idx + 1).trim() });
        i++;
        break;
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii':
        req.dataRaw = (req.dataRaw ? req.dataRaw + '&' : '') + needValue(i, a); i++; break;
      case '--data-urlencode': {
        const v = needValue(i, a);
        const eq = v.indexOf('=');
        req.dataRaw = (req.dataRaw ? req.dataRaw + '&' : '') + (eq < 0 ? v : v.slice(0, eq) + '=' + encodeURIComponent(v.slice(eq + 1)));
        i++;
        break;
      }
      case '-u': case '--user': req.user = needValue(i, a); i++; break;
      case '-b': case '--cookie': req.cookies.push(needValue(i, a)); i++; break;
      case '-F': case '--form': {
        const f = needValue(i, a);
        const eq = f.indexOf('=');
        req.forms.push({ name: f.slice(0, eq), value: f.slice(eq + 1) });
        i++;
        break;
      }
      case '-A': case '--user-agent': req.userAgent = needValue(i, a); i++; break;
      case '-o': case '--output': req.output = needValue(i, a); i++; break;
      case '-m': case '--max-time': req.timeout = Number(needValue(i, a)); i++; break;
      case '-k': case '--insecure': req.insecure = true; break;
      case '-L': case '--location': req.followRedirects = true; break;
      case '--compressed': req.compressed = true; break;
      case '-I': case '--head': req.method = 'HEAD'; break;
      case '-G': case '--get': req.method = 'GET'; break;
      default:
        if (a.startsWith('-')) {
          // 未知选项，忽略但记录
          if (a.length === 2 && args[i + 1] && !args[i + 1].startsWith('-')) i++;
        } else if (!req.url) {
          req.url = a;
        }
    }
  }

  if (!req.url) throw new Error('没找到 URL');
  if (!req.method) req.method = req.dataRaw || req.forms.length ? 'POST' : 'GET';

  // -d 的内容如果是 JSON，标记出来方便生成代码
  if (req.dataRaw) {
    try { JSON.parse(req.dataRaw); req.data = req.dataRaw; req.isJson = true; } catch { req.isJson = false; }
  }
  return req;
}

/* ============================================================
   各语言代码生成
   ============================================================ */

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const dq = (s) => JSON.stringify(String(s));

function headersObj(req, indent = '  ') {
  return req.headers.map((h) => `${indent}${dq(h.name)}: ${dq(h.value)},`).join('\n');
}

const TARGETS = {
  fetch: {
    label: 'JavaScript (fetch)', ext: 'js',
    gen: (req) => {
      const hasBody = req.dataRaw !== null || req.forms.length;
      const lines = [`const res = await fetch(${dq(req.url)}, {`];
      lines.push(`  method: ${dq(req.method)},`);
      if (req.headers.length) lines.push(`  headers: {\n${headersObj(req, '    ')}\n  },`);
      if (req.forms.length) {
        lines.push(`  body: (() => { const fd = new FormData();`);
        for (const f of req.forms) lines.push(`    fd.append(${dq(f.name)}, ${dq(f.value)});`);
        lines.push(`    return fd; })(),`);
      } else if (hasBody) {
        lines.push(`  body: ${req.isJson ? `JSON.stringify(${req.dataRaw})` : dq(req.dataRaw)},`);
      }
      if (req.cookies.length) lines.push(`  credentials: 'include',`);
      lines.push(`});`, ``, `const data = await res.json();`, `console.log(data);`);
      return lines.join('\n');
    },
  },
  axios: {
    label: 'JavaScript (axios)', ext: 'js',
    gen: (req) => {
      const cfg = [`  method: ${dq(req.method.toLowerCase())},`, `  url: ${dq(req.url)},`];
      if (req.headers.length) cfg.push(`  headers: {\n${headersObj(req, '    ')}\n  },`);
      if (req.dataRaw !== null) cfg.push(`  data: ${req.isJson ? req.dataRaw : dq(req.dataRaw)},`);
      if (req.user) {
        const [u, p] = req.user.split(':');
        cfg.push(`  auth: { username: ${dq(u || '')}, password: ${dq(p || '')} },`);
      }
      if (req.timeout) cfg.push(`  timeout: ${req.timeout * 1000},`);
      return `import axios from 'axios';\n\nconst { data } = await axios({\n${cfg.join('\n')}\n});\n\nconsole.log(data);`;
    },
  },
  python: {
    label: 'Python (requests)', ext: 'py',
    gen: (req) => {
      const lines = ['import requests', '', `url = ${dq(req.url)}`];
      if (req.headers.length) {
        lines.push('', 'headers = {');
        for (const h of req.headers) lines.push(`    ${dq(h.name)}: ${dq(h.value)},`);
        lines.push('}');
      }
      const args = ['url'];
      if (req.headers.length) args.push('headers=headers');
      if (req.forms.length) {
        lines.push('', 'files = {');
        for (const f of req.forms) lines.push(`    ${dq(f.name)}: (None, ${dq(f.value)}),`);
        lines.push('}');
        args.push('files=files');
      } else if (req.dataRaw !== null) {
        if (req.isJson) {
          lines.push('', `payload = ${req.dataRaw.replace(/true/g, 'True').replace(/false/g, 'False').replace(/null/g, 'None')}`);
          args.push('json=payload');
        } else {
          lines.push('', `payload = ${dq(req.dataRaw)}`);
          args.push('data=payload');
        }
      }
      if (req.user) args.push(`auth=(${dq(req.user.split(':')[0] || '')}, ${dq(req.user.split(':')[1] || '')})`);
      if (req.cookies.length) args.push(`cookies={${req.cookies.map((c) => {
        const [k, v] = c.split('=');
        return `${dq(k)}: ${dq(v || '')}`;
      }).join(', ')}}`);
      if (req.timeout) args.push(`timeout=${req.timeout}`);
      if (req.insecure) args.push('verify=False');
      lines.push('', `response = requests.${req.method.toLowerCase()}(${args.join(', ')})`);
      lines.push('', 'print(response.status_code)', 'print(response.text)');
      return lines.join('\n');
    },
  },
  go: {
    label: 'Go (net/http)', ext: 'go',
    gen: (req) => {
      const lines = [
        'package main', '',
        'import (', '\t"fmt"', '\t"io"',
        req.dataRaw !== null ? '\t"strings"' : null,
        '\t"net/http"', ')', '',
        'func main() {',
      ].filter((x) => x !== null);
      if (req.dataRaw !== null) {
        lines.push(`\tbody := strings.NewReader(${dq(req.dataRaw)})`);
        lines.push(`\treq, err := http.NewRequest(${dq(req.method)}, ${dq(req.url)}, body)`);
      } else {
        lines.push(`\treq, err := http.NewRequest(${dq(req.method)}, ${dq(req.url)}, nil)`);
      }
      lines.push('\tif err != nil {', '\t\tpanic(err)', '\t}');
      for (const h of req.headers) lines.push(`\treq.Header.Set(${dq(h.name)}, ${dq(h.value)})`);
      if (req.user) lines.push(`\treq.SetBasicAuth(${dq(req.user.split(':')[0] || '')}, ${dq(req.user.split(':')[1] || '')})`);
      lines.push('', '\tclient := &http.Client{}', '\tresp, err := client.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer resp.Body.Close()', '',
        '\tbodyBytes, _ := io.ReadAll(resp.Body)', '\tfmt.Println(resp.Status)', '\tfmt.Println(string(bodyBytes))', '}');
      return lines.join('\n');
    },
  },
  php: {
    label: 'PHP (cURL)', ext: 'php',
    gen: (req) => {
      const lines = ['<?php', '', '$ch = curl_init();', '', 'curl_setopt_array($ch, ['];
      lines.push(`    CURLOPT_URL => ${q(req.url)},`);
      lines.push(`    CURLOPT_RETURNTRANSFER => true,`);
      lines.push(`    CURLOPT_CUSTOMREQUEST => ${q(req.method)},`);
      if (req.headers.length) {
        lines.push('    CURLOPT_HTTPHEADER => [');
        for (const h of req.headers) lines.push(`        ${q(h.name + ': ' + h.value)},`);
        lines.push('    ],');
      }
      if (req.dataRaw !== null) lines.push(`    CURLOPT_POSTFIELDS => ${q(req.dataRaw)},`);
      if (req.user) lines.push(`    CURLOPT_USERPWD => ${q(req.user)},`);
      if (req.insecure) lines.push('    CURLOPT_SSL_VERIFYPEER => false,');
      if (req.followRedirects) lines.push('    CURLOPT_FOLLOWLOCATION => true,');
      lines.push(']);', '', '$response = curl_exec($ch);', '$err = curl_error($ch);', 'curl_close($ch);', '',
        'if ($err) {', '    echo "cURL Error: " . $err;', '} else {', '    echo $response;', '}');
      return lines.join('\n');
    },
  },
  java: {
    label: 'Java (OkHttp)', ext: 'java',
    gen: (req) => {
      const lines = [
        'import okhttp3.*;', 'import java.io.IOException;', '',
        'public class Request {', '  public static void main(String[] args) throws IOException {',
        '    OkHttpClient client = new OkHttpClient();', '',
      ];
      if (req.dataRaw !== null) {
        lines.push(`    MediaType mediaType = MediaType.parse(${dq(req.isJson ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded')});`);
        lines.push(`    RequestBody body = RequestBody.create(${dq(req.dataRaw)}, mediaType);`);
      }
      lines.push('    Request request = new Request.Builder()');
      lines.push(`        .url(${dq(req.url)})`);
      if (req.dataRaw !== null) lines.push('        .method(' + dq(req.method) + ', body)');
      else if (req.method !== 'GET') lines.push(`        .method(${dq(req.method)}, null)`);
      for (const h of req.headers) lines.push(`        .addHeader(${dq(h.name)}, ${dq(h.value)})`);
      if (req.user) {
        const token = btoaSafe(req.user);
        lines.push(`        .addHeader("Authorization", ${dq('Basic ' + token)})`);
      }
      lines.push('        .build();', '', '    try (Response response = client.newCall(request).execute()) {',
        '      System.out.println(response.code());', '      System.out.println(response.body().string());', '    }', '  }', '}');
      return lines.join('\n');
    },
  },
  csharp: {
    label: 'C# (HttpClient)', ext: 'cs',
    gen: (req) => {
      const lines = ['using System;', 'using System.Net.Http;', 'using System.Text;', 'using System.Threading.Tasks;', '',
        'class Program', '{', '    static async Task Main()', '    {', '        using var client = new HttpClient();'];
      if (req.headers.length) {
        for (const h of req.headers) {
          if (/^(content-type|authorization)$/i.test(h.name)) continue;
          lines.push(`        client.DefaultRequestHeaders.TryAddWithoutValidation(${dq(h.name)}, ${dq(h.value)});`);
        }
      }
      if (req.user) lines.push(`        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(${dq(req.user)})));`);
      lines.push('');
      if (req.dataRaw !== null) {
        lines.push(`        var content = new StringContent(${dq(req.dataRaw)}, Encoding.UTF8, ${dq(req.isJson ? 'application/json' : 'application/x-www-form-urlencoded')});`);
        lines.push(`        var response = await client.${methodName(req.method)}Async(${dq(req.url)}, content);`);
      } else {
        lines.push(`        var response = await client.${methodName(req.method)}Async(${dq(req.url)});`);
      }
      lines.push('        var body = await response.Content.ReadAsStringAsync();', '        Console.WriteLine(response.StatusCode);', '        Console.WriteLine(body);', '    }', '}');
      return lines.join('\n');
    },
  },
  ruby: {
    label: 'Ruby (Net::HTTP)', ext: 'rb',
    gen: (req) => {
      const lines = ["require 'net/http'", "require 'uri'", "require 'json'", '',
        `uri = URI.parse(${dq(req.url)})`,
        `http = Net::HTTP.new(uri.host, uri.port)`,
        `http.use_ssl = uri.scheme == 'https'`,
        req.insecure ? 'http.verify_mode = OpenSSL::SSL::VERIFY_NONE' : null,
        '',
        `request = Net::HTTP::${methodName(req.method, true)}.new(uri.request_uri)`,
      ].filter((x) => x !== null);
      for (const h of req.headers) lines.push(`request[${dq(h.name)}] = ${dq(h.value)}`);
      if (req.user) lines.push(`request.basic_auth(${dq(req.user.split(':')[0] || '')}, ${dq(req.user.split(':')[1] || '')})`);
      if (req.dataRaw !== null) lines.push(`request.body = ${dq(req.dataRaw)}`);
      lines.push('', 'response = http.request(request)', 'puts response.code', 'puts response.body');
      return lines.join('\n');
    },
  },
  rust: {
    label: 'Rust (reqwest)', ext: 'rs',
    gen: (req) => {
      const lines = ['use reqwest::header::{HeaderMap, HeaderName, HeaderValue};', '',
        '#[tokio::main]', 'async fn main() -> Result<(), Box<dyn std::error::Error>> {'];
      if (req.headers.length) {
        lines.push('    let mut headers = HeaderMap::new();');
        for (const h of req.headers) {
          lines.push(`    headers.insert(HeaderName::from_static(${dq(h.name.toLowerCase())}), HeaderValue::from_static(${dq(h.value)}));`);
        }
      }
      lines.push('', `    let client = reqwest::Client::new();`);
      const parts = [`client.${methodName(req.method)}(${dq(req.url)})`];
      if (req.headers.length) parts.push('        .headers(headers)');
      if (req.dataRaw !== null) parts.push(`        .body(${dq(req.dataRaw)})`);
      if (req.user) parts.push(`        .basic_auth(${dq(req.user.split(':')[0] || '')}, Some(${dq(req.user.split(':')[1] || '')}))`);
      parts.push('        .send()', '        .await?;');
      lines.push('    let resp = ' + parts.join('\n'));
      lines.push('', '    println!("{}", resp.status());', '    println!("{}", resp.text().await?);', '    Ok(())', '}');
      return lines.join('\n');
    },
  },
  httpie: {
    label: 'HTTPie（命令行）', ext: 'sh',
    gen: (req) => {
      const parts = [`http ${req.method} ${dq(req.url)}`];
      for (const h of req.headers) parts.push(`  ${dq(h.name + ':' + h.value)}`);
      if (req.dataRaw !== null) parts.push(`  ${dq(req.dataRaw)}`);
      if (req.user) parts.push(`  -a ${dq(req.user)}`);
      if (req.insecure) parts.push('  --verify=no');
      return parts.join(' \\\n');
    },
  },
};

function btoaSafe(s) {
  try { return btoa(s); } catch { return '/* base64(' + s + ') */'; }
}

function methodName(m, ruby = false) {
  const map = { GET: 'Get', POST: 'Post', PUT: 'Put', DELETE: 'Delete', PATCH: 'Patch', HEAD: 'Head', OPTIONS: 'Options' };
  const v = map[m] || 'Get';
  return ruby ? v : v;
}

export const tool = {
  init(app) {
    const page = toolPage({
      title: 'cURL 转代码',
      icon: '🔄',
      desc: '把 cURL 命令解析成结构化请求，再生成 10 种语言/工具的调用代码。请求头、表单、认证、代理参数都能识别。',
    });

    const input = el('textarea', { class: 'input mono', rows: 8, placeholder: "curl -X POST 'https://api.example.com/v1/items' -H 'Content-Type: application/json' -d '{\"name\":\"x\"}'", 'aria-label': 'cURL 命令' });
    const output = el('textarea', { class: 'input mono', rows: 20, readonly: true, 'aria-label': '生成的代码' });
    const parsed = el('div', { class: 'kv-list' });
    const stat = note('等待输入');

    const target = select({
      label: '目标语言', value: 'fetch',
      options: Object.entries(TARGETS).map(([k, v]) => [k, v.label]),
      onChange: run,
    });

    page.add(
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'cURL 命令' }), input),
        el('div', { class: 'row', style: { marginTop: '.5rem' } },
          button('示例（JSON POST）', () => { input.value = SAMPLE_JSON; run(); }, { small: true }),
          button('示例（表单 + 认证）', () => { input.value = SAMPLE_FORM; run(); }, { small: true }),
          button('清空', () => { input.value = ''; output.value = ''; parsed.replaceChildren(); stat.textContent = '等待输入'; stat.className = 'hint'; }, { small: true }),
        ),
      ),
      fieldset('生成设置', target),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '解析出的请求' }), parsed),
      el('div', { class: 'card' }, el('p', { class: 'field-hint', text: '生成的代码' }), output, stat),
    );
    page.setActions(
      button('生成代码', run, { primary: true }),
      button('复制代码', () => copyWithFeedback(output.value, '已复制')),
      button('下载', () => {
        if (!output.value) { toast('还没有结果', 'error'); return; }
        const t = TARGETS[target.get()];
        download(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), `请求代码_${stamp()}.${t.ext}`);
        toast('已下载', 'ok');
      }),
    );
    app.main.append(page.root);

    let timer = 0;
    input.addEventListener('input', run);

    function run() {
      clearTimeout(timer);
      timer = setTimeout(doRun, 150);
    }

    function doRun() {
      parsed.replaceChildren();
      const cmd = input.value.trim();
      if (!cmd) { output.value = ''; stat.textContent = '等待输入'; stat.className = 'hint'; return; }

      let req;
      try {
        req = parseCurl(cmd);
      } catch (err) {
        output.value = '';
        stat.textContent = '解析失败：' + err.message;
        stat.className = 'hint error';
        return;
      }

      const rows = [
        ['方法', req.method],
        ['URL', req.url],
        ['请求头', req.headers.length ? req.headers.map((h) => `${h.name}: ${h.value}`).join('\n') : '（无）'],
        ['请求体', req.dataRaw !== null ? (req.isJson ? `${req.dataRaw}（识别为 JSON）` : req.dataRaw) : '（无）'],
        ['表单字段', req.forms.length ? req.forms.map((f) => `${f.name}=${f.value}`).join(', ') : '（无）'],
        ['基本认证', req.user || '（无）'],
        ['Cookie', req.cookies.join('; ') || '（无）'],
        ['跟随重定向', req.followRedirects ? '是' : '否'],
        ['忽略证书校验', req.insecure ? '是' : '否'],
      ];
      for (const [k, v] of rows) {
        parsed.append(el('div', { class: 'kv-row' },
          el('span', { class: 'kv-key', text: k }),
          el('code', { class: 'kv-val', text: v }),
        ));
      }

      try {
        output.value = TARGETS[target.get()].gen(req);
        stat.textContent = `已生成 ${TARGETS[target.get()].label} 代码 · ${output.value.split('\n').length} 行`;
        stat.className = 'hint ok';
      } catch (err) {
        output.value = '';
        stat.textContent = '生成失败：' + err.message;
        stat.className = 'hint error';
      }
    }

    run();
    return () => { clearTimeout(timer); };
  },
};

const SAMPLE_JSON = `curl -X POST 'https://api.example.com/v1/items?dryRun=true' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.demo' \\
  -d '{"name":"测试条目","qty":3,"tags":["a","b"],"active":true}'`;

const SAMPLE_FORM = `curl -u 'user:pass' -L -k \\
  -d 'username=demo&password=s3cret' \\
  -b 'session=abc123' \\
  https://example.com/login`;
