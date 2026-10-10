# Tools · 本地工具箱

纯前端工具箱，所有处理都在浏览器里完成，**文件不会上传**，装好之后**断网也能用**。
线上地址：<https://gitiy.github.io/tools/>

## 工具清单

### PDF 工具（11）

| 工具 | 说明 |
|---|---|
| PDF 合并 | 多份 PDF 按顺序合并，每份可单独指定页范围 |
| PDF 拆分 | 每页一个 / 每 N 页一份 / 自定义多段范围，多份结果打包 zip |
| PDF 页面管理 | 缩略图里旋转、删除、拖动排序 |
| PDF 加水印 | 文字或图片水印，平铺/居中/右下角，可调大小颜色透明度角度 |
| PDF 加页码 | 位置、起始编号、字号、颜色、`1 / 10`、`第 N 页 / 共 M 页` 等格式 |
| PDF 元数据 | 查看并修改标题、作者、主题、关键词等 |
| PDF 瘦身 / 转纯图 | 栅格化重压缩，可大幅减小体积；也可转纯图防复制 |
| PDF 页面尺寸 | 统一改成 A4/A3/Letter 等，或按边距裁剪（文字仍可选中） |
| PDF 转图片 | 逐页导出 PNG/JPG，可调 DPI 与质量 |
| PDF 提取文字 | 按页提取纯文本，可复制或导出 txt；扫描件会明确提示 |
| PDF 图片提取 | 原样导出内嵌图片，JPEG 直接取原始字节不重新编码 |

### 格式转换（2）

| 工具 | 说明 |
|---|---|
| **PDF 转换** | 一个入口切换 Word / Excel / PPT / HTML / 图片 五种目标格式。换格式不用重新拖文件，选项与按钮文案跟着切换 |
| 图片转 PDF | 多图合成 PDF，可设页面尺寸、边距、填充方式 |

### Office 工具（2）

| 工具 | 说明 |
|---|---|
| **Office 转换** | Word / Excel / PowerPoint → PDF 或图片，一个下拉框切换输出形式 |
| **表格转换** | Excel / CSV / TSV 互转，也可导出 JSON / HTML / Markdown；选到 JSON 时才出现 JSON 专属选项 |

> 这三组原先拆成了 9 张卡片（PDF 转 Word / Excel / PPT / HTML / 图片、Office 转 PDF / 图片、
> 表格格式转换 / Excel 转 JSON），同一件事按目标格式分成多个入口反而增加选择成本。
> 合并后底层模块没变，只是把「选格式」从「选卡片」挪进了工具内部。

### 图片工具（7）

| 工具 | 说明 |
|---|---|
| 图片压缩 | 用 MozJPEG / AVIF / OxiPNG 等真正的编解码器压缩，拖分割线实时对比画质与体积，可出质量-体积曲线 |
| 批量图片压缩 | 多张图用同一套参数压缩，逐张报告体积变化，完成后打包 zip |
| 图片缩放与裁剪 | 像素或百分比缩放（Lanczos3 重采样）、按比例中心裁剪，裁剪框可直接拖 |
| 图片加水印 | 文字或图片水印，位置/大小/旋转/透明度/平铺可调，实时预览 |
| 图片格式转换 | PNG / JPG / WebP 互转，可缩放、压缩、转灰度 |
| 图片转 Base64 | 转 Data URL / CSS 背景 / HTML img 标签 / Markdown，可直接内联进网页 |
| 图片取色器 | 点图取色，或自动提取主色板（中位切分法），给出 HEX / RGB / HSL |

### 开发者工具（25）

