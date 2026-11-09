import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.13（V10-22）：**文档与实现一致性**护栏
 *
 * ## 事故
 *
 * `docs/FEATURE_MATRIX.md` 是「功能是否实现」的对外声明。它自 v0.0.3 写就后
 * **长期没有同步**，到 v0.0.12 时累计 **12 处**已实现的功能仍标着
 * `❌ 未实现` / `⚠️ 仅数据模型`（逐条取证见 `BUG_REGISTER.md` V10-22）：
 *
 *   · CSRF「未实现显式 token 校验」 —— 实际早已是双提交 Cookie + `guardCsrf`
 *   · 「主题编辑/删除 未实现」 —— 实际 `TopicActions` 编辑表单 + `PUT/DELETE` 齐全
 *   · 「每日登录加分 未实现」 —— 实际 `POST /api/checkin` 在跑
 *   · 「积分排行榜 未实现」 —— 实际 `/leaderboard` 页 + `/api/leaderboard` 都在
 *   · 「通知已读 未接 UI」 —— 实际 `NotificationsList` 早就接了
 *   · 「引用回复 未接 UI」 —— 实际 `ReplyItem` 显示引用预览并跳锚点
 *   · 「关注用户 仅数据模型」/「关注流 未实现 UI」 —— 实际 `FollowButton` + `/following`
 *   · 「节点 Feed 未实现生成器」 —— 实际 `buildRss` / `buildJsonFeed` 全在
 *   · 「主题投票 JS 未接」/「主题置顶 表已建」 —— 实际两个按钮都在 `TopicActions`
 *
 *   这些都是**对外文档撒谎**，而且方向一致地「低估自己」——比高估更容易
 *   长期不被发现：没有测试会因为文档写错而变红。
 *
 * ## 本护栏守什么
 *
 * ① FEATURE_MATRIX 里**每一条 `❌` / `⚠️`** 都必须带**可核查的实现理由**：
 *    行内要有反引号括起来的路径（文件/端点/表名）或明确的「原因」措辞。
 *    禁止只写一行光秃秃的 `❌`。
 * ② FEATURE_MATRIX 里引用的每个 `e2e/*.spec.ts`、`src/...` 路径**必须真实存在**。
 *    引用不存在的文件 = 用「看起来有证据」的路径掩盖没有证据。
 * ③ FEATURE_MATRIX 不得再出现**已被全仓否证的断言**（下面这份黑名单，
 *    每一条都附了「为什么它已经是错的」）。有人重新写回去就会立刻判红。
 * ④ API_SPEC 里声明「已实现」的端点路径，必须在 `src/app/api` 下真实存在一个
 *    `route.ts`（本项目文档曾把 `/api/topics/show.json` 写成 404 不存在）。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const MATRIX = path.join(ROOT, 'docs', 'FEATURE_MATRIX.md');
const API_SPEC = path.join(ROOT, 'docs', 'API_SPEC.md');

const matrix = readFileSync(MATRIX, 'utf8');
const apiSpec = readFileSync(API_SPEC, 'utf8');

/**
 * 已被实现否证的断言（写回文档即判红）。
 *
 * 每条的 `evidence` 是该断言的**反证**——直接可在仓库里 grep 到。
 */
