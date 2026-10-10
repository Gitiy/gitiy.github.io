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
  { id: 'dev', name: '开发者工具' },
  { id: 'pdf', name: 'PDF 工具' },
  { id: 'convert', name: '格式转换' },
  { id: 'office', name: 'Office 工具' },
  { id: 'image', name: '图片工具' },
  { id: 'text', name: '文本工具' },
  { id: 'misc', name: '其他工具' },
];

export const TOOLS = [
  /* ============================================================
     开发者工具
     ============================================================ */
  {
    id: 'dev-json', name: 'JSON 格式化与校验', cat: 'dev', icon: '🧩', badge: 'hot',
    desc: '格式化、压缩、校验并分析 JSON。出错时直接指出第几行第几列，而不是一句 Unexpected token。',
    module: './tools/dev-json.js',
    keywords: 'json 格式化 美化 校验 压缩 排序 format validate pretty minify',
  },
  {
    id: 'dev-encode', name: 'Base 系列编解码', cat: 'dev', icon: '🔤', badge: 'hot',
    desc: 'Base64 / URL-safe / Base32 / Base58 / 十六进制 / URL 编码 / HTML 实体互转，支持中文与 emoji，也能把文件转成 Base64。',
    module: './tools/dev-encode.js',
    keywords: 'base64 base32 base58 hex 编码 解码 转码 url encode 文件',
  },
  {
    id: 'dev-hash', name: '哈希与校验和', cat: 'dev', icon: '#️⃣', badge: 'hot',
    desc: 'MD5、SHA-1/256/384/512、SHA-3、Keccak-256、RIPEMD-160、CRC-32、Adler-32，支持文本与文件，还能算 HMAC。',
    module: './tools/dev-hash.js',
    keywords: 'md5 sha sha1 sha256 sha3 keccak ripemd crc32 adler 哈希 摘要 校验和 hmac',
  },
  {
    id: 'dev-deobfuscate', name: 'JS 反混淆', cat: 'dev', icon: '🧿', badge: 'new',
    desc: '还原被混淆的 JavaScript：Packer / Obfuscator.io / JSFuck / JJEncode / AAEncode / 十六进制转义等。需要执行代码时放进隔离沙箱。',
    module: './tools/dev-deobfuscate.js',
    keywords: 'js javascript 反混淆 解混淆 解密 还原 deobfuscate unpack unpacker packer jsfuck jjencode aaencode obfuscator eval 混淆',
  },
  {
    id: 'dev-jwt', name: 'JWT 解码与校验', cat: 'dev', icon: '🎫',
    desc: '拆解 JSON Web Token 的头部与载荷，解析时间类声明，并用密钥校验 HS256/384/512 签名。',
    module: './tools/dev-jwt.js',
    keywords: 'jwt token 令牌 解码 校验 签名 bearer 鉴权',
  },
  {
    id: 'dev-uuid', name: 'UUID / ULID 生成', cat: 'dev', icon: '🆔',
    desc: '批量生成 UUID v4 / v7 / v1、ULID、NanoID、短 ID，并可校验已有 UUID 的格式与版本。',
    module: './tools/dev-uuid.js',
    keywords: 'uuid ulid nanoid 唯一 id 生成 guid 主键',
  },
  {
    id: 'dev-cron', name: 'Cron 表达式解析', cat: 'dev', icon: '⏰',
    desc: '解析 5 段或 6 段 Cron 表达式，用中文说明含义，并列出接下来若干次执行时间。',
    module: './tools/dev-cron.js',
    keywords: 'cron 定时 表达式 解析 计划任务 crontab 调度',
  },
  {
    id: 'dev-regex', name: '正则测试与替换', cat: 'dev', icon: '🔍',
    desc: '实时高亮匹配结果，列出每个匹配与捕获组，并预览替换后的文本。支持所有 JS 正则标志。',
    module: './tools/dev-regex.js',
    keywords: '正则 regex 匹配 替换 测试 捕获组 表达式',
  },
  {
    id: 'dev-json-ts', name: 'JSON 转类型定义', cat: 'dev', icon: '🧬',
    desc: '把 JSON 样本推断成 TypeScript / Go / Java / Python / Rust 的类型声明，数组元素结构不一致时自动合并。',
    module: './tools/dev-json-ts.js',
    keywords: 'json 转 typescript 类型 接口 interface 生成 go java python rust 代码生成',
  },
  {
    id: 'dev-data-convert', name: '数据格式转换', cat: 'dev', icon: '🔀',
    desc: 'JSON / YAML / TOML / XML / CSV / TSV 之间互转。CSV 与 JSON 互转时按首行做字段名。',
    module: './tools/dev-data-convert.js',
    keywords: 'json yaml toml xml csv tsv 转换 互转 配置 序列化',
  },
  {
    id: 'dev-radix', name: '进制转换', cat: 'dev', icon: '🔢',
    desc: '在 2–36 任意进制之间互转，用 BigInt 计算所以 64 位以上的大整数也不会丢精度。附带位视图。',
    module: './tools/dev-radix.js',
    keywords: '进制 转换 二进制 十六进制 十进制 八进制 位运算 radix hex bin',
  },
  {
    id: 'dev-case', name: '命名风格转换', cat: 'dev', icon: '🐫',
    desc: 'camelCase / snake_case / kebab-case 等 14 种命名风格互转，能正确处理缩写词与中文。',
    module: './tools/dev-case.js',
    keywords: '命名 大小写 转换 camel snake kebab pascal 驼峰 下划线 变量名',
  },
  {
    id: 'dev-crypto', name: '文本加解密', cat: 'dev', icon: '🔐',
    desc: '用 AES-256-GCM 加密文本，密钥由 PBKDF2 从密码派生，密文自带盐值与参数。也提供 MD5 摘要与 ROT13。',
    module: './tools/dev-crypto.js',
    keywords: '加密 解密 aes gcm 密码 对称 pbkdf2 混淆 rot13',
  },
  {
    id: 'dev-keypair', name: '密钥对生成', cat: 'dev', icon: '🔑',
    desc: '在浏览器里生成 RSA / ECDSA / Ed25519 / ECDH 密钥对，导出 PEM 与 JWK。私钥只在本机内存里。',
    module: './tools/dev-keypair.js',
    keywords: '密钥 公钥 私钥 rsa ecdsa ed25519 pem jwk 生成 openssl',
  },
  {
    id: 'dev-curl', name: 'cURL 转代码', cat: 'dev', icon: '🔄',
    desc: '把 cURL 命令解析成结构化请求，再生成 10 种语言与工具的调用代码。',
    module: './tools/dev-curl.js',
    keywords: 'curl 转换 代码 fetch axios python go php java csharp ruby rust httpie 请求',
  },
  {
    id: 'dev-sql', name: 'SQL 格式化', cat: 'dev', icon: '🗄️',
    desc: '把挤成一行的 SQL 排成可读的缩进结构，支持十多种数据库方言，可调关键字大小写与缩进。',
    module: './tools/dev-sql.js',
    keywords: 'sql 格式化 美化 mysql postgres oracle 方言 缩进 format',
  },
  {
    id: 'dev-html-md', name: 'HTML 转 Markdown', cat: 'dev', icon: '📝',
    desc: '把网页内容或富文本转成 Markdown，表格与代码块都能保留，适合粘进文档与 Issue。',
    module: './tools/dev-html-md.js',
    keywords: 'html markdown md 转换 富文本 turndown 文档',
  },
  {
    id: 'dev-svg', name: 'SVG 压缩优化', cat: 'dev', icon: '🪶',
    desc: '用 SVGO 压缩 SVG：去掉编辑器残留元数据、注释与无用小数值，画面完全一致。',
    module: './tools/dev-svg.js',
    keywords: 'svg 压缩 优化 精简 svgo 图标 体积',
  },
  {
    id: 'dev-cidr', name: 'CIDR / 子网计算', cat: 'dev', icon: '🌐',
    desc: '算出网络地址、广播地址、可用主机范围、掩码写法，并给出二进制视图。',
    module: './tools/dev-cidr.js',
    keywords: 'cidr 子网 掩码 网段 ip 计算 网络 subnet netmask',
  },
  {
    id: 'dev-time', name: '时间戳转换', cat: 'dev', icon: '🕐',
    desc: 'Unix 时间戳与日期字符串互转，支持秒/毫秒自动识别、时区切换、自定义格式与相对时间。',
    module: './tools/dev-time.js',
    keywords: '时间戳 unix timestamp 日期 转换 时区 iso8601 格式化',
  },
  {
    id: 'dev-url', name: 'URL 解析与编辑', cat: 'dev', icon: '🔗',
    desc: '拆解 URL 的协议、主机、端口、路径、查询参数与锚点，可视化增删改查询参数。',
    module: './tools/dev-url.js',
    keywords: 'url 解析 链接 查询参数 query 编码 拆解 编辑',
  },
  {
    id: 'dev-sample', name: '测试数据生成', cat: 'dev', icon: '🧪',
    desc: '批量生成姓名、邮箱、手机号、身份证号（校验位正确）、地址、公司等假数据，导出 JSON / CSV / SQL / TS。',
    module: './tools/dev-sample.js',
    keywords: '测试数据 mock 假数据 生成 姓名 邮箱 手机号 身份证 造数 faker',
  },

  /* ============================================================
     PDF 工具
     ============================================================ */
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

  /* ============================================================
     格式转换
     ============================================================ */
  {
    id: 'pdf-convert', name: 'PDF 转换', cat: 'convert', icon: '🔄', badge: 'hot',
    desc: '把 PDF 转成 Word / Excel / PPT / HTML 或图片。选好目标格式再导出，换个格式不用重新拖文件。',
    module: './tools/pdf-convert.js',
    keywords: 'pdf 转换 转word 转excel 转ppt 转html 转图片 docx xlsx pptx png jpg 导出',
  },
  {
    id: 'image-to-pdf', name: '图片转 PDF', cat: 'convert', icon: '🖼️',
    desc: '多张图片合成一份 PDF，可设置页边距、页面尺寸与图片自适应方式。',
    module: './tools/image-to-pdf.js',
    keywords: '图片 转pdf 合成 jpg png 合并',
  },

  /* ============================================================
     Office 工具
     ============================================================ */
  {
    id: 'office-convert', name: 'Office 转换', cat: 'office', icon: '📄', badge: 'hot',
    desc: 'Word / Excel / PowerPoint 转成 PDF 或图片，尽量保留原始排版。纯本地渲染，不用上传。',
    module: './tools/office-convert.js',
    keywords: 'word excel ppt 转pdf 转图片 docx xlsx pptx png jpg 转换',
  },
  {
    id: 'sheet-convert', name: '表格转换', cat: 'office', icon: '📊',
    desc: 'Excel / CSV / TSV 互转，也可导出 JSON / HTML / Markdown。可选工作表、自定义分隔符。',
    module: './tools/sheet-tools.js',
    keywords: 'excel csv tsv 互转 表格 xlsx json html markdown',
  },

  /* ============================================================
     图片工具
     ============================================================ */
  {
    id: 'image-compress', name: '图片压缩', cat: 'image', icon: '🗜️', badge: 'hot',
    desc: '用 MozJPEG / AVIF / OxiPNG 等真正的编解码器压缩图片，拖动分割线实时对比画质与体积。',
    module: './tools/image-compress.js',
    keywords: '图片压缩 压缩 体积 jpg png webp avif mozjpeg oxipng 画质 compress 瘦身',
  },
  {
    id: 'image-batch', name: '批量图片压缩', cat: 'image', icon: '📦',
    desc: '一次拖入多张图片用同一套参数压缩，逐张报告体积变化，完成后打包 zip。',
    module: './tools/image-batch.js',
    keywords: '批量 图片 压缩 打包 zip 多张 批量处理',
  },
  {
    id: 'image-resize', name: '图片缩放与裁剪', cat: 'image', icon: '✂️',
    desc: '按像素或百分比缩放（Lanczos3 重采样），或按比例从中心裁剪，裁剪框可直接拖动。',
    module: './tools/image-resize.js',
    keywords: '图片 缩放 裁剪 尺寸 放大 缩小 裁切 resize crop',
  },
  {
    id: 'image-watermark', name: '图片加水印', cat: 'image', icon: '💧',
    desc: '给图片加文字或图片水印，位置、大小、旋转、透明度、平铺都可调，实时预览。',
    module: './tools/image-watermark.js',
    keywords: '图片 水印 加logo 版权 平铺 watermark',
  },
  {
    id: 'image-convert', name: '图片格式转换', cat: 'image', icon: '🔄',
    desc: 'PNG / JPG / WebP 互转，可调质量与尺寸，支持批量打包下载。',
    module: './tools/image-convert.js',
    keywords: '图片 转换 png jpg webp 格式',
  },
  {
    id: 'image-base64', name: '图片转 Base64', cat: 'image', icon: '🧬',
    desc: '把图片转成 Base64 / Data URL / CSS 背景 / HTML img 标签，可直接内联进网页省一次请求。',
    module: './tools/image-base64.js',
    keywords: '图片 base64 dataurl 内联 css 背景 img 标签 转码',
  },
  {
    id: 'image-palette', name: '图片取色器', cat: 'image', icon: '🎨',
    desc: '在图片上点一下取精确颜色，或自动提取主色板（中位切分法）。给出 HEX / RGB / HSL。',
    module: './tools/image-palette.js',
    keywords: '取色 吸管 主色 配色 色板 palette 颜色 hex rgb hsl',
  },
  {
    id: 'image-qrcode', name: '二维码生成与识别', cat: 'image', icon: '🔳', badge: 'new',
    desc: '生成文本 / 网址 / WiFi / 名片 / 短信 / 电话 / 邮件二维码，导出 PNG 或矢量 SVG；也能识别图片里的二维码。',
    module: './tools/image-qrcode.js',
    keywords: '二维码 qrcode qr 扫码 生成 识别 解码 wifi 名片 vcard 条形码',
  },

  /* ============================================================
     文本工具
     ============================================================ */
  {
    id: 'text-dedupe', name: '文本去重', cat: 'text', icon: '🧹',
    desc: '去掉重复行，可选忽略大小写、忽略空白、保留首次或末次出现。',
    module: './tools/text-dedupe.js',
    keywords: '去重 重复 行 清理 unique',
  },
  {
    id: 'text-diff', name: '文本比较', cat: 'text', icon: '🔎',
    desc: '逐行对比两段文本的差异，高亮新增与删除。',
    module: './tools/text-diff.js',
    keywords: '比较 diff 对比 差异 不同',
  },
  {
    id: 'text-zh', name: '简繁转换', cat: 'text', icon: '🀄', badge: 'new',
    desc: '简体与繁体互转，支持台湾正体、香港繁体与通用繁体。用词组词典，能正确处理「头发 → 頭髮」这类要看词境的转换。',
    module: './tools/text-zh.js',
    keywords: '简繁 简体 繁体 转换 台湾 香港 正体 opencc 中文 繁简',
  },
  {
    id: 'text-wordcloud', name: '词云图生成', cat: 'text', icon: '☁️', badge: 'new',
    desc: '把一段文字做成词云图，可选配色、外形、旋转比例与字号范围，导出 PNG。中文用 2/3 字组合近似分词。',
    module: './tools/text-wordcloud.js',
    keywords: '词云 词频 云图 wordcloud 关键词 可视化 文本分析',
  },

  /* ============================================================
     其他工具
     ============================================================ */
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
