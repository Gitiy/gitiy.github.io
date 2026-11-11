# Markdown 编辑器（内嵌子应用）

fork 自 [MarkdownOnline](https://github.com/LiWeny16/MarkdownOnline)
（<https://md.bigonion.cn/>），MIT 协议，见 `LICENSE-MIT` 与 `LICENSES/report.md`。

这里放的是它 `docs/` 下的生产构建产物，为接入工具箱做了如下改造：

- 所有运行时 CDN 依赖（Monaco、KaTeX、Mermaid、markdown-it / footnote /
  incremental-dom、highlight.js、bigonion-kit）全部下载到 `vendor/`，
  并把构建产物里的 URL 改写为相对路径 —— 断网也能用，不依赖第三方站点。
- 原站的 CDN 竞速 helper 会强制把 URL 的 host 换成 CDN 域名，已改为按页面地址
  解析并去掉 host 覆盖。
- 去掉 GA4 统计、canonical / OG / JSON-LD 等原站 SEO 信息。
- 去掉自带的 PWA Service Worker 与 `registerSW.js`：工具箱只保留
  `tools/service-worker.js` 一个 SW，避免作用域冲突。
- 主题与外壳共用 `localStorage["tools.theme"]`；子应用启动时映射成它自己的
  `themeState`，外壳切换主题会通过 `storage` 事件触发子应用刷新。
- 以 iframe 内嵌时给 `<html>` 加 `data-embedded`。

AI 写作仍会调用原项目的远程接口，属于可选功能；文档内容始终存在浏览器本地。
