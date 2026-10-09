/**
 * 工具目录。新增工具只需要在这里加一条，界面自动生成卡片、搜索、分类。
 *
 * 字段：
 *   id        唯一标识，同时作为 hash 路由（#id）
 *   name      卡片标题
 *   desc      卡片描述
 *   cat       分类 id（见 CATEGORIES）
 *   icon      卡片图标（emoji，无需额外资源）
 *   badge     角标：'hot' | 'new' | 空
 *   module    模块路径（相对本文件）；同一模块可被多条复用
 *   params    传给模块的参数，模块里通过 app.toolDef.params 读取
 *   url       外链型条目：直接跳转，不做 hash 路由（用于独立子应用）
 *   keywords  额外搜索关键词
 */

export const CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'pdf', name: 'PDF 工具' },
  { id: 'convert', name: '格式转换' },
  { id: 'office', name: 'Office 工具' },
  { id: 'image', name: '图片工具' },
  { id: 'text', name: '文本工具' },
  { id: 'misc', name: '其他工具' },
];

export const TOOLS = [
  /* ---------------- PDF 工具 ---------------- */
  {
    id: 'pdf-merge', name: 'PDF 合并', cat: 'pdf', icon: '🔗', badge: 'hot',
    desc: '把多个 PDF 的指定页面按顺序合并成一份新 PDF。支持逐份挑选页范围、调整顺序。',
    module: './tools/pdf-merge.js',
    keywords: '合并 拼接 merge 组合 多个pdf 拼页',
  },
  {
    id: 'pdf-split', name: 'PDF 拆分', cat: 'pdf', icon: '✂️', badge: 'hot',
    desc: '按页范围把 PDF 拆成多份，或把每一页单独导出。多份结果自动打包成 zip。',
    module: './tools/pdf-split.js',
    keywords: '拆分 分割 split 提取页面 分页 每页一个',
  },
  {
    id: 'pdf-pages', name: 'PDF 页面管理', cat: 'pdf', icon: '🗂️',
    desc: '缩略图里直接旋转、删除、拖动排序页面，再导出成新的 PDF。',
    module: './tools/pdf-pages.js',
    keywords: '页面 排序 旋转 删除 rotate delete reorder 组织',
  },
  {
    id: 'pdf-watermark', name: 'PDF 加水印', cat: 'pdf', icon: '💧',
    desc: '加文字或图片水印，支持平铺整页、任意角度、透明度与颜色调节。',
    module: './tools/pdf-watermark.js',
    keywords: '水印 watermark 平铺 版权 保密',
  },
  {
    id: 'pdf-pagenum', name: 'PDF 加页码', cat: 'pdf', icon: '🔢',
    desc: '批量添加页码，可选位置、起始编号、字体大小与「第 N 页 / 共 M 页」格式。',
    module: './tools/pdf-pagenum.js',
    keywords: '页码 页脚 page number 编号 标注',
  },
  {
    id: 'pdf-meta', name: 'PDF 元数据', cat: 'pdf', icon: '🏷️',
    desc: '查看并修改 PDF 的标题、作者、主题、关键词等元数据。',
    module: './tools/pdf-meta.js',
    keywords: '元数据 metadata 标题 作者 属性 信息',
  },
  {
    id: 'pdf-flatten', name: 'PDF 瘦身 / 转纯图', cat: 'pdf', icon: '🪶',
    desc: '把 PDF 栅格化重新压缩，大幅减小体积；也可转成纯图片版防止复制篡改。',
    module: './tools/pdf-flatten.js',
    keywords: '压缩 瘦身 减小体积 compress 纯图 防复制 降采样',
  },
  {
    id: 'pdf-resize', name: 'PDF 页面尺寸', cat: 'pdf', icon: '📐',
    desc: '统一改成 A4 / A3 / Letter 等标准尺寸，或按边距裁剪页面。',
    module: './tools/pdf-resize.js',
    keywords: '尺寸 裁剪 页面大小 a4 a3 letter 打印 边距 crop',
  },
  {
    id: 'pdf-to-image', name: 'PDF 转图片', cat: 'pdf', icon: '🖼️', badge: 'hot',
    desc: '逐页导出 PNG / JPG，可自定分辨率与图片质量，多页自动打包 zip。',
    module: './tools/pdf-to-image.js',
    keywords: '转图片 png jpg 截图 导出图片 dpi',
  },
  {
    id: 'pdf-text', name: 'PDF 提取文字', cat: 'pdf', icon: '📝',
    desc: '把 PDF 里的文字按页提取成纯文本，可复制或导出 txt。扫描件会明确提示。',
    module: './tools/pdf-text.js',
    keywords: '提取文字 文本 text 复制 抽取 内容',
  },
  {
    id: 'pdf-img-extract', name: 'PDF 图片提取', cat: 'pdf', icon: '🧲',
    desc: '把 PDF 内嵌的图片原样导出，不重新编码，保留原始清晰度。',
    module: './tools/pdf-img-extract.js',
    keywords: '提取图片 导出图片 内嵌图 extract image',
  },

  /* ---------------- 格式转换 ---------------- */
  {
    id: 'pdf-to-word', name: 'PDF 转 Word', cat: 'convert', icon: '📘', badge: 'new',
    desc: '提取文字与段落生成可编辑的 .docx。注意：只还原文字内容，不还原复杂版式。',
    module: './tools/pdf-convert.js', params: { mode: 'docx' },
    keywords: '转word docx 可编辑 转换',
  },
  {
    id: 'pdf-to-excel', name: 'PDF 转 Excel', cat: 'convert', icon: '📗', badge: 'new',
    desc: '按文字坐标还原成行列，导出 .xlsx。表格型 PDF 效果好，段落文本会退化成单列。',
    module: './tools/pdf-convert.js', params: { mode: 'xlsx' },
    keywords: '转excel xlsx 表格 数据 转换',
  },
  {
    id: 'pdf-to-ppt', name: 'PDF 转 PPT', cat: 'convert', icon: '📙', badge: 'new',
    desc: '每页渲染成一张图铺满一页幻灯片，导出 .pptx。适合把 PDF 当演示稿用。',
    module: './tools/pdf-convert.js', params: { mode: 'pptx' },
    keywords: '转ppt pptx 幻灯片 演示 转换',
  },
  {
    id: 'pdf-to-html', name: 'PDF 转 HTML', cat: 'convert', icon: '🌐',
    desc: '按坐标把文字绝对定位到 HTML，视觉上接近原版，可选中复制。',
    module: './tools/pdf-convert.js', params: { mode: 'html' },
    keywords: '转html 网页 转换',
  },
  {
    id: 'image-to-pdf', name: '图片转 PDF', cat: 'convert', icon: '🖼️',
    desc: '多张图片合成一份 PDF，可设置页边距、页面尺寸与图片自适应方式。',
    module: './tools/image-to-pdf.js',
    keywords: '图片 转pdf 合成 jpg png 合并',
  },

  /* ---------------- Office 工具 ---------------- */
  {
    id: 'office-to-pdf', name: 'Office 转 PDF', cat: 'office', icon: '📄', badge: 'hot',
    desc: 'Word / Excel / PowerPoint 转成 PDF，尽量保留原始排版。纯本地渲染，不用上传。',
    module: './tools/office-convert.js', params: { mode: 'pdf' },
    keywords: 'word excel ppt 转pdf docx xlsx pptx 转换',
  },
  {
    id: 'office-to-image', name: 'Office 转图片', cat: 'office', icon: '🏞️',
    desc: 'Word / Excel / PowerPoint 逐页导出 PNG / JPG，多页打包 zip。',
    module: './tools/office-convert.js', params: { mode: 'image' },
    keywords: 'word excel ppt 转图片 png jpg 导出',
  },
  {
    id: 'sheet-convert', name: '表格格式转换', cat: 'office', icon: '📊',
    desc: 'Excel / CSV / TSV 互转，可选工作表、自定分隔符与编码。',
    module: './tools/sheet-tools.js', params: { mode: 'convert' },
    keywords: 'excel csv tsv 互转 表格 xlsx',
  },
  {
    id: 'excel-to-json', name: 'Excel 转 JSON', cat: 'office', icon: '🧾',
    desc: '把工作表转成 JSON，首行作为字段名，支持数组或对象形式输出。',
    module: './tools/sheet-tools.js', params: { mode: 'json' },
    keywords: 'excel json 数据 转换 xlsx csv',
  },

  /* ---------------- 图片工具 ---------------- */
  {
    id: 'image-convert', name: '图片格式转换', cat: 'image', icon: '🔄',
    desc: 'PNG / JPG / WebP 互转，可调质量与尺寸，支持批量打包下载。',
    module: './tools/image-convert.js',
    keywords: '图片 转换 png jpg webp 压缩 缩放',
  },

  /* ---------------- 文本工具 ---------------- */
  {
    id: 'text-dedupe', name: '文本去重', cat: 'text', icon: '🧹',
    desc: '去掉重复行，可选忽略大小写、忽略空白、保留首次或末次出现。',
    module: './tools/text-dedupe.js',
    keywords: '去重 重复 行 清理 unique',
  },
  {
    id: 'text-diff', name: '文本比较', cat: 'text', icon: '🔍',
    desc: '逐行对比两段文本的差异，高亮新增与删除。',
    module: './tools/text-diff.js',
    keywords: '比较 diff 对比 差异 不同',
  },

  /* ---------------- 其他工具 ---------------- */
  {
    id: 'hosts', name: 'AdBlock Hosts Sort', cat: 'misc', icon: '🛡️',
    desc: '把 hosts 规则按域名分组排序，合并重复项，保留注释状态。',
    module: './hosts.js',
    keywords: 'hosts adblock 排序 分组 广告',
  },
  {
    id: 'flacmeta', name: 'FlacMate', cat: 'misc', icon: '🎵',
    desc: '读取 FLAC 文件的元数据块：流信息、标签、封面图等。',
    module: './flacmeta.js',
    keywords: 'flac 音乐 元数据 标签 封面',
  },
  {
    id: 'generator', name: '密码生成器', cat: 'misc', icon: '🔑',
    desc: '用密码学安全随机源生成密码，可指定字符类型与长度，记录存在本机。',
    module: './generator.js',
    keywords: '密码 随机 password 生成 安全',
  },
  {
    id: 'ifw', name: 'X-APM 转 IFW', cat: 'misc', icon: '⚙️',
    desc: '把 X-APM 导出的 JSON 转成 IFW 规则 XML。',
    module: './ifw.js',
    keywords: 'xapm ifw 规则 转换 xml',
  },
  {
    id: 'scanlike', name: 'ScanLike 扫描件生成器', cat: 'misc', icon: '📠', badge: 'hot',
    desc: '把 PDF / Word / Excel / PPT / 图片变成逼真的扫描件，纯本地处理，可离线。',
    url: './scanlike/',
    keywords: '扫描 扫描件 scan 噪点 泛黄 盖章 签名',
  },
];

export const findTool = (id) => TOOLS.find((t) => t.id === id);
