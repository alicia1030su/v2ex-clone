/**
 * 多视口视觉比对 + 结构/内容差异分离
 *
 * 纯像素 diff 无法区分「样式差异」与「内容差异」（原站实时数据 vs 本地 seed 数据）。
 * 本工具做两件事：
 *
 *  1. 像素差异：逐像素比较，输出差异率与热力图
 *  2. 结构差异：用「行级像素剖面」对比 —— 对每一行统计非背景像素的分布，
 *     得到页面的内容轮廓。比较两个页面的轮廓可以判断：
 *       - 轮廓一致 → 差异来自内容（文字/图片），不是布局
 *       - 轮廓错位 → 真实的布局差异（模块缺失、位置偏移、尺寸不同）
 *
 * 输出结构差异指标：
 *   - 行剖面差异率：内容轮廓的差异程度
 *   - 首屏内容起始行：验证顶部结构对齐
 *   - 主要内容块的数量与位置
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(process.cwd());
const SHOTS = path.join(ROOT, 'docs', 'evidence', 'screenshots');
const REPORT_DIR = path.join(ROOT, 'docs', 'evidence', 'visual');

const CHANNEL_THRESHOLD = 16;

/** 计算行剖面：每一行有多少"非背景"像素 */
function rowProfile(png) {
  const profile = new Array(png.height).fill(0);
  // 以左上角像素作为背景色参考（页面背景）
  const bg = [png.data[0], png.data[1], png.data[2]];

  for (let y = 0; y < png.height; y++) {
    let count = 0;
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      const dr = Math.abs(png.data[i] - bg[0]);
      const dg = Math.abs(png.data[i + 1] - bg[1]);
      const db = Math.abs(png.data[i + 2] - bg[2]);
      if (Math.max(dr, dg, db) > 24) count++;
    }
    profile[y] = count;
  }
  return profile;
}

/** 计算列剖面：每一列有多少"非背景"像素 */
function colProfile(png) {
  const profile = new Array(png.width).fill(0);
  const bg = [png.data[0], png.data[1], png.data[2]];
  for (let x = 0; x < png.width; x++) {
    let count = 0;
    for (let y = 0; y < png.height; y++) {
      const i = (png.width * y + x) << 2;
      const dr = Math.abs(png.data[i] - bg[0]);
      const dg = Math.abs(png.data[i + 1] - bg[1]);
      const db = Math.abs(png.data[i + 2] - bg[2]);
      if (Math.max(dr, dg, db) > 24) count++;
    }
    profile[x] = count;
  }
  return profile;
}

/** 两个剖面的差异（归一化到 0-1） */
function profileDelta(a, b) {
  const n = Math.min(a.length, b.length);
  let diff = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    diff += Math.abs(a[i] - b[i]);
    total += Math.max(a[i], b[i]);
  }
  return total > 0 ? diff / total : 0;
}

/** 找出剖面中"内容块"的起止行（连续非零段） */
function contentBlocks(profile, threshold = 2) {
  const blocks = [];
  let start = -1;
  for (let y = 0; y < profile.length; y++) {
    if (profile[y] > threshold) {
      if (start === -1) start = y;
    } else {
      if (start !== -1) {
        blocks.push({ start, end: y - 1, height: y - start });
        start = -1;
      }
    }
  }
  if (start !== -1) blocks.push({ start, end: profile.length - 1, height: profile.length - start });
  return blocks;
}

