/**
 * 举报原因（v0.0.5）
 *
 * **固定列表**，不用自由文本 —— 后台要能统计，`deletedReason` 文案也要可读。
 * `其他` 配 `detail` 补充说明。
 *
 * 为什么单独放一个模块而不是放 `src/db/schema.ts`：
 *   schema.ts 依赖 drizzle 的 `pgTable` / `pgEnum`，把它 import 进客户端组件
 *   会让整套 ORM 运行时进入浏览器 bundle。这里只放**纯数据**，
 *   服务端（API）与客户端（举报表单）都能安全引用，天然保持两边一致。
 */

export const REPORT_REASONS = [
  '垃圾广告',
  '人身攻击',
  '违法违规',
  '剧透/无关内容',
  '重复发布',
  '其他',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** 举报原因校验（同时用于 API 与测试） */
export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);
}
