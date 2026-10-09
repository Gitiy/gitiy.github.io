/**
 * 把 pdf.js 的文字项按坐标还原成"行 / 列"结构。
 *
 * 思路：
 *   1. 按 y 坐标聚成行（同一行的文字 y 很接近）
 *   2. 行内按 x 排序，遇到明显空隙就切分成单元格
 *   3. 把所有单元格的起始 x 聚类成列，再按列把内容摆回表格
 *
 * 对"有边框/对齐规则的表格型 PDF"效果好；纯段落文本会退化成单列。
 */

const DEFAULTS = {
  lineTolerance: 2.5,   // pt，同一行允许的 y 偏差
  gapRatio: 1.5,        // 空隙超过「平均字符宽 × 该倍数」就断成新单元格
  minGap: 6,            // pt，空隙下限，避免把字距当成栏距
  columnTolerance: 14,  // pt，列聚类容差
};

function avgCharWidth(item) {
  const n = Math.max(1, item.str.trim().length);
  return item.width > 0 ? item.width / n : item.height * 0.5;
}

/** 把一页的文字项切成行（每行是若干个单元格） */
export function itemsToLines(items, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!items.length) return [];

  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  let cur = null;

  for (const it of sorted) {
    if (!cur || Math.abs(it.y - cur.y) > o.lineTolerance) {
      cur = { y: it.y, items: [it] };
      lines.push(cur);
    } else {
      cur.items.push(it);
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    const cells = [];
    let buf = null;
    for (const it of line.items) {
      if (!buf) {
        buf = { x: it.x, x2: it.x + it.width, text: it.str };
        continue;
      }
      const gap = it.x - buf.x2;
      const need = Math.max(o.minGap, avgCharWidth(it) * o.gapRatio);
      if (gap > need) {
        cells.push({ ...buf, text: buf.text.trim() });
        buf = { x: it.x, x2: it.x + it.width, text: it.str };
      } else {
        // 中文之间不需要空格，西文之间补一个空格避免粘连
        const sep = /[\u4e00-\u9fff]$/.test(buf.text) || /^[\u4e00-\u9fff]/.test(it.str) ? '' : ' ';
        buf.text += (gap > 0.5 ? sep : '') + it.str;
        buf.x2 = it.x + it.width;
      }
    }
    if (buf) cells.push({ ...buf, text: buf.text.trim() });
    line.cells = cells.filter((c) => c.text !== '');
  }

  return lines.filter((l) => l.cells.length);
}

/** 把所有单元格的起始 x 聚类成列边界 */
function clusterColumns(lines, tolerance) {
  const xs = [];
  for (const l of lines) for (const c of l.cells) xs.push(c.x);
  xs.sort((a, b) => a - b);

  const centers = [];
  for (const x of xs) {
    const last = centers[centers.length - 1];
    if (last && x - last.sum / last.n <= tolerance) {
      last.sum += x;
      last.n++;
    } else {
      centers.push({ sum: x, n: 1 });
    }
  }
  return centers.map((c) => c.sum / c.n);
}

/** items -> { rows: string[][], columns: number[] } */
export function itemsToGrid(items, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const lines = itemsToLines(items, o);
  if (!lines.length) return { rows: [], columns: [] };

  const centers = clusterColumns(lines, o.columnTolerance);
  const colIndex = (x) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.abs(centers[i] - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const rows = lines.map((l) => {
    const row = new Array(centers.length).fill('');
    for (const c of l.cells) {
      const i = colIndex(c.x);
      row[i] = row[i] ? row[i] + ' ' + c.text : c.text;
    }
    return row;
  });

  // 去掉全空列
  const keep = [];
  for (let i = 0; i < centers.length; i++) {
    if (rows.some((r) => r[i] !== '')) keep.push(i);
  }
  const trimmed = rows.map((r) => keep.map((i) => r[i]));

  return { rows: trimmed, columns: keep.map((i) => centers[i]) };
}

/** 判断是否像表格：多列的行占比够高 */
export function looksTabular(rows) {
  if (!rows.length) return false;
  const multi = rows.filter((r) => r.filter((c) => c !== '').length >= 2).length;
  return multi / rows.length >= 0.3;
}

/** 多页合并成一个二维数组（用于写 Excel 的一个工作表） */
export function pagesToSheet(pages, options = {}) {
  const out = [];
  pages.forEach((p, idx) => {
    const { rows } = itemsToGrid(p.items, options);
    if (idx > 0) out.push([]);                       // 页与页之间空一行
    out.push(...rows);
  });
  return out;
}
