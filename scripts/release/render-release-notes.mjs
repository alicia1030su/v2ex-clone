#!/usr/bin/env node
/**
 * 生成公开 Release Notes。
 *
 * 历史事故：内联在 release.yml 的单个 `run: |` 块同时包含长模板、
 * CHANGELOG 抽取 Node 脚本与多道 shell 闸门，超过 GitHub workflow
 * 21,000 字符上限后整份文件解析失败（0 Job）。本脚本把渲染与真实性
 * 闸门移出工作流，既缩短表达式，也让这些判据可以在本地直接执行。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const abs = (file) => path.resolve(ROOT, file);
const VERSION = process.env.VERSION ?? '';
const PRERELEASE = process.env.PRERELEASE ?? '';
const IMAGE_DIGEST_TEXT = process.env.IMAGE_DIGEST_TEXT ?? '';
const TEMPLATE = '.github/release-notes-template.md';
const CHANGELOG = 'CHANGELOG.md';
const OUTPUT = process.env.OUTPUT ?? 'release-notes.md';

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!/^v?\d+\.\d+\.\d+$/.test(VERSION)) {
  fail(`VERSION 不是合法语义版本：${VERSION}`);
}
if (PRERELEASE !== 'true' && PRERELEASE !== 'false') {
  fail(`PRERELEASE 必须是 true/false，实际：${PRERELEASE}`);
}
if (!IMAGE_DIGEST_TEXT) {
  fail('IMAGE_DIGEST_TEXT 为空');
}

for (const file of [TEMPLATE, CHANGELOG]) {
  if (!fs.existsSync(abs(file))) fail(`缺少文件：${file}`);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const versionToken = new RegExp(`(?:^|[^0-9])${escapeRegExp(VERSION)}(?![0-9.])`);
const headingVersion = (line) => {
  const matches = line.match(/\bv?\d+\.\d+\.\d+\b/g);
  return matches ? matches[matches.length - 1].replace(/^v/, '') : null;
};
const want = VERSION.replace(/^v/, '');
const lines = fs.readFileSync(abs(CHANGELOG), 'utf8').split(/\r?\n/);
const start = lines.findIndex(
  (line) => /^##\s/.test(line) && versionToken.test(line) && headingVersion(line) === want,
);
if (start < 0) {
  fail(`CHANGELOG.md 缺少 ${VERSION} 段落（精确 token 匹配），拒绝用旧模板生成 Release Notes`);
}
let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
if (end < 0) end = lines.length;
const raw = lines.slice(start + 1, end);
// CHANGELOG 的版本段落开头是仓库内部状态说明，不能原样搬进公开 Notes。
const firstSub = raw.findIndex((line) => /^###\s/.test(line));
const section = (firstSub >= 0 ? raw.slice(firstSub) : raw).join('\n').trim();
if (section.length < 100) {
  fail(`CHANGELOG 的 ${VERSION} 段落过短，疑似未更新的占位模板`);
}

const otherVersionHeadings = section.match(/^#{2,4}\s+v?\d+\.\d+\.\d+[^\n]*$/gm) || [];
const foreign = otherVersionHeadings.filter((heading) => headingVersion(heading) !== want);
if (foreign.length > 0) {
  fail(`Release Notes 注入内容含其它版本标题：${foreign.join(' | ')}`);
}
const devOnly = ['当前开发版本', '当前实际公开版本', '发行候选', '待授权', '尚无 Tag', '未发布'];
const leaked = devOnly.filter((word) => section.includes(word));
if (leaked.length > 0) {
  fail(`Release Notes 注入内容含仓库内部状态措辞：${leaked.join(' / ')}`);
}

const isPrerelease = PRERELEASE === 'true';
const formSuffix = isPrerelease ? ' — 开发预览版（Pre-release）' : ' — 稳定版';
const formNotice = isPrerelease
  ? [
      '> ⚠️ **这是早期开发预览版（Pre-release），不是稳定版。**',
      '> 功能尚未完备，**不保证与 V2EX 完全一致**，**不建议直接用于生产环境**。',
      '> 本项目 `0.0.x` 全部为早期开发预览版，不承诺 API 稳定性。',
    ].join('\n')
  : [
      '> ✅ **这是正式稳定版（Stable Release）。**',
      '> 本版本 CI 已验证数据库迁移幂等、升级路径与备份恢复；安装与升级步骤见下方。',
      '> ⚠️ 稳定版表示发行工程经过稳定版验收，不等于已完成全部生产规模与 24 小时运行验证。',
    ].join('\n');

let notes = fs.readFileSync(abs(TEMPLATE), 'utf8');
for (const placeholder of ['__CHANGELOG_SECTION__', '__FORM_SUFFIX__', '__FORM_NOTICE__', '__VERSION__', '__DIGEST__']) {
  if (!notes.includes(placeholder)) fail(`Release Notes 模板缺少占位符 ${placeholder}`);
}
const indented = section.replace(/^(#{2,4})\s/gm, '#$1 ');
notes = notes.replace('__CHANGELOG_SECTION__', () => indented);
notes = notes.split('__FORM_SUFFIX__').join(formSuffix);
notes = notes.split('__FORM_NOTICE__').join(formNotice);
notes = notes.split('__VERSION__').join(VERSION);
notes = notes.split('__DIGEST__').join(IMAGE_DIGEST_TEXT);

const expectedTitle = isPrerelease
  ? `## ${VERSION} — 开发预览版（Pre-release）`
  : `## ${VERSION} — 稳定版`;
if (!notes.includes(expectedTitle)) fail(`Release Notes 主标题不符（期望：${expectedTitle}）`);
if (!isPrerelease && notes.includes('不是稳定版')) {
  fail('稳定版 Notes 里出现「不是稳定版」—— 形态自相矛盾');
}
if (!notes.includes(`### ${VERSION} 更新内容`)) {
  fail(`Release Notes 缺少本版本更新内容标题：### ${VERSION} 更新内容`);
}
const versionSectionHeadings = notes.match(/^### v\d+\.\d+\.\d+ 更新内容$/gm) || [];
if (versionSectionHeadings.length !== 1) {
  fail(`Release Notes 出现多个版本更新内容标题：${versionSectionHeadings.join(' | ')}`);
}
if (/__CHANGELOG_SECTION__|__FORM_SUFFIX__|__FORM_NOTICE__|__VERSION__|__DIGEST__/.test(notes)) {
  fail('Release Notes 仍有未替换的占位符');
}

const expectedDir = `v2ex-clone-${VERSION}-deploy`;
const requiredInstallLines = [
  `unzip v2ex-clone-${VERSION}-deploy.zip -d ${expectedDir}`,
  `cd ${expectedDir}/deploy`,
  `Expand-Archive -Path v2ex-clone-${VERSION}-deploy.zip -DestinationPath ${expectedDir}`,
  `cd ${expectedDir}\\deploy`,
];
for (const line of requiredInstallLines) {
  if (!notes.includes(line)) fail(`Release Notes 安装路径不符：缺少 ${line}`);
}
if (/^unzip v2ex-clone-[^ ]+-deploy\.zip$/m.test(notes)) {
  fail('Release Notes 仍有「unzip 无 -d」与「cd 到版本目录」混用的错误写法');
}

// 升级命令必须在“现有安装目录”执行：新解压的发行包没有 .env，
// 在那里运行 update.sh 会被脚本正确拒绝。这里把真实踩坑写进渲染闸门，
// 防止未来模板演化时又把用户引到缺 .env 的新目录。
const requiredUpgradeLines = [
  'cd <你现有的 V2EX Clone 部署目录>',
  './backup.sh',
  `./update.sh --version ${VERSION}`,
];
for (const line of requiredUpgradeLines) {
  if (!notes.includes(line)) fail(`Release Notes 升级路径不符：缺少 ${line}`);
}
if (notes.includes(`cd v2ex-clone-${VERSION}-deploy/deploy\n./update.sh`)) {
  fail('Release Notes 让用户在新解压目录执行 update.sh；该目录没有现有 .env');
}

fs.writeFileSync(abs(OUTPUT), notes);
console.log(`已从 CHANGELOG.md 注入 ${VERSION} 段落（${indented.length} 字符，归属校验通过）`);
console.log(`发布形态：${isPrerelease ? 'Pre-release' : '稳定版'}（后缀：${JSON.stringify(formSuffix)}）`);
console.log(`Release Notes 镜像 digest：${IMAGE_DIGEST_TEXT}`);
