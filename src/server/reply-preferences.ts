import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export const REPLY_DISPLAY_MODES = [
  'classic',
  'quote',
  'badge',
  'nested',
  'tree',
  'lines',
  'excerpt',
] as const;

export type ReplyDisplayMode = (typeof REPLY_DISPLAY_MODES)[number];
export type ThemePreference = 'light' | 'dark' | 'system';

export const DEFAULT_REPLY_DISPLAY_MODE: ReplyDisplayMode = 'classic';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export function parseReplyDisplayMode(value: unknown): ReplyDisplayMode | null {
  return typeof value === 'string' && (REPLY_DISPLAY_MODES as readonly string[]).includes(value)
    ? (value as ReplyDisplayMode)
    : null;
}

export function parseThemePreference(value: unknown): ThemePreference | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null;
}

export async function getUserPreferences(userId: number): Promise<{
  replyDisplayMode: ReplyDisplayMode;
  themePreference: ThemePreference;
}> {
  const rows = await db
    .select({
      replyDisplayMode: schema.userPreferences.replyDisplayMode,
      themePreference: schema.userPreferences.themePreference,
    })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const row = rows[0];
  return {
    replyDisplayMode: parseReplyDisplayMode(row?.replyDisplayMode) ?? DEFAULT_REPLY_DISPLAY_MODE,
    themePreference: parseThemePreference(row?.themePreference) ?? DEFAULT_THEME_PREFERENCE,
  };
}

export async function updateUserPreferences(
  userId: number,
  patch: { replyDisplayMode?: ReplyDisplayMode; themePreference?: ThemePreference },
): Promise<{ replyDisplayMode: ReplyDisplayMode; themePreference: ThemePreference }> {
  const current = await getUserPreferences(userId);
  const next = {
    replyDisplayMode: patch.replyDisplayMode ?? current.replyDisplayMode,
    themePreference: patch.themePreference ?? current.themePreference,
  };
  await db
    .insert(schema.userPreferences)
    .values({ userId, ...next })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

/** 供静态测试与审计使用：确认模式列表没有重复且默认值在列表内。 */
export function assertReplyPreferenceContract(): void {
  if (new Set(REPLY_DISPLAY_MODES).size !== REPLY_DISPLAY_MODES.length) {
    throw new Error('回复展示模式存在重复值');
  }
  if (!(REPLY_DISPLAY_MODES as readonly string[]).includes(DEFAULT_REPLY_DISPLAY_MODE)) {
    throw new Error('默认回复展示模式不在允许列表内');
  }
}

/** 查询单条偏好行（测试辅助；生产代码应使用 getUserPreferences）。 */
export async function findUserPreferenceRow(userId: number) {
  const rows = await db
    .select()
    .from(schema.userPreferences)
    .where(and(eq(schema.userPreferences.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
