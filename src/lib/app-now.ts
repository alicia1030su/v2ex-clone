/**
 * v0.0.8：确定性「当前时刻」注入（视觉回归专用）
 *
 * ## 为什么需要
 *
 * 页面的相对时间文案（`src/lib/time.ts` 的 `relativeTime`）在 **Server
 * Component** 里渲染（`src/app/page.tsx` 与 `src/app/t/[id]/page.tsx` 都
 * 没有 `'use client'`）⇒ 用的是 **Node 服务端时钟**。
 *
 * 后果：同一份种子数据在不同时刻渲染出**不同长度**的文本
 * （「8 小时前」→「1 天前」）⇒ 窄视口（320px）下换行 ⇒ 容器高度变化
 * ⇒ 视觉基线随时间「漂移」。
 *
 * 实测（v0.0.8）：基线保存于 11-06 12:30，同一份代码在 11-07 跑时
 * 320x568 视口的内容容器高度差 **120px**，master 与特性分支**同样失败**
 * ⇒ 与代码改动无关，是基线里的时间炸弹。
 *
 * ## 修法
 *
 * 应用侧读 `APP_NOW`（ISO8601）作为「现在」；未设置时用真实时钟
 * （生产行为完全不变）。
 *
 * ⚠️ **安全边界**：这个开关只影响**相对时间文案**的渲染，
 * 不影响任何鉴权、令牌有效期、限流窗口、数据库时间戳 ——
 * 那些都直接用数据库/系统时间。见 `nowMs()` 的调用点审计。
 *
 * 只应在**视觉回归工作流**里设置（那里需要确定性测量）；
 * 生产环境**不得**设置。
 */

const ANCHOR_ISO = process.env.APP_NOW?.trim();

let anchorMs: number | null = null;
if (ANCHOR_ISO) {
  const parsed = Date.parse(ANCHOR_ISO);
  if (Number.isNaN(parsed)) {
    // 配错了必须响 —— 静默忽略会让人以为时钟冻结了
    console.error(
      `[app-now] APP_NOW="${ANCHOR_ISO}" 不是合法的 ISO8601 时间 —— 已忽略（将用真实时钟）`,
    );
  } else {
    anchorMs = parsed;
  }
}

/** 是否处于「确定性时钟」模式 */
export const isFixedClock = anchorMs !== null;

/**
 * 当前时刻（毫秒）。
 *
 * - `APP_NOW` 已设置且合法 ⇒ 固定返回该时刻
 * - 否则 ⇒ 真实 `Date.now()`
 */
export function nowMs(): number {
  return anchorMs ?? Date.now();
}

/** 当前时刻（Date 对象） */
export function nowDate(): Date {
  return new Date(nowMs());
}
