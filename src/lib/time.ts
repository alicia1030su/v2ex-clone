/**
 * 相对时间格式化 —— 对齐原站行为
 * 原站观察到：首页 topic_info 用「5 分钟前」「10 分钟前」「12 小时 42 分钟前」
 * 主题详情页用「12 小时 42 分钟前」，回复区用「12 小时 29 分钟前」
 * 超过 1 天则显示日期（如「3 天前」），超过 30 天显示具体日期。
 */

import { nowMs } from './app-now.js';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * v0.0.8：默认「现在」走**确定性时钟**（src/lib/app-now.ts）。
 *
 * 视觉回归需要同一份数据在不同时刻渲染出**同一长度**的文本，
 * 否则窄视口下换行 ⇒ 容器高度变化 ⇒ 基线随时间漂移
 * （实测 320x568 视口差 120px，master 与特性分支同样失败）。
 *
 * `APP_NOW` 未设置时 = 真实时钟 ⇒ 生产行为**完全不变**。
 * 注意：这只影响相对时间**文案**，不影响令牌有效期/限流/数据库时间戳。
 */
export function relativeTime(
  input: Date | string | number,
  now: Date | string | number = nowMs(),
): string {
  const date = input instanceof Date ? input : new Date(input);
  const ts = date.getTime();
  if (Number.isNaN(ts)) return '';

  const nowTs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const diff = Math.floor((nowTs - ts) / 1000);
  if (diff < 0) return '刚刚';
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    const m = Math.floor((diff % HOUR) / MINUTE);
    return m > 0 ? `${h} 小时 ${m} 分钟前` : `${h} 小时前`;
  }
  if (diff < 30 * DAY) {
    const d = Math.floor(diff / DAY);
    const h = Math.floor((diff % DAY) / HOUR);
    return h > 0 ? `${d} 天 ${h} 小时前` : `${d} 天前`;
  }
  return formatDate(date);
}

/** ISO8601 风格时间戳 —— 原站 title 属性使用「2026-11-02 21:22:40 +08:00」 */
export function fullTimestamp(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  const p = (n: number) => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const off = `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())} ${off}`
  );
}

export function formatDate(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 分隔符：原站 topic_info 使用 ` &nbsp;•&nbsp; ` */
export const DOT = ' • ';