const REFUTED_CLAIMS: Array<{ text: string; evidence: string }> = [
  {
    text: '未实现显式 token 校验',
    evidence: 'src/lib/csrf.ts 的 verifyCsrf + src/lib/csrf-guard.ts（双提交 Cookie）',
  },
  {
    text: '无显式 token',
    evidence: '同上 —— 所有写路由都调 guardCsrf',
  },
  {
    text: '主题编辑/删除（作者） | — | 未实现',
    evidence: 'src/components/TopicActions.tsx 有编辑表单；PUT/DELETE /api/topics/[id]',
  },
  {
    text: '编辑和管理主题 | 0 |',
    evidence: 'e2e/v004-content-interaction.spec.ts 有「编辑主题」用例',
  },
  {
    text: '每日登录加分 | 原站经典行为 | 未实现',
    evidence: 'POST /api/checkin + src/lib/credit-service.ts 的 daily_checkin',
  },
  {
    text: '积分排行榜 | 原站 `/values` | 未实现',
    evidence: '/leaderboard 页面 + GET /api/leaderboard',
  },
  {
    text: '通知已读标记 | — | `notifications.read` | 模型',
    evidence: 'src/components/NotificationsList.tsx 的标记已读',
  },
  {
    text: '引用回复 | — | `replies.quoteId` | 模型',
    evidence: 'src/components/ReplyItem.tsx 的「↪ 引用 N 楼」',
  },
  {
    text: '仅数据模型',
    evidence: 'src/components/FollowButton.tsx + /following 页（关注与关注流都已接 UI）',
  },
  {
    text: '未实现 Feed 生成器',
    evidence: 'src/lib/feed-builder.ts 的 buildRss/buildJsonFeed + /api/nodes/[name]/feed',
  },
  {
    text: '表已建，UI 为原站同款箭头（JS 未接）',
    evidence: 'src/components/TopicActions.tsx 的投票箭头已接 /api/votes',
  },
  {
    text: '主题置顶 | — | `topics.pinned` | 表已建',
    evidence: 'POST /api/topics/[id]/pin + TopicActions 置顶按钮',
  },
  {
    text: '自研 HTML 白名单清洗器',
    evidence: 'src/lib/markdown.ts 早已改用 sanitize-html（注释里写明了自研版的缺陷）',
  },
];

/**
 * 负面标记（`❌` / `⚠️`）出现在**功能声明**表格行里。
 *
 * ⚠️ v0.0.13（V13-07）：矩阵新增了「图例」小节，其中
 * `| ⚠️ 部分实现 | … |`、`| ❌ 确认缺失 | … |` 是**状态定义**，
 * 不是「某项功能被标为负面」的声明。若不排除，护栏会把定义本身
 * 当成「没有给理由的负面断言」而误红（这正是 2026-11-09 静态套件
 * 2 failed 中第一条的来源）。
 *
 * 排除范围**只**是 `## 图例` 到下一个 `## ` 之间；其余所有表格行
 * 仍按原判据严格检查。底部另有负向对照测试证明该判据没有被放宽。
 */
function negativeRows(content: string = matrix): Array<{ line: number; text: string }> {
  const rows: Array<{ line: number; text: string }> = [];
  let inLegend = false;
  content.split(/\r?\n/).forEach((text, i) => {
    if (/^##\s/.test(text)) {
      inLegend = /^##\s+图例/.test(text);
      return;
    }
    if (inLegend) return;
    if (!text.startsWith('|')) return;
    if (text.includes('❌') || text.includes('⚠️')) {
      rows.push({ line: i + 1, text });
    }
  });
  return rows;
}

