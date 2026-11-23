import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_MATRIX = path.join(ROOT, 'docs', 'evidence', 'visual', 'v0.0.21', 'fidelity-matrix.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'docs', 'VISUAL_FIDELITY_MATRIX_v0.0.21.md');

function isMain() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}

/**
 * Render the human-readable matrix exclusively from machine-readable JSON.
 *
 * @param {string} matrixPath
 * @param {string} outputPath
 * @returns {{output:string, count:number}}
 */
export function renderMatrix(matrixPath = DEFAULT_MATRIX, outputPath = DEFAULT_OUTPUT) {
  const records = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const counts = records.reduce((summary, record) => {
    summary[record.status] = (summary[record.status] ?? 0) + 1;
    return summary;
  }, {});
  const p0 = records.filter((record) => record.severity === 'P0' && record.status === 'UNVERIFIED').length;
  const classifications = records.reduce((summary, record) => {
    summary[record.classification] = (summary[record.classification] ?? 0) + 1;
    return summary;
  }, {});
  const findings = records.reduce((summary, record) => {
    const source = record.before_findings ?? record.delta?.findings ?? [];
    for (const finding of source) {
      summary[finding] = (summary[finding] ?? 0) + 1;
    }
    return summary;
  }, {});
  const manifestPath = path.join(path.dirname(matrixPath), 'reference-manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { references: [] };
  const official = manifest.references.find((entry) => entry.reference_id === 'OFFICIAL-LIVE-OBSERVATIONS');
  let officialLines = ['- 官方实时观察：未采集'];
  if (official?.url_or_path) {
    const officialPath = path.resolve(ROOT, official.url_or_path);
    if (fs.existsSync(officialPath)) {
      const observations = JSON.parse(fs.readFileSync(officialPath, 'utf8'));
      officialLines = observations.map((entry) => `- 官方实时观察：${entry.url} → ${entry.status}`);
    }
  }
  const lines = [
    '# V2EX Visual Fidelity Matrix v0.0.21',
    '',
    '> 状态：before/after 证据已采集；正式视觉改造候选仍为 No-Go，直到 P0 阻断项关闭。',
    '> 本文件只报告记录与证据，不输出视觉相似度或还原百分比。',
    '',
    '## 汇总',
    '',
    `- 总记录：${records.length}`,
    `- VERIFIED：${counts.VERIFIED ?? 0}`,
    `- INTENTIONAL_DIFFERENCE：${counts.INTENTIONAL_DIFFERENCE ?? 0}`,
    `- UNVERIFIED：${counts.UNVERIFIED ?? 0}`,
    `- P0 UNVERIFIED 阻断：${p0}`,
    `- after 证据：${records.filter((record) => record.evidence_after).length}`,
    `- before 分类 A：${records.filter((record) => record.before_classification === 'A').length}`,
    `- after 分类 A：${classifications.A ?? 0}`,
    `- after 分类 E：${classifications.E ?? 0}`,
    '',
    '## 官方参考可达性',
    '',
    ...officialLines,
    '',
    '## before 内部差距',
    '',
    ...Object.entries(findings).map(([finding, count]) => `- ${finding}：${count} 条`),
    '',
    '## UNVERIFIED 原因',
    '',
    '当前没有可合法引用的官方像素规格。项目自有 before 证据只能证明自身回归、可访问性与响应式契约，不能证明与官方一致。因此相关记录保持 UNVERIFIED、p0_blocking=true、closure_allowed=false。',
    '',
    '## 540 条索引',
    '',
    '| gap_id | 页面类 | 路由 | 角色 | 视口 | 层 | 严重度 | 终态 | closure_allowed | before 证据 | after 证据 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const record of records) {
    lines.push(`| ${record.gap_id} | ${record.page_class} | ${record.route} | ${record.auth_role} | ${record.viewport} | ${record.layer} | ${record.severity} | ${record.status} | ${record.closure_allowed} | ${record.evidence_before} | ${record.evidence_after ?? '—'} |`);
  }
  lines.push('', '## 复测规则', '', '只有同时具备合法 before/after 参考、证据哈希和复测结果的记录才能转为 VERIFIED 或 INTENTIONAL_DIFFERENCE。', '');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  return { output: outputPath, count: records.length };
}

if (isMain()) {
  try {
    const result = renderMatrix(process.argv[2] ?? DEFAULT_MATRIX, process.argv[3] ?? DEFAULT_OUTPUT);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
