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

### 格式转换（5）

| 工具 | 说明 |
|---|---|
| PDF 转 Word | 提取文字与段落生成可编辑 .docx（只还原文字，不还原复杂版式） |
| PDF 转 Excel | 按文字坐标还原成行列导出 .xlsx，表格型 PDF 效果好 |
| PDF 转 PPT | 每页渲染成一张图铺满一页幻灯片 |
| PDF 转 HTML | 按坐标绝对定位，视觉接近原版，文字可选中 |
| 图片转 PDF | 多图合成 PDF，可设页面尺寸、边距、填充方式 |

### Office 工具（4）

| 工具 | 说明 |
|---|---|
| Office 转 PDF | Word / Excel / PowerPoint → PDF，尽量保留排版 |
| Office 转图片 | Word / Excel / PowerPoint 逐页导出图片 |
| 表格格式转换 | Excel / CSV / TSV 互转，也可导出 JSON / HTML / Markdown |
| Excel 转 JSON | 首行作为字段名，输出对象数组或二维数组 |

### 图片 / 文本（3）

| 工具 | 说明 |
|---|---|
| 图片格式转换 | PNG / JPG / WebP 互转，可缩放、压缩、转灰度 |
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

**自己写了两块：**

- `scripts/lib/ooxml.js` —— 最小 OOXML 写出器。SheetJS 能写 xlsx 但写不了 docx/pptx，
  而现成的写库都偏大；这里只需要「文字段落」和「整页图片」两种最简结构，
  所以直接手写 ZIP + XML。
- `scripts/lib/office.js` —— 从 ScanLike 复制过来的 PPTX 渲染器（DrawingML 直接画到 Canvas），
  以及 Word / Excel 的渲染管线。

**文字水印和页码为什么走画布？** pdf-lib 自带的标准字体（Helvetica 等）不含中文字形，
直接 `drawText` 中文会乱码。这里先把文字画到 canvas 再当 PNG 嵌入，任意语言都正常。

**扫描件怎么处理？** 没有文字层的 PDF 提取不到文字，转 Word/Excel/HTML 会得到空文件。
这几个工具会先抽样检测文字层，没有就明确提示「需要先做 OCR」，而不是给你一个空文件。

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
│  ├─ lib/               共享能力：pdfkit / ooxml / table / draw / files / office
│  ├─ tools/             各个工具模块（一个文件一个工具）
│  └─ hosts.js flacmeta.js generator.js ifw.js   原有 4 个工具
├─ vendor/               本地化的第三方库
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

- 应用外壳与全部工具模块在 `install` 阶段预缓存 → **装好即可离线使用**
- 本机文件（html/css/js/json）走**网络优先**，改完代码刷新一次就能看到新版
- `vendor/` 走缓存优先（pdf.js worker 有 1MB，走缓存最快）
- cmaps / standard_fonts 首次用到时缓存，之后离线可用

改完代码如果看到的还是旧版，**强刷一次**（Ctrl+Shift+R）。
