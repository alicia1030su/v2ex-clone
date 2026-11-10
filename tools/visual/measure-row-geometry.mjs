/**
 * v0.0.16 视觉差异测量（像素级，真实截图）
 *
 * ## 为什么不用「人工看图」
 *
 * 「看起来差不多」不是判据。任务书要求把差异分成 A~E 五类，
 * 而分类的前提是**可复现的数值**：行高、头像边长、标题字高、文字起点 x、
 * 分隔线位置。这些都能量。
 *
 * ## 测量口径
 *
 * - 输入：同一视口（1280×900）、同一浏览器通道截出的 PNG
 * - 坐标一律相对**内容盒左边界**（不是整张图左边），避免把「两侧留白」
 *   混进组件几何
 * - 只读像素，不读 DOM —— 这样参考图（只有像素）与本机（有 DOM）可以用
 *   **同一套代码**量，结论可比
 *
 * 用法：
 *   node tools/visual/measure-row-geometry.mjs --ref a.png --local b.png [--json out.json]
 */
import sharp from 'sharp';

const argv = process.argv.slice(2);
const get = (n, d) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const refPath = get('ref', null);
const localPath = get('local', null);
const jsonOut = get('json', null);
if (!refPath || !localPath) {
  console.error('用法：--ref <png> --local <png> [--json out.json]');
  process.exit(2);
}

const WHITE = 246; // 白判定阈值（略低于 255，容忍 JPEG/抗锯齿噪点）

async function load(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, C: info.channels };
}

