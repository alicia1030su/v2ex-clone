#!/usr/bin/env node
/**
 * v0.0.13（QA P1-3）：**测试套件用例数硬门禁**
 *
 * ## 为什么需要它
 *
 * 实测（2026-11-09，本机）：
 *
 *   npx vitest run --config vitest.static.config.ts -t "不存在的用例名XYZ"
 *   → Test Files 15 skipped / Tests 166 skipped / **退出码 0**
 *
 * Vitest 在「全部 skipped」与「0 个用例被收集」两种情况下都返回 0。
 * 也就是说 CI 里一个 `-t` 写错、include 配错、或测试文件被误删，
 * 流水线会**全绿**，而实际上一条测试都没执行。这正是任务书
 * 阶段八明令禁止的「0 条用例收集必须判失败」。
 *
 * `passWithNoTests: false` 只能挡住「0 个测试文件」，挡不住
 * 「文件在但用例全 skip」——所以必须读 reporter 的真实计数。
 *
 * ## 用法
 *
 *   npx vitest run --config vitest.static.config.ts \
 *     --reporter=json --outputFile=.vitest-static.json
 *   node scripts/ci/assert-test-counts.mjs .vitest-static.json static
 *
 *   npx vitest run --reporter=json --outputFile=.vitest-unit.json
 *   node scripts/ci/assert-test-counts.mjs .vitest-unit.json unit
 *
 * 退出码：0 = 真实执行了用例且全部通过 / 1 = 零用例、有跳过、有失败或报告缺失
 */
import { readFileSync, existsSync } from 'node:fs';

const [reportPath, label = 'suite', minRaw] = process.argv.slice(2);
const MIN_TESTS = Number(minRaw ?? 1);

function fail(msg) {
  console.error(`::error::[${label}] ${msg}`);
  process.exit(1);
}

if (!reportPath) fail('缺少 JSON 报告路径参数');
if (!existsSync(reportPath)) fail(`测试报告不存在：${reportPath}（reporter 没跑起来不能算通过）`);

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (e) {
  fail(`测试报告不是合法 JSON：${e.message}`);
}

const num = (key) => {
  const v = report[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const total = num('numTotalTests');
const passed = num('numPassedTests');
const failed = num('numFailedTests');
const pending = num('numPendingTests');
const todo = num('numTodoTests');

for (const [key, value] of Object.entries({ numTotalTests: total, numPassedTests: passed, numFailedTests: failed, numPendingTests: pending })) {
  if (value === null) fail(`报告缺少数值字段 ${key}（可能是 vitest 版本升级换了 reporter 格式）`);
}

if (total === 0) fail('收集到 0 条用例 —— 按门禁纪律判失败，不允许把「没测」写成「通过」');
if (passed < MIN_TESTS) fail(`真实通过的用例数 ${passed} < 下限 ${MIN_TESTS}`);
if (failed > 0) fail(`有 ${failed} 条失败用例`);
if (pending > 0) fail(`有 ${pending} 条 skipped 用例 —— 跳过必须披露，不得静默算通过`);
if (todo !== null && todo > 0) fail(`有 ${todo} 条 todo 用例`);
if (report.success !== true) fail('reporter 的 success 不是 true');
if (passed + failed + pending + (todo ?? 0) !== total) {
  fail(`计数不自洽：passed(${passed}) + failed(${failed}) + pending(${pending}) + todo(${todo ?? 0}) !== total(${total})`);
}

console.log(`[${label}] 用例计数门禁通过：total=${total} passed=${passed} failed=${failed} pending=${pending} todo=${todo ?? 0}`);