describe('文档与实现一致性（V10-22）', () => {
  it('每条 ❌ / ⚠️ 都必须给出可核查的实现理由（路径或原因）', () => {
    const offenders: string[] = [];
    for (const row of negativeRows()) {
      // 允许的「理由」形态：
      //   · 反引号路径（`src/...`、`/api/...`、`e2e/...`、表名）
      //   · 明确的原因措辞（本项目不复制 / 未采集 / 未建模 / 独立替代实现 …）
      const hasPath = /`[^`]+`/.test(row.text);
      const hasReason =
        /(不复制|未采集|未建模|未单独建模|独立替代实现|原站行为未实测|不适用|有意为之)/.test(
          row.text,
        );
      if (!hasPath && !hasReason) offenders.push(`L${row.line}: ${row.text.slice(0, 120)}`);
    }
    expect(
      offenders,
      `以下负面状态既没给路径也没给原因（等于「我说没实现」却没有可核查依据）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('负向对照：排除图例不等于放宽判据（图例外的裸负面行仍被抓到）', () => {
    const synthetic = [
      '## 图例',
      '',
      '| ⚠️ 部分实现 | 状态定义 | 状态定义 |',
      '| ❌ 确认缺失 | 状态定义 | 状态定义 |',
      '',
      '## 9. 假想功能',
      '',
      '| 功能 A | ⚠️ | 什么都没写 |',
      '| 功能 B | ✅ | `src/lib/example.ts` |',
    ].join('\n');
    const offenders = negativeRows(synthetic);
    expect(offenders.map((r) => r.text)).toEqual(['| 功能 A | ⚠️ | 什么都没写 |']);
  });

  it('矩阵里引用的每个 e2e / src 路径都真实存在', () => {
    const missing: string[] = [];
    const refs = [...matrix.matchAll(/`((?:e2e|src|tests|scripts)\/[^`\s]+?\.(?:ts|tsx|sh|mjs|cjs))`/g)];
    for (const m of refs) {
      const rel = m[1];
      if (!existsSync(path.join(ROOT, rel))) missing.push(rel);
    }
    expect(
      missing,
      `矩阵引用了不存在的文件（用「看起来有证据」的路径掩盖没有证据）：\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('矩阵引用的每个 e2e spec 都真实存在', () => {
    const missing: string[] = [];
    const refs = [...matrix.matchAll(/`(e2e\/[a-z0-9-]+\.spec\.ts)`/g)];
    for (const m of refs) {
      if (!existsSync(path.join(ROOT, m[1]))) missing.push(m[1]);
    }
    expect(
      missing,
      `矩阵引用了不存在的 e2e 文件：\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('不得再写回已被实现否证的断言（每条都是对外文档撒谎）', () => {
    // ⚠️ 只扫**表格行**（以 `|` 开头）—— 文件头部的说明文字里会**引用**
    //    这些错误断言（「曾把 X 标成 ⚠️ 仅数据模型」），那是历史记录，
    //    不是现行声明。第一版实现没做这个区分，把说明文字也当成断言扫了。
    const tableText = matrix
      .split(/\r?\n/)
      .filter((line) => line.startsWith('|'))
      .join('\n');

    const offenders: string[] = [];
    for (const claim of REFUTED_CLAIMS) {
      if (tableText.includes(claim.text)) {
        offenders.push(`「${claim.text}」  ← 反证：${claim.evidence}`);
      }
    }
    expect(
      offenders,
      `以下断言与代码实际状态矛盾，不得写回矩阵：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('API_SPEC 声明的旧版兼容端点必须真实存在 route.ts', () => {
    // 本项目曾在 PAGE_INVENTORY 里把 /api/topics/show.json 写成「原站有、我们没有」，
    // v0.0.13 补上了实现 ⇒ 文档与文件必须同时存在。
    expect(
      existsSync(path.join(ROOT, 'src', 'app', 'api', 'topics', 'show.json', 'route.ts')),
      '旧版兼容端点 /api/topics/show.json 的实现文件不存在',
    ).toBe(true);
    expect(apiSpec.includes('/api/topics/show.json'), 'API_SPEC 未登记旧版兼容端点').toBe(
      true,
    );
  });

  it('API_SPEC 里每个「实现为」/「见 src/...」的文件都真实存在', () => {
    const missing: string[] = [];
    const refs = [...API_SPEC.matchAll(/`(src\/[^`\s]+?\.(?:ts|tsx))`/g)];
    for (const m of refs) {
      if (!existsSync(path.join(ROOT, m[1]))) missing.push(m[1]);
    }
    expect(missing, `API_SPEC 引用了不存在的源文件：\n${missing.join('\n')}`).toEqual([]);
  });

  it('文档不得宣称「已抓取原站 HTML」之外的镜像素材（合规红线）', () => {
    // 本项目合规基线：只保存原站公开页面 HTML 与**数值测量**，
    // 不镜像 CSS/JS/图片。文档若写了「已复制 combo.css」即判红。
    for (const doc of [MATRIX, API_SPEC]) {
      expect(readFileSync(doc, 'utf8')).not.toMatch(/已复制\s*combo\.(css|js)/);
    }
  });
});