function make(img) {
  const { data, W, C } = img;
  const px = (x, y) => {
    const i = (y * W + x) * C;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const lum = (x, y) => {
    const p = px(x, y);
    return (p[0] + p[1] + p[2]) / 3;
  };
  const isWhite = (x, y) => {
    const p = px(x, y);
    return p[0] > WHITE && p[1] > WHITE && p[2] > WHITE;
  };
  // ⚠️ 必须把 W/H/C 一并返回：第一版漏了 W，`x < t.W` 变成 `x < undefined`
  //   ⇒ 所有按宽度枚举的循环（左边界、文字带）**一次都不执行**，
  //   于是 left 恒为 0、titleBand 恒为 null。这类「函数返回形状不全」
  //   造成的静默空测，正是本仓反复强调要看输出而不是看退出码的原因。
  return { px, lum, isWhite, W, H: img.H, C };
}

/** 内容盒左边界：在给定扫描行上，从左侧找第一个白像素 */
function contentLeft(t, y) {
  for (let x = 0; x < t.W; x += 1) if (t.isWhite(x, y)) return x;
  return 0;
}

/** 横向分隔线（浅灰行）：返回值是「连续灰行段」的起始 y */
function separators(t, xProbe, yFrom, yTo) {
  const ys = [];
  for (let y = yFrom; y < yTo; y += 1) {
    const p = t.px(xProbe, y);
    if (
      Math.abs(p[0] - p[1]) < 4 &&
      Math.abs(p[1] - p[2]) < 4 &&
      p[0] >= 222 &&
      p[0] <= 240
    ) {
      ys.push(y);
    }
  }
  const segs = [];
  let s = null;
  let prev = null;
  for (const y of ys) {
    if (s === null) {
      s = y;
      prev = y;
    } else if (y - prev <= 2) {
      prev = y;
    } else {
      segs.push(s);
      s = y;
      prev = y;
    }
  }
  if (s !== null) segs.push(s);
  return segs;
}

/**
 * 头像盒：在 [yTop,yBot] 区间内，找左边界右侧第一个「非白竖直块」，
 * 再在该块的 x 范围内求纵向范围。
 *
 * ⚠️ 只适用于**有真实图像/文字**的头像。若站点用纯色字母头像，
 * 仍然是非白块，可测；但「参考站点用照片、本站用字母」属内容差异（C 类）。
 */
function avatarBox(t, left, yTop, yBot, searchWidth = 120) {
  let x0 = null;
  let x1 = null;
  for (let x = left + 1; x < left + searchWidth; x += 1) {
    let nonWhite = 0;
    for (let y = yTop; y <= yBot; y += 1) if (!t.isWhite(x, y)) nonWhite += 1;
    if (nonWhite > 6) {
      if (x0 === null) x0 = x;
      x1 = x;
    } else if (x0 !== null) {
      break; // 块结束
    }
  }
  if (x0 === null) return null;
  let y0 = null;
  let y1 = null;
  for (let y = yTop - 40; y <= yBot + 40; y += 1) {
    let hit = 0;
    for (let x = x0; x <= x1; x += 1) if (!t.isWhite(x, y)) hit += 1;
    if (hit > 6) {
      if (y0 === null) y0 = y;
      y1 = y;
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 === null ? null : y1 - y0 + 1, inset: x0 - left };
}

/** 文字带：给定 x 起的窗口内，暗像素（lum<120）的纵向范围 */
function textBand(t, xFrom, yTop, yBot, width = 520) {
  let y0 = null;
  let y1 = null;
  let darkest = 255;
  for (let y = yTop; y <= yBot; y += 1) {
    let cnt = 0;
    for (let x = xFrom; x < Math.min(xFrom + width, t.W); x += 1) {
      const l = t.lum(x, y);
      if (l < 120) cnt += 1;
      if (l < darkest) darkest = l;
    }
    if (cnt > 3) {
      if (y0 === null) y0 = y;
      y1 = y;
    }
  }
  return { y0, y1, h: y1 === null ? null : y1 - y0 + 1, darkest: Math.round(darkest) };
}

/** 文字起点 x：在文字带内，从 xFrom 起找第一个暗像素 */
function textStartX(t, y0, y1, xFrom, width = 400) {
  for (let x = xFrom; x < Math.min(xFrom + width, t.W); x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      if (t.lum(x, y) < 120) return x;
    }
  }
  return null;
}

function analyze(t, label) {
  const left = contentLeft(t, 300);
  const seps = separators(t, left + 420, 60, t.H - 1);
  const rowHeights = [];
  for (let i = 1; i < seps.length; i += 1) rowHeights.push(seps[i] - seps[i - 1]);

  // 取第二条分隔线之后的一行做「主题行」样本（避开首个 tab 行）
  const rowTop = seps.length >= 2 ? seps[1] : 160;
  const rowBot = seps.length >= 3 ? seps[2] - 1 : rowTop + 70;

  const av = avatarBox(t, left, rowTop + 4, rowTop + 46);
  const titleX = av ? av.x + av.w + 4 : left + 40;
  const title = textBand(t, titleX, rowTop, rowTop + 34);
  const meta = av
    ? textBand(t, titleX, (title.y1 ?? rowTop) + 2, rowBot)
    : null;
  const titleStart = title.y0 !== null ? textStartX(t, title.y0, title.y1, titleX) : null;

  return {
    label,
    contentLeft: left,
    separators: seps.slice(0, 10),
    rowHeights: rowHeights.slice(0, 8),
    avatar: av,
    titleBand: title,
    titleStartX: titleStart,
    titleInsetFromAvatar: titleStart !== null && av ? titleStart - (av.x + av.w) : null,
    metaBand: meta,
  };
}

const a = make(await load(refPath));
const b = make(await load(localPath));
const R = analyze(a, 'ref');
const L = analyze(b, 'local');

const cmp = (k, unit = 'px') => ({
  ref: R[k] ?? null,
  local: L[k] ?? null,
  delta: typeof R[k] === 'number' && typeof L[k] === 'number' ? L[k] - R[k] : null,
  unit,
});

const report = {
  measuredAt: new Date().toISOString(),
  files: { ref: refPath, local: localPath },
  geometry: {
    contentLeft: cmp('contentLeft'),
    titleStartX: cmp('titleStartX'),
    titleHeight: cmp('titleHeight'),
  },
  avatar: {
    w: { ref: R.avatar?.w ?? null, local: L.avatar?.w ?? null },
    h: { ref: R.avatar?.h ?? null, local: L.avatar?.h ?? null },
    inset: { ref: R.avatar?.inset ?? null, local: L.avatar?.inset ?? null },
  },
  titleBand: { ref: R.titleBand, local: L.titleBand },
  metaBand: { ref: R.metaBand, local: L.metaBand },
  separators: { ref: R.separators, local: L.separators },
  rowHeights: { ref: R.rowHeights, local: L.rowHeights },
  rowHeightDelta: R.rowHeights[0] !== undefined && L.rowHeights[0] !== undefined
    ? L.rowHeights[0] - R.rowHeights[0]
    : null,
};

console.log(JSON.stringify(report, null, 1));
if (jsonOut) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
  console.error(`\n已写入 ${jsonOut}`);
}
