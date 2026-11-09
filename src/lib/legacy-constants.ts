/**
 * 旧版 V2EX API / Feed 的**纯常量**（无 server-only，可被静态护栏直接 import）
 *
 * 所有数字来自 2026-11-08 / 11-09 对原站的低频只读实测，
 * 逐项记录见 `docs/LEGACY_API_MATRIX_v0.0.13.md`。
 * 集中一处是为了让「契约护栏」和「路由实现」读同一份数字，
 * 而不是各写一份 120 / 60 / 3600 然后慢慢漂移。
 */

/** 与原站同口径的配额（实测响应头 `x-rate-limit-limit: 600`） */
export const LEGACY_RATE_LIMIT = 600;
export const LEGACY_RATE_WINDOW_SECONDS = 3600;

/** 原站列表模式固定 10 条；Feed 固定 50 条（均为实测） */
export const LEGACY_LIST_LIMIT = 10;
export const LEGACY_FEED_LIMIT = 50;
/** `/api/topics/latest.json` 原站固定返回 35 条（三次探测一致） */
export const LEGACY_LATEST_LIMIT = 35;
/** `/api/topics/hot.json` 原站固定 10 条，按 `replies` 降序（实测） */
export const LEGACY_HOT_LIMIT = 10;

/** 各端点实测 `Cache-Control: public, max-age=…` 秒数 */
export const LEGACY_CACHE_SECONDS = {
  topicsShow: 120,
  topicsLatest: 120,
  topicsHot: 120,
  repliesShow: 60,
  membersShow: 600,
  nodesShow: 3600,
  nodesAll: 7200,
  nodesList: 30,
  feedAtom: 600,
  feedJson: 1800,
} as const;