| 工具 | 说明 |
|---|---|
| JSON 格式化与校验 | 格式化/压缩/校验/排序键，出错时指出第几行第几列 |
| Base 系列编解码 | Base64 / URL-safe / Base32 / Base58 / 十六进制 / URL 编码 / HTML 实体，支持文件转 Base64 |
| 哈希与校验和 | MD5、SHA-1/256/384/512、SHA-3、Keccak-256、RIPEMD-160、CRC-32、Adler-32、HMAC |
| **JS 反混淆** | Packer / Obfuscator.io / JSFuck / JJEncode / AAEncode / 转义还原，需要执行代码时进隔离沙箱 |
| JWT 解码与校验 | 拆解头部与载荷、解析时间类声明、用密钥校验 HS256/384/512 签名 |
| UUID / ULID 生成 | UUID v1/v4/v7、ULID、NanoID、短 ID，并可校验已有 UUID 的格式与版本 |
| Cron 表达式解析 | 中文说明含义，列出接下来若干次执行时间，支持 5 段与 6 段 |
| 正则测试与替换 | 实时高亮匹配、列出捕获组、预览替换结果 |
| JSON 转类型定义 | 推断成 TypeScript / Go / Java / Python / Rust 类型，数组元素结构不一致时自动合并 |
| 数据格式转换 | JSON / YAML / TOML / XML / CSV / TSV 互转 |
| 进制转换 | 2–36 任意进制互转，BigInt 计算不丢精度，附位视图 |
| 命名风格转换 | 14 种命名风格互转，正确处理缩写词与中文 |
| 文本加解密 | AES-256-GCM + PBKDF2，密文自带盐值与参数；另有 MD5 摘要与 ROT13 |
| 密钥对生成 | RSA / ECDSA / Ed25519 / ECDH，导出 PEM 与 JWK |
| cURL 转代码 | 解析 cURL 命令，生成 10 种语言与工具的调用代码 |
| SQL 格式化 | 十多种数据库方言，可调关键字大小写与缩进 |
| HTML 转 Markdown | 表格与代码块都能保留，适合粘进文档与 Issue |
| SVG 压缩优化 | 去注释与编辑器元数据、收敛小数位、清理未引用的 id 与 defs |
| CIDR / 子网计算 | 网络地址、广播地址、可用主机范围、掩码写法、二进制视图 |
| 时间戳转换 | 秒/毫秒自动识别、时区切换、自定义格式、相对时间 |
| URL 解析与编辑 | 拆解各组成部分，可视化增删改查询参数 |
| 测试数据生成 | 姓名/邮箱/手机号/身份证号（校验位正确）/地址/公司，导出 JSON / CSV / SQL / TS |
| **简繁转换** | 简体 ↔ 繁体，支持台湾正体 / 香港繁体 / 通用繁体。用 OpenCC 词组词典，「头发 → 頭髮」这类看词境的转换也正确 |
| **二维码生成与识别** | 文本 / 网址 / WiFi / 名片 / 短信 / 电话 / 邮件七种内容类型，导出 PNG 或矢量 SVG；也能识别图片里的二维码并框出位置 |
| **词云图生成** | 把文字做成词云图，可选配色、外形、旋转比例与字号范围，导出 PNG。中文用 2/3 字组合近似分词 |

### 文本工具（2）

| 工具 | 说明 |
|---|---|
| 文本去重 | 去重复行，可选忽略大小写与空白、排序、保留首次或末次 |
| 文本比较 | 逐行 diff，高亮新增与删除 |

### 其他（5）

AdBlock Hosts Sort、FlacMate（FLAC 元数据）、密码生成器、X-APM 转 IFW，
以及独立子应用 **ScanLike**（扫描件生成器，见 `scanlike/`）。

## 技术说明

**全部客户端完成。** 用到的库都在 `vendor/` 下本地化，运行时不会请求任何外部地址：

| 库 | 用途 |
|---|---|
| pdf.js | PDF 解析、逐页渲染、文字层提取 |
| pdf-lib | PDF 写出：合并、拆分、水印、页码、元数据、页面尺寸 |
| JSZip | 打包下载、读写 OOXML 容器 |
| docx-preview | Word 文档渲染 |
| SheetJS | Excel / CSV 解析与写出 |
| html-to-image | DOM 栅格化（Word / Excel 走这条路） |
| js-yaml / smol-toml / fast-xml-parser | 数据格式转换 |
| turndown | HTML 转 Markdown |
| sql-formatter | SQL 格式化（15 种方言） |
| cronstrue | Cron 表达式的中文描述 |
| jjdecode | JJEncode 解码（纯字符串算法，不含 eval） |
| js-beautify | JS 代码格式化 |
| opencc-js | 简繁转换词典（cn2t 1.1MB / t2cn 107KB，按方向按需加载） |
| qrcode-generator | 二维码生成（另有 UTF-8 编码补丁模块） |
| jsQR | 二维码识别 |
| wordcloud2.js | 词云布局（螺旋排布 + 碰撞检测） |
| **jsquash（WASM）** | MozJPEG / OxiPNG / libavif / Lanczos3 四个图片编解码器 |

