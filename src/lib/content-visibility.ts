import { and, eq, isNull, type SQL } from 'drizzle-orm';
import * as schema from '@/db/schema';

/**
 * Public content visibility predicates shared by every public read and
 * user-to-content interaction.
 *
 * This module is intentionally pure: it only depends on Drizzle and the schema,
 * never on `server-only`, `@/db`, sessions, or environment variables. Tests and
 * injected-database consumers can therefore import it without opening a pool.
 *
 * Node visibility remains defined by `PUBLIC_NODE_CONDITION` in
 * `src/lib/node-visibility.ts`. Topic/reply queries must join `nodes` and use
 * that predicate alongside the conditions below.
 */

/** The only topic state exposed to ordinary visitors. */
export const PUBLIC_TOPIC_STATUS = 'published' as const;

/**
 * A public topic must be published and must not carry a soft-delete marker.
 * Checking both fields also covers legacy/inconsistent rows where only one of
 * the two deletion signals was set.
 */
export const PUBLIC_TOPIC_CONDITION: SQL = and(
  eq(schema.topics.status, PUBLIC_TOPIC_STATUS),
  isNull(schema.topics.deletedAt),
)!;

/** A public reply must not carry a soft-delete marker. */
export const PUBLIC_REPLY_CONDITION: SQL = isNull(schema.replies.deletedAt);

/** In-memory counterpart for single-row detail and authorization checks. */
export function isPublicTopicState(
  topic: Pick<typeof schema.topics.$inferSelect, 'status' | 'deletedAt'>,
): boolean {
  return topic.status === PUBLIC_TOPIC_STATUS && topic.deletedAt === null;
}

/** In-memory counterpart for single-row reply checks. */
export function isPublicReplyState(
  reply: Pick<typeof schema.replies.$inferSelect, 'deletedAt'>,
): boolean {
  return reply.deletedAt === null;
}
