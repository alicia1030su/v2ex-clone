/**
 * 像素差异比对
 *
 * 对 ref-*.png 与 local-*.png 逐像素比较，输出：
 *  - 差异像素总数与百分比
 *  - 差异热力图 PNG
 *  - 每个页面的结构化差异指标（用于 VISUAL_DIFF_REPORT.md）
 *
 * 使用纯 JS PNG 解码（pngjs），避免依赖原生 canvas。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(process.cwd());
const SHOTS = path.join(ROOT, 'docs', 'evidence', 'screenshots');
const REPORT_DIR = path.join(ROOT, 'docs', 'evidence', 'visual');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const only = arg('only');

/** 感知差异阈值：通道差 > 16 视为不同 */
const CHANNEL_THRESHOLD = 16;

function comparePNGs(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);

  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const sizeMismatch = a.width !== b.width || a.height !== b.height;

  const diff = new PNG({ width, height });
  let diffPixels = 0;
  let maxChannelDelta = 0;
  let sumChannelDelta = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ai = (a.width * y + x) << 2;
      const bi = (b.width * y + x) << 2;
      const di = (width * y + x) << 2;

      const dr = Math.abs(a.data[ai] - b.data[bi]);
      const dg = Math.abs(a.data[ai + 1] - b.data[bi + 1]);
      const db = Math.abs(a.data[ai + 2] - b.data[bi + 2]);
      const delta = Math.max(dr, dg, db);

      sumChannelDelta += (dr + dg + db) / 3;
      if (delta > maxChannelDelta) maxChannelDelta = delta;

      if (delta > CHANNEL_THRESHOLD) {
        diffPixels++;
        diff.data[di] = 255;
        diff.data[di + 1] = 0;
        diff.data[di + 2] = 0;
        diff.data[di + 3] = 255;
      } else {
        // 灰度显示原图作为底
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

  const totalPixels = width * height;
  return {
    width: a.width,
    height: a.height,
    localWidth: b.width,
    localHeight: b.height,
    sizeMismatch,
    comparedWidth: width,
    comparedHeight: height,
    diffPixels,
    totalPixels,
    diffRatio: totalPixels > 0 ? diffPixels / totalPixels : 0,
    maxChannelDelta,
    avgChannelDelta: totalPixels > 0 ? sumChannelDelta / totalPixels : 0,
    diffPng: diff,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const indexFile = path.join(REPORT_DIR, 'capture-index.json');
  if (!existsSync(indexFile)) {
    console.error('✗ 未找到 capture-index.json，请先运行 capture.mjs');
    process.exit(1);
  }
  const index = JSON.parse(await readFile(indexFile, 'utf8'));

  const report = [];

  for (const p of index.pages) {
    if (only && p.name !== only) continue;
    if (!p.reference || !p.local) {
      report.push({ name: p.name, status: 'incomplete', referenceStatus: p.referenceStatus, localStatus: p.localStatus });
      console.log(`[${p.name}] 跳过（缺少截图）`);
      continue;
    }

    const refBuf = await readFile(path.join(ROOT, p.reference));
    const locBuf = await readFile(path.join(ROOT, p.local));

    const r = comparePNGs(refBuf, locBuf);
    const diffFile = path.join(REPORT_DIR, `diff-${p.name}.png`);
    await writeFile(diffFile, PNG.sync.write(r.diffPng));

    const entry = {
      name: p.name,
      status: 'compared',
      referenceSize: `${r.width}x${r.height}`,
      localSize: `${r.localWidth}x${r.localHeight}`,
      sizeMismatch: r.sizeMismatch,
      comparedArea: `${r.comparedWidth}x${r.comparedHeight}`,
      diffPixels: r.diffPixels,
      totalPixels: r.totalPixels,
      diffRatioPercent: Number((r.diffRatio * 100).toFixed(3)),
      maxChannelDelta: r.maxChannelDelta,
      avgChannelDelta: Number(r.avgChannelDelta.toFixed(2)),
      diffImage: path.relative(ROOT, diffFile),
    };
    report.push(entry);
    console.log(
      `[${p.name}] 差异 ${entry.diffRatioPercent}% (${r.diffPixels}/${r.totalPixels} px) ` +
        `尺寸 ${entry.referenceSize} vs ${entry.localSize}`,
    );
  }

  const outFile = path.join(REPORT_DIR, 'visual-diff.json');
  await writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
  console.log(`\n✓ 差异报告: ${path.relative(ROOT, outFile)}`);
}

main().catch((e) => {
  console.error('✗ 比对失败:', e);
  process.exit(1);
});
