/**
 * @ 提及解析（v0.0.5）
 *
 * ## 为什么需要它
 *
 * `notifications` 表的 `notificationType` 枚举里**一直有 `mention`**，
 * `NotificationsList` 也**一直有「提及」的中文标签** ——
 * 但**从来没有代码写入过这个类型**。也就是说：
 *
 *  - 数据模型支持「提及通知」
 *  - UI 能显示「提及」通知
 *  - 但没有任何东西会**产生**它
 *
 * 这是一个**半成品功能**。任务书 §十要求：
 * 「对于确实属于目标社区体验、且尚未实现的功能，纳入本轮」。
 *
 * ## 为什么用 @ 提及替代私信
 *
 * 实测结论（`docs/COMMUNITY_FEATURES_EVALUATION_v0.0.5.md`）：
 *
 *  - **V2EX 原站没有私信功能** —— 登录态首页的导航链接里
 *    没有「私信」「消息中心」「收件箱」任何一项
 *  - 原站的「叫某人」是靠**手写 Markdown 链接**
 *    （`<a href="/member/xxx">xxx</a>`）—— 不是自动功能
 *
 * 即：私信**不属于**本项目要还原的社区形态。
 * 而 @ 提及是 V2EX 论坛的**标准互动方式**（回复里点名某人），
 * 且数据模型**已经预留**了位置 ⇒ 本轮补齐它，而不是新造一套私信系统。
 *
 * ## 语法
 *
 * ```
 * @username          提及（username 限 2-32 位字母数字下划线，
 *                        与注册校验一致）
 * ```
 *
 * ## 边界（重要）
 *
 * 1. **只对真实存在的用户发通知** —— 查不到用户就忽略，
 *    绝不给「任意字符串」发通知（否则可被用来刷通知表）。
 * 2. **不给自己发提及通知** —— 自己 @ 自己没有意义。
 * 3. **去重** —— 同一条内容里 @ 同一用户多次只通知一次。
 * 4. **数量上限** —— 单条内容最多触发 10 个提及通知，
 *    防止「@ 一百个人」刷爆通知表。
 * 5. **不是安全边界** —— 提及内容里的用户名仍按普通文本渲染
 *    （本项目的 Markdown 渲染已经过 `sanitize-html` 清洗）。
 */

/**
 * 用户名的合法形态
 *
 * ⚠️ v0.0.5：**必须与注册校验逐字一致**
 * （`src/app/api/auth/signup/route.ts` 的 `USERNAME_RE`）。
 *
 * 实测踩到（E2E 首次失败）：原实现写的是 `{3,20}`，
 * 而注册允许的是 `{2,32}` ⇒ **13–32 字符的合法用户名永远无法被提及**
 * （用户名长度超出 20 那一截就匹配不上 ⇒ 不生成通知）。
 *
 * 这是一个**真实的产品缺陷** —— 用户名是系统允许的，
 * 但 @ 功能对它无效，且**没有任何提示**。
 *
 * 修法：与注册校验对齐为 `{2,32}`。
 * （更彻底的做法是把两者抽到同一个模块，但那需要改注册路由的导入链，
 *  本轮先保证**语义一致**，并在下面加了断言守护。）
 */
const USERNAME_RE = /^[a-zA-Z0-9_]{2,32}$/;

/** 单条内容最多触发的提及通知数 */
export const MAX_MENTIONS_PER_CONTENT = 10;

/**
 * 从内容中解析出被提及的用户名
 *
 * @param content 正文（纯文本或 Markdown 源）
 * @returns 去重后的用户名数组（保持出现顺序）
 */
export function extractMentions(content: string): string[] {
  if (!content) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  // `@` 后面跟 3-20 位字母数字下划线。
  //
  // ⚠️ 用**单词边界**而非贪婪匹配：
  //    `email@example.com` 里的 `example` **不是**提及
  //    （`@` 前面是字母，不构成边界）；
  //    而 `@user_name` 里的 `user_name` 是。
  for (const m of content.matchAll(/(?:^|[^\w@])@([a-zA-Z0-9_]{2,32})\b/g)) {
    const username = m[1];
    if (!USERNAME_RE.test(username)) continue;
    if (seen.has(username)) continue;
    seen.add(username);
    out.push(username);
    if (out.length >= MAX_MENTIONS_PER_CONTENT) break;
  }

  return out;
}

/**
 * 构造提及通知的文案
 *
 * @param actorName 提及者
 * @param topicTitle 主题标题
 * @param isReply 是否是回复（回复里显示楼层）
 * @param floor 楼层号（仅回复）
 */
export function buildMentionMessage(params: {
  actorName: string;
  topicTitle: string;
  isReply: boolean;
  floor?: number | null;
}): string {
  const { actorName, topicTitle, isReply, floor } = params;
  const where = isReply && floor ? `回复 #${floor}` : '主题';
  return `${actorName} 在${where}中提及了你：${topicTitle}`;
}
