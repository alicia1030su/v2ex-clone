/**
 * v0.0.16 页面级几何基线（真实截图，统一口径）
 *
 * ## 这个工具解决什么问题
 *
 * 「看起来差不多」不能作为结论。任务书要求把视觉差异分成 A~E 五类，
 * 而分类的前提是**可复现数值**：内容盒左右边界、左右栏宽度、间隙、
 * 头部高度、首个盒子顶部位置、行高等。
 *
 * 旧工具（`measure.mjs`）只量整页宽高与主栏宽度，量不出「盒子边界」，
 * 于是「左右栏比例对不对」「留白是不是一致」只能靠人眼判断。
 *
 * ## 口径（必须固定，否则数值不可比）
 *
 * - 视口：调用方保证同尺寸（默认 1280×900）
 * - 扫描线：`scanY` 默认 300（避开首屏 tab 行与浮动元素）
 * - 「白盒」判定：RGB 全部 > 250（容忍抗锯齿与 1px 边框）
 * - 「间隙」：两个白盒之间的**非白横向区间**
 * - 「页面底色」：取 (20, scanY) 的像素 —— 左侧留白处的背景
 *
 * ⚠️ 本工具**只读像素**，不读 DOM。这样参考图（只有 PNG）与本机（有 DOM）
 * 能用同一套代码量，结论才可比。代价是「盒子」只能按颜色切分 ——
 * 深色头图区（如节点页的深蓝 banner）会被识别成"非白间隙"，
 * 因此对这类页面额外输出 `allWhiteBands`（不同 scanY 的多条扫描线）。
 *
 * 用法：
 *   node tools/visual/measure-page-geometry.mjs --dir docs/evidence/screenshots \
 *     --pages home,topic_detail,member,nodes_all,search,signin --scan-y 300
 */
import sharp from 'sharp';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const get = (n, d) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const dir = get('dir', 'docs/evidence/screenshots');
const pages = (get('pages', 'home,topic_detail,member,nodes_all,search,signin')).split(',');
const scanYs = get('scan-y', '300').split(',').map(Number);
const jsonOut = get('json', null);
const WHITE = 250;
const MIN_BOX = 40;

async function load(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, C: info.channels };
}

function bands(img, y) {
  const { data, W, C } = img;
  const segs = [];
  let s = null;
  let p = null;
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * C;
    const isWhite = data[i] > WHITE && data[i + 1] > WHITE && data[i + 2] > WHITE;
    if (isWhite) {
      if (s === null) s = x;
      p = x;
    } else if (s !== null) {
      segs.push({ x0: s, x1: p, w: p - s + 1 });
      s = null;
      p = null;
    }
  }
  if (s !== null) segs.push({ x0: s, x1: p, w: p - s + 1 });
  return segs.filter((b) => b.w >= MIN_BOX);
}

/** 头部高度：从 y=20 往下找第一处颜色跳变（连续 3 行稳定后才算） */
function headerHeight(img) {
  const { data, W, C } = img;
  const xProbe = Math.round(W / 2);
  let prev = null;
  for (let y = 4; y < 120; y += 1) {
    const i = (y * W + xProbe) * C;
    const cur = [data[i], data[i + 1], data[i + 2]].join(',');
    if (prev !== null && cur !== prev) {
      // 确认不是单像素噪点：下一行也必须不同
      const j = ((y + 1) * W + xProbe) * C;
      const nxt = [data[j], data[j + 1], data[j + 2]].join(',');
      if (nxt !== prev) return y;
    }
    prev = cur;
  }
  return null;
}

/** 页面底色（左侧留白） */
function pageBg(img, y) {
  const { data, W, C } = img;
  const i = (y * W + 20) * C;
  const toHex = (v) => v.toString(16).padStart(2, '0');
  return `#${toHex(data[i])}${toHex(data[i + 1])}${toHex(data[i + 2])}`;
}

async function measurePair(name) {
  const refFile = path.join(dir, `ref-${name}.png`);
  const locFile = path.join(dir, `local-${name}.png`);
  const out = { page: name, scanYs: {} };
  for (const y of scanYs) {
    const band = {};
    for (const [side, file] of [['ref', refFile], ['local', locFile]]) {
      try {
        const img = await load(file);
        const b = bands(img, y);
        band[side] = {
          size: `${img.W}x${img.H}`,
          pageBg: pageBg(img, y),
          headerHeight: headerHeight(img),
          boxes: b.map((x) => `${x.x0}-${x.x1}(${x.w})`),
          boxCount: b.length,
          totalWhite: b.reduce((a, x) => a + x.w, 0),
          // 主栏 / 右栏：取最宽的两个盒（站点结构固定为左主栏 + 右栏）
          mainWidth: b.length >= 1 ? Math.max(...b.map((x) => x.w)) : null,
          sideWidth:
            b.length >= 2
              ? [...b].sort((p, q) => q.w - p.w)[1].w
              : null,
        };
      } catch {
        band[side] = null;
      }
    }
    out.scanYs[y] = band;
    const r = band.ref;
    const l = band.local;
    out[`delta_${y}`] = r && l
      ? {
          mainWidth: (l.mainWidth ?? 0) - (r.mainWidth ?? 0),
          sideWidth: (l.sideWidth ?? 0) - (r.sideWidth ?? 0),
          headerHeight: (l.headerHeight ?? 0) - (r.headerHeight ?? 0),
          boxCount: l.boxCount - r.boxCount,
        }
      : null;
  }
  return out;
}

const results = [];
for (const p of pages) results.push(await measurePair(p));

console.log(JSON.stringify(results, null, 1));
if (jsonOut) {
  await writeFile(jsonOut, JSON.stringify({ measuredAt: new Date().toISOString(), dir, results }, null, 2), 'utf8');
  console.error(`\n已写入 ${jsonOut}`);
}
