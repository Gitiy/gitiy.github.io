// 本地化包装：原站通过 CDN 动态 import() 这些库，这里改成从本地 UMD 单文件加载
const load = (src, key) => new Promise((res, rej) => {
  if (globalThis[key]) return res(globalThis[key]);
  const s = document.createElement('script');
  s.src = new URL(src, import.meta.url).href;
  s.onload = () => globalThis[key] ? res(globalThis[key]) : rej(new Error(key + ' 未挂载'));
  s.onerror = () => rej(new Error('加载失败: ' + src));
  document.head.appendChild(s);
});
export default await load('./markdown-it.min.js', 'markdownit');