**自己写了三块：**

- `scripts/lib/ooxml.js` —— 最小 OOXML 写出器。SheetJS 能写 xlsx 但写不了 docx/pptx，
  而现成的写库都偏大；这里只需要「文字段落」和「整页图片」两种最简结构，
  所以直接手写 ZIP + XML。
- `scripts/lib/office.js` —— 从 ScanLike 复制过来的 PPTX 渲染器（DrawingML 直接画到 Canvas），
  以及 Word / Excel 的渲染管线。
- `scripts/lib/svg.js` —— SVG 优化器。没用 SVGO，因为它的浏览器包是从 CDN 直接分发的，
  内部对 sax / css-select / css-tree / css-what / csso 用的是绝对路径 import，而这些包
  又各自级联依赖，本地托管时全都要跟着改，加起来接近 1MB。这里用 DOMParser 覆盖了
  真正有用的那几项（元数据、数字精度、未使用的 id 与 defs、空容器、默认属性值、空白折叠）。
- `scripts/lib/hash.js`、`encode-text.js` —— MD5 / RIPEMD-160 / SHA-3 / Keccak-256 与
  Base32 / Base58 都是自己实现的（浏览器只提供 SHA-1/2 系列），用官方测试向量逐个核对过。

**文字水印和页码为什么走画布？** pdf-lib 自带的标准字体（Helvetica 等）不含中文字形，
直接 `drawText` 中文会乱码。这里先把文字画到 canvas 再当 PNG 嵌入，任意语言都正常。

**图片压缩为什么不用 canvas.toBlob？** 实测 Chrome 只能原生编码 baseline JPEG 和 WebP，
**不支持 AVIF**，JPEG 也没有 MozJPEG 的渐进式与网格量化。同一张 480×320 测试图：

| 编码器 | 体积 |
|---|---|
| PNG 原图 | 210.7 KB |
| 浏览器原生 JPEG q72 | 24.6 KB |
| MozJPEG q72 | 21.4 KB（小 13%） |
| AVIF q55 | 14.1 KB（只有原图 7%） |
| OxiPNG lv3（无损） | 92.8 KB（砍掉 56%） |

所以直接挂 squoosh 用的那几个 WASM 编解码器（`vendor/jsquash/`，共 4.3 MB）。
AVIF 编码器独占 3.4 MB，**不参与预缓存**，首次选用时才下载。

**扫描件怎么处理？** 没有文字层的 PDF 提取不到文字，转 Word/Excel/HTML 会得到空文件。
这几个工具会先抽样检测文字层，没有就明确提示「需要先做 OCR」，而不是给你一个空文件。

**JS 反混淆怎么保证安全？** 反混淆绕不开「跑一遍才知道结果」（JSFuck、AAEncode、
Obfuscator.io 的字符串解码函数都属于这类）。直接在主页面 eval 别人的代码等于把整个站点的
DOM、localStorage、Cookie 全交出去，所以做了三层隔离：

1. `<iframe sandbox="allow-scripts">` —— 故意不给 `allow-same-origin`，沙箱文档拿到的是
   不透明源（opaque origin），碰不到父页面 DOM，也读不到本站的存储与 Cookie；
2. 文档内 CSP `default-src 'none'` —— 掐断 fetch / XHR / WebSocket / 外部脚本，
   混淆代码没法回连服务器；
3. 超时即销毁重建 —— 死循环无法从外部中断，只能把整个 iframe 扔掉换新的。

另外能纯字符串处理的绝不 eval：Packer、JavaScript Obfuscator、MyObfuscate、URL 编码
都是确定性算法，直接按算法实现。所有替换都走一个字符串感知的分词器，只对代码段做变换 ——
de4js 那套正则直接作用在整份源码上，遇到字符串里恰好含有 `0x1a` 或 `![]` 就会改坏内容。