/** 比较两个 PNG 的像素与结构 */
function compare(refBuf, locBuf) {
  const a = PNG.sync.read(refBuf);
  const b = PNG.sync.read(locBuf);

  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);

  const diff = new PNG({ width, height });
  let diffPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ai = (a.width * y + x) << 2;
      const bi = (b.width * y + x) << 2;
      const di = (width * y + x) << 2;
      const delta = Math.max(
        Math.abs(a.data[ai] - b.data[bi]),
        Math.abs(a.data[ai + 1] - b.data[bi + 1]),
        Math.abs(a.data[ai + 2] - b.data[bi + 2]),
      );
      if (delta > CHANNEL_THRESHOLD) {
        diffPixels++;
        diff.data[di] = 255;
        diff.data[di + 1] = 0;
        diff.data[di + 2] = 0;
        diff.data[di + 3] = 255;
      } else {
        const gray = Math.round(
          (a.data[ai] * 0.299 + a.data[ai + 1] * 0.587 + a.data[ai + 2] * 0.114) * 0.25,
        );
        diff.data[di] = gray;
        diff.data[di + 1] = gray;
        diff.data[di + 2] = gray;
        diff.data[di + 3] = 255;
      }
    }
  }

  const refRow = rowProfile(a);
  const locRow = rowProfile(b);
  const refCol = colProfile(a);
  const locCol = colProfile(b);
  const refBlocks = contentBlocks(refRow);
  const locBlocks = contentBlocks(locRow);

  const totalPixels = width * height;
  return {
    size: { reference: `${a.width}x${a.height}`, local: `${b.width}x${b.height}` },
    sizeMismatch: a.width !== b.width || a.height !== b.height,
    diffPixels,
    totalPixels,
    diffRatioPercent: Number(((diffPixels / totalPixels) * 100).toFixed(3)),
    // 结构指标
    rowProfileDeltaPercent: Number((profileDelta(refRow, locRow) * 100).toFixed(2)),
    colProfileDeltaPercent: Number((profileDelta(refCol, locCol) * 100).toFixed(2)),
    refContentBlocks: refBlocks.length,
    localContentBlocks: locBlocks.length,
    refFirstContentRow: refBlocks[0]?.start ?? null,
    localFirstContentRow: locBlocks[0]?.start ?? null,
    diffPng: diff,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const indexFile = path.join(SHOTS, 'capture-multi-index.json');
  if (!existsSync(indexFile)) {
    console.error('✗ 未找到 capture-multi-index.json，请先运行 capture-multi.mjs');
    process.exit(1);
  }
  const index = JSON.parse(await readFile(indexFile, 'utf8'));

  const report = [];
  for (const p of index.pages) {
    if (!p.reference || !p.local) {
      report.push({
        viewport: p.viewport,
        name: p.name,
        status: 'incomplete',
        referenceStatus: p.referenceStatus,
        localStatus: p.localStatus,
      });
      console.log(`[${p.viewport}] ${p.name.padEnd(14)} 跳过（缺少截图）`);
      continue;
    }

    const refBuf = await readFile(path.join(ROOT, p.reference));
    const locBuf = await readFile(path.join(ROOT, p.local));
    const r = compare(refBuf, locBuf);

    const diffFile = path.join(
      REPORT_DIR,
      `diff-${p.viewport}-${p.name}.png`,
    );
    await writeFile(diffFile, PNG.sync.write(r.diffPng));

    const entry = {
      viewport: p.viewport,
      name: p.name,
      status: 'compared',
      referenceSize: r.size.reference,
      localSize: r.size.local,
      sizeMismatch: r.sizeMismatch,
      diffPixels: r.diffPixels,
      diffRatioPercent: r.diffRatioPercent,
      rowProfileDeltaPercent: r.rowProfileDeltaPercent,
      colProfileDeltaPercent: r.colProfileDeltaPercent,
      refContentBlocks: r.refContentBlocks,
      localContentBlocks: r.localContentBlocks,
      refFirstContentRow: r.refFirstContentRow,
      localFirstContentRow: r.localFirstContentRow,
      diffImage: path.relative(ROOT, diffFile),
    };
    report.push(entry);

    // 结构对齐的判定：
    //  1. 首屏内容起始行一致（顶部结构对齐）
    //  2. 列剖面差异较小（横向布局对齐）
    // 内容块数量差异主要来自两侧内容条目数不同（内容差异），不作为结构错位依据。
    const structureAligned =
      entry.refFirstContentRow === entry.localFirstContentRow &&
      entry.colProfileDeltaPercent < 35;
    console.log(
      `[${p.viewport}] ${p.name.padEnd(14)} 像素差 ${String(entry.diffRatioPercent).padStart(6)}%  ` +
        `行剖面差 ${String(entry.rowProfileDeltaPercent).padStart(6)}%  ` +
        `内容块 ${entry.refContentBlocks} vs ${entry.localContentBlocks}  ` +
        `首行 ${entry.refFirstContentRow}/${entry.localFirstContentRow}  ` +
        `${structureAligned ? '结构对齐' : '结构有差异'}`,
    );
  }

  const outFile = path.join(REPORT_DIR, 'visual-diff-multi.json');
  await writeFile(
    outFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2),
  );
  console.log(`\n✓ 多视口差异报告: ${path.relative(ROOT, outFile)}`);
}

main().catch((e) => {
  console.error('✗ 比对失败:', e);
  process.exit(1);
});
