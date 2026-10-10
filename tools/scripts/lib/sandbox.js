/**
 * 隔离沙箱：用来执行不可信的混淆代码。
 *
 * 反混淆绕不开「跑一遍才知道结果」——JSFuck、JJEncode、AAEncode、Packer、
 * Obfuscator.io 的字符串解码函数都属于这一类。但直接在主页面 eval 别人的代码
 * 等于把整个站点的 DOM、localStorage、Cookie 全交出去，所以这里做了三层隔离：
 *
 * 1. `<iframe sandbox="allow-scripts">` —— 故意不给 allow-same-origin，
 *    沙箱文档会拿到一个不透明源（opaque origin），因此
 *      · 碰不到父页面的 DOM
 *      · 读不到本站的 localStorage / IndexedDB / Cookie
 *      · 同源请求会被当成跨源，带不上凭据
 * 2. 文档内 CSP `default-src 'none'` —— 掐断 fetch / XHR / WebSocket / 外部脚本，
 *    混淆代码没法回连服务器或加载远程载荷。
 * 3. 超时即销毁重建 —— 死循环无法从外部中断，只能把整个 iframe 扔掉换新的。
 *
 * 沙箱只回传字符串或可 JSON 序列化的值，不回传对象引用。
 */

const HARNESS = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'">
</head><body><script>
(function () {
  'use strict';

  function serialize(v) {
    if (typeof v === 'string') return { t: 'string', v: v };
    if (v === undefined) return { t: 'string', v: 'undefined' };
    if (v === null) return { t: 'string', v: 'null' };
    if (typeof v === 'function') return { t: 'string', v: String(v) };
    try {
      var s = JSON.stringify(v);
      if (typeof s === 'string') return { t: 'json', v: s };
    } catch (e) { /* 循环引用等 */ }
    return { t: 'string', v: String(v) };
  }

  // 把 eval 换掉，拦下被 eval 的源码 —— Packer / WiseLoop 这类解包的关键
  function captureEval(src) {
    var real = window.eval;
    var captured = null;
    window.eval = function (s) { captured = s; return s; };
    try { real(src); } catch (e) { /* 很多混淆代码在 eval 之后必然抛错 */ }
    finally { window.eval = real; }
    return captured;
  }

  // eval 完再取 toString —— JSFuck / JJEncode / AAEncode 的产物是个函数
  function evalToString(src) {
    var real = window.eval;
    var out = null;
    window.eval = real;   // 确保这里是真 eval
    try {
      var v = real(src);
      out = typeof v === 'function' ? v.toString() : String(v);
    } catch (e) {
      // 有些变体是把源码挂在返回值上，或者干脆抛错，这里再兜一次
      try { out = String(real(src)); } catch (e2) { out = null; }
    }
    return out;
  }

  // 先跑 head 定义好解码函数，再逐个求值 exprs
  function resolve(head, exprs) {
    var real = window.eval;
    real(head);
    var out = [];
    for (var i = 0; i < exprs.length; i++) {
      try { out.push(serialize(real(exprs[i]))); }
      catch (e) { out.push({ t: 'error', v: String(e && e.message || e) }); }
    }
    return out;
  }

  function run(kind, payload) {
    switch (kind) {
      case 'captureEval': return serialize(captureEval(payload.src));
      case 'evalToString': return serialize(evalToString(payload.src));
      case 'resolve': return serialize(resolve(payload.head, payload.exprs));
      case 'plain': return serialize(window.eval(payload.src));
      default: throw new Error('未知的沙箱指令：' + kind);
    }
  }

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg.id === 'undefined') return;
    var reply;
    try {
      reply = { id: msg.id, ok: true, result: run(msg.kind, msg.payload || {}) };
    } catch (err) {
      reply = { id: msg.id, ok: false, error: String(err && err.message || err) };
    }
    parent.postMessage(reply, '*');
  });

  parent.postMessage({ ready: true }, '*');
})();
<\/script></body></html>`;

let frame = null;
let readyPromise = null;
let seq = 0;
const pending = new Map();

function teardown() {
  if (frame) {
    frame.remove();
    frame = null;
  }
  readyPromise = null;
  for (const p of pending.values()) p.reject(new Error('沙箱已重建'));
  pending.clear();
}

function onMessage(e) {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.ready) return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new Error(msg.error || '沙箱执行失败'));
}

function ensureFrame() {
  if (readyPromise) return readyPromise;
  teardown();

  frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', '反混淆沙箱');
  frame.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;border:0;visibility:hidden';
  frame.srcdoc = HARNESS;

  readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('沙箱初始化超时')), 8000);
    const onReady = (e) => {
      if (e.source !== frame.contentWindow) return;
      if (!e.data || !e.data.ready) return;
      clearTimeout(timer);
      window.removeEventListener('message', onReady);
      resolve();
    };
    window.addEventListener('message', onReady);
  });

  document.body.appendChild(frame);
  window.addEventListener('message', onMessage);
  return readyPromise;
}

/**
 * 在沙箱里执行。
 * @param {'captureEval'|'evalToString'|'resolve'|'plain'} kind
 * @param {object} payload
 * @param {number} timeout 毫秒；超时后沙箱会被销毁重建
 */
export async function runInSandbox(kind, payload, timeout = 8000) {
  await ensureFrame();
  const id = ++seq;

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // 卡死的脚本没法从外部打断，只能把整个 iframe 丢掉
      teardown();
      reject(new Error(`沙箱执行超过 ${(timeout / 1000).toFixed(0)} 秒，已中止（代码里可能有死循环）`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    try {
      frame.contentWindow.postMessage({ id, kind, payload }, '*');
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err);
    }
  });

  return result;
}

/** 取出沙箱返回的字符串值 */
export async function sandboxString(kind, payload, timeout) {
  const r = await runInSandbox(kind, payload, timeout);
  if (r && r.t === 'error') throw new Error(r.v);
  return r ? r.v : '';
}

/** 取出沙箱返回的数组（resolve 用） */
export async function sandboxValues(kind, payload, timeout) {
  const r = await runInSandbox(kind, payload, timeout);
  let arr;
  try { arr = JSON.parse(r.v); } catch { arr = []; }
  if (!Array.isArray(arr)) throw new Error('沙箱返回了非数组结果');
  return arr;
}

/** 页面卸载前把 iframe 清掉 */
export function disposeSandbox() {
  window.removeEventListener('message', onMessage);
  teardown();
}
