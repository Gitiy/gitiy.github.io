/**
 * 手写最小 OOXML 写出器：生成可被 Word / PowerPoint 正常打开的 .docx 与 .pptx。
 *
 * 之所以自己写而不是找库：
 *   - SheetJS 能写 xlsx，但写不了 docx/pptx
 *   - docx 生态的写库都比较大，而这里只需要"文字段落"和"整页图片"两种最简结构
 * 生成的都是纯 ZIP + XML，用 JSZip 打包。
 */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // 去掉 XML 1.0 不允许的控制字符（PDF 提取的文字里偶有残留）
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

async function zipFiles(files) {
  const { loadJSZip } = await import('./scripts.js');
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream' });
}

/* ============================================================
   DOCX
   ============================================================ */

const EMU_PER_INCH = 914400;
const TWIP_PER_INCH = 1440;

/**
 * @param {object} opts
 *   paragraphs: [{ text, level }]  level: 0 正文 / 1-3 标题 / 'title'
 *   pageSizePt: { widthPt, heightPt }
 *   title: 文档标题（写入 core 属性，可选）
 */
export async function buildDocx({ paragraphs = [], pageSizePt, title }) {
  const pw = Math.round((pageSizePt?.widthPt || 595.28) / 72 * TWIP_PER_INCH);
  const ph = Math.round((pageSizePt?.heightPt || 841.89) / 72 * TWIP_PER_INCH);

  const body = paragraphs.map((p) => paragraphXml(p)).join('');

  const documentXml = `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const coreXml = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title || '')}</dc:title>
<cp:lastModifiedBy>Tools</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  return zipFiles({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'docProps/core.xml': coreXml,
    'word/document.xml': documentXml,
  });
}

function paragraphXml({ text, level = 0, bold, sizeHalfPt }) {
  const isTitle = level === 'title';
  const heading = typeof level === 'number' && level > 0;
  const sz = sizeHalfPt ?? (isTitle ? 44 : heading ? [32, 28, 26][level - 1] : 22);
  const props = [
    bold || isTitle || heading ? '<w:b/>' : '',
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`,
  ].join('');
  const spacing = heading || isTitle ? '<w:spacing w:before="240" w:after="120"/>' : '<w:spacing w:after="120"/>';

  // 空段落也要保留，否则原文的段落间距会丢失
  const runs = String(text ?? '')
    .split('\n')
    .map((line, i) =>
      `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`
    )
    .join('');

  return `<w:p><w:pPr>${spacing}</w:pPr>${runs}</w:p>`;
}

/* ============================================================
   PPTX
   ============================================================ */

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
};

const SLIDE_W = 12192000;   // 16:9，13.333in
const SLIDE_H = 6858000;    // 7.5in

const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;

const THEME_XML = `${XML_HEAD}<a:theme xmlns:a="${NS.a}" name="Tools">
<a:themeElements>
<a:clrScheme name="Tools"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Tools"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Tools">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
<a:objectDefaults/><a:extraClrSchemeLst/>
</a:theme>`;

/**
 * 生成 PPTX：每张幻灯片放一张整页图片。
 * @param {object} opts
 *   slides: [{ bytes: Uint8Array, ext: 'png'|'jpeg', widthPt, heightPt }]
 *   title: 文档标题（可选）
 */
export async function buildPptx({ slides = [], title }) {
  const files = {};
  const n = slides.length;

  const overrides = slides
    .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join('');

  files['[Content_Types].xml'] = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${overrides}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  files['_rels/.rels'] = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title || '')}</dc:title>
<cp:lastModifiedBy>Tools</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  // presentation.xml + rels
  const presRels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
    ...slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`),
    `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`,
  ].join('');
  files['ppt/_rels/presentation.xml.rels'] = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels}</Relationships>`;

  files['ppt/presentation.xml'] = `${XML_HEAD}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  // slideMaster + rels
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

  files['ppt/slideMasters/slideMaster1.xml'] = `${XML_HEAD}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

  // slideLayout + rels
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

  files['ppt/slideLayouts/slideLayout1.xml'] = `${XML_HEAD}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1">
<p:cSld name="Blank">${EMPTY_TREE}</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

  files['ppt/theme/theme1.xml'] = THEME_XML;

  // 每张幻灯片：一张铺满的图片
  slides.forEach((s, i) => {
    const idx = i + 1;
    const ext = s.ext === 'jpeg' || s.ext === 'jpg' ? 'jpeg' : 'png';
    const mediaName = `image${idx}.${ext}`;
    files[`ppt/media/${mediaName}`] = s.bytes;

    // 按页面比例在幻灯片内等比缩放并居中
    const ar = (s.widthPt || 4) / (s.heightPt || 3);
    const slideAr = SLIDE_W / SLIDE_H;
    let w = SLIDE_W, h = SLIDE_H, x = 0, y = 0;
    if (ar > slideAr) { h = Math.round(SLIDE_W / ar); y = Math.round((SLIDE_H - h) / 2); }
    else { w = Math.round(SLIDE_H * ar); x = Math.round((SLIDE_W - w) / 2); }

    files[`ppt/slides/_rels/slide${idx}.xml.rels`] = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>
</Relationships>`;

    files[`ppt/slides/slide${idx}.xml`] = `${XML_HEAD}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture ${idx}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
  });

  return zipFiles(files);
}
