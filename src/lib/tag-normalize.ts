/**
 * 标签规范化（v0.0.14）
 *
 * ## 为什么需要这一层
 *
 * `tags` / `topic_tags` 表自 v0.0.1 就存在，主题页也会渲染标签块，
 * `/tag/[name]` 页面同样是可访问的路由 —— **但全仓没有任何生产代码写入标签**
 * （只有 `scripts/loadtest/seed-large.ts` 这个压测脚本会写）。
 * 结果是：标签页在真实使用中永远不可能有内容，属于「页面存在但不可达」。
 *
 * 补写入链路时，规范化规则必须**独立可测**（纯函数、无 server-only、无 db），
 * 否则「大小写 / 空白 / 重复 / 上限」这些边界只能靠 E2E 间接覆盖，
 * 一期测不准就会变成长期脏数据（例如 `React` 与 `react` 变成两个标签）。
 *
 * ## 规则（**有意设定**，原站标签生成算法无法验证）
 *
 * 1. 去首尾空白与开头的 `#`（用户习惯写 `#react`）；
 * 2. 全小写 —— 避免 `React` / `react` 分裂成两个标签；
 * 3. 空白折叠为 `-`（`next.js app router` → `next.js-app-router`）；
 * 4. 只允许 字母 / 数字 / `-` / `_` / `.` / 中日韩文字；其余字符剔除后若为空则丢弃；
 * 5. 长度 1..24（数据库列是 64，这里更严是为了可读与可链接）；
 * 6. 单主题最多 **5** 个标签；
 * 7. 去重按规范化后的值。
 *
 * 原站标签由后台算法生成、前台不提供输入框 —— 本项目**不宣称与原站一致**，
 * 属「独立实现」，登记在 `docs/FEATURE_MATRIX.md` §3 与 `docs/API_SPEC.md`。
 */

/** 单个标签最大长度（规范化后） */
export const TAG_MAX_LENGTH = 24;
/** 单主题最多标签数 */
export const TAG_MAX_PER_TOPIC = 5;

/**
 * 规范化**单个**标签。无法构成合法标签时返回 `null`（调用方丢弃，不报错）。
 *
 * 之所以「丢弃而不是报错」：用户多打一个 emoji 不该让整篇帖子发布失败；
 * 但也不该把非法字符默默写进库 —— 丢弃是唯一不产生脏数据又不阻断主流程的选择。
 * 这条语义由单元测试与静态护栏同时钉住。
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  let tag = raw.trim().replace(/^#+/, '').trim().toLowerCase();
  if (tag === '') return null;

  // 空白折叠为连字符（在剔除非法字符之前做，避免 "a  b" → "a--b"）
  tag = tag.replace(/\s+/g, '-');

  // 保留字母 / 数字 / 连字符 / 下划线 / 点 / 中日韩文字
  // 说明：`\u4e00-\u9fff` 覆盖常用汉字；`\u3040-\u30ff` 覆盖日文假名；
  //      `\uac00-\ud7af` 覆盖韩文；其余（emoji、标点、全角符号）剔除。
  tag = tag.replace(/[^a-z0-9\-_.\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, '');

  // 剔除后可能只剩连字符/点号，这些也不是有效标签
  tag = tag.replace(/^[-_.]+|[-_.]+$/g, '');

  if (tag.length === 0 || tag.length > TAG_MAX_LENGTH) return null;

  return tag;
}

/**
 * 规范化一组标签：逐项规范化 → 丢弃非法 → 去重 → 截断到上限。
 *
 * 返回顺序保留用户输入顺序（前 5 个有效标签），因为这是用户可见的展示顺序。
 */
export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const tag = normalizeTag(item);
    if (!tag) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= TAG_MAX_PER_TOPIC) break;
  }

  return out;
}