## 目录结构

```
tools/
├─ index.html            外壳：顶栏 + 搜索 + 分类 + 卡片网格
├─ manifest.json         PWA 清单
├─ service-worker.js     离线缓存
├─ styles/index.css      样式（亮/暗双主题，light-dark() 一套定义）
├─ scripts/
│  ├─ app.js             外壳逻辑：路由、搜索、分类过滤、主题
│  ├─ registry.js        工具目录（新增工具改这里）
│  ├─ ui.js              共享 UI 组件：表单、拖放区、进度、预览、提示
│  ├─ lib/               共享能力
│  │   ├─ pdfkit.js      PDF 加载/渲染/页范围/文字层探测
│  │   ├─ ooxml.js       最小 DOCX / PPTX 写出器
│  │   ├─ office.js      Office 渲染管线
│  │   ├─ table.js       文字坐标聚成行列
│  │   ├─ draw.js        画布文字绘制（中文水印/页码用）
│  │   ├─ codecs.js      图片编解码统一入口（jsquash 封装）
│  │   ├─ sandbox.js     不透明源 iframe 沙箱
│  │   ├─ deobfuscate.js JS 反混淆（分词器 + 各解包算法）
│  │   ├─ hash.js        MD5 / RIPEMD-160 / SHA-3 / CRC-32
│  │   ├─ encode-text.js Base32 / Base58 / 命名风格转换
│  │   ├─ formats.js     YAML / TOML / XML / CSV 互转
│  │   ├─ svg.js         SVG 优化器
│  │   ├─ scripts.js     第三方库按需加载
│  │   └─ files.js       下载、打包、格式化
│  ├─ tools/             各个工具模块（一个文件一个工具）
│  └─ hosts.js flacmeta.js generator.js ifw.js   原有 4 个工具
├─ vendor/               本地化的第三方库（含 jsquash 的 WASM 编解码器）
└─ scanlike/             独立子应用：扫描件生成器
```

## 新增一个工具

1. 在 `scripts/tools/` 下建模块，导出 `tool`：

```js
import { toolPage, fileZone, button } from '../ui.js';

export const tool = {
  init(app) {
    const page = toolPage({ title: '示例工具', icon: '🔧', desc: '一句话说明' });
    page.add(fileZone({ accept: '.pdf', onFiles: (files) => console.log(files) }));
    page.setActions(button('开始', () => { }, { primary: true }));
    app.main.append(page.root);
    return () => { /* 可选：清理定时器、blob URL */ };
  },
};
```

2. 在 `scripts/registry.js` 的 `TOOLS` 里加一条（`id` / `name` / `desc` / `cat` / `icon` / `module`）。
   同一个模块可以被多条复用，用 `params` 区分，例如 PDF 转 Word/Excel/PPT/HTML 共用 `pdf-convert.js`。
3. 把模块加进 `service-worker.js` 的 `CORE` 列表，这样离线也能用。

界面、卡片、搜索、分类都会自动生成，不需要改 HTML。

## 离线行为

`service-worker.js` 的策略：

- 应用外壳、全部工具模块、共享库、图标在 `install` 阶段预缓存
  → **装好即可离线使用**
- 体积小的第三方库（js-yaml / turndown / cronstrue / sql-formatter / smol-toml /
  wordcloud2 / qrcode / jsQR / opencc 的 t2cn 等）也一起预缓存，所以开发者工具离线也能用
- **大文件不预缓存，首次用到时按需写入**：jsquash 的 WASM 编解码器（4.2 MB，AVIF 独占 3.4 MB）
  与 opencc 的 cn2t 简→繁词典（1.1 MB）
- 本机文件（html/css/js/json）走**网络优先**，改完代码刷新一次就能看到新版
- `vendor/` 其余部分走缓存优先（pdf.js worker 有 1 MB，走缓存最快）
- cmaps / standard_fonts 首次用到时缓存，之后离线可用

改完代码如果看到的还是旧版，**强刷一次**（Ctrl+Shift+R）。如果是复用同一个浏览器
profile 反复测试，旧的 Service Worker 可能仍在提供缓存内容 —— 换个 profile 或清掉
站点数据即可。
