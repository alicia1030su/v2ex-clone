import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import {
  PUBLIC_NODE_CONDITION,
} from '@/lib/node-visibility';
import {
  PUBLIC_REPLY_CONDITION,
  PUBLIC_TOPIC_CONDITION,
} from '@/lib/content-visibility';

export type AttachmentVisibility = {
  visible: boolean;
  isPublic: boolean;
};

/**
 * 头像只有“当前正在使用”的那一份可公开读取。
 * 历史头像元数据可以保留用于审计，但旧 URL 会立即 404。
 */
export async function resolveAvatarVisibility(
  storagePath: string,
  _viewerId: number | null,
): Promise<AttachmentVisibility> {
  const rows = await db
    .select({ userId: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.avatar, `/uploads/${storagePath}`))
    .limit(1);

  if (rows[0]) return { visible: true, isPublic: true };

  // 非当前头像即使原所有者也不再通过直链读取；恢复历史头像属于管理操作。
  return { visible: false, isPublic: false };
}

/**
 * 回复图片可见性：
 *  - 未绑定回复：仅上传者本人可读；
 *  - 已绑定回复：公共可见性必须同时满足回复未删、主题 published/未删、节点 active；
 *  - 内容不可见时，仅上传者本人可读，且响应不得进入共享缓存。
 */
export async function resolveReplyImageVisibility(
  storagePath: string,
  viewerId: number | null,
): Promise<AttachmentVisibility> {
  const rows = await db
    .select({
      id: schema.replyImages.id,
      userId: schema.replyImages.userId,
      state: schema.replyImages.state,
    })
    .from(schema.replyImages)
    .where(eq(schema.replyImages.storagePath, storagePath))
    .limit(1);

  const image = rows[0];
  if (!image) return { visible: false, isPublic: false };
  if (image.state === 'deleted' || image.state === 'purged') {
    return { visible: false, isPublic: false };
  }

  // 只有 active 状态才能凭借当前 link 进入公共面。superseded 可能短暂残留
  // 历史 link（例如编辑事务与清理队列并发），但那些 link 不再是授权依据。
  if (image.state === 'active') {
    const publicRows = await db
      .select({ id: schema.replyImageLinks.attachmentId })
      .from(schema.replyImageLinks)
      .innerJoin(schema.replies, eq(schema.replies.id, schema.replyImageLinks.replyId))
      .innerJoin(schema.topics, eq(schema.topics.id, schema.replies.topicId))
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(and(
        eq(schema.replyImageLinks.attachmentId, image.id),
        PUBLIC_REPLY_CONDITION,
        PUBLIC_TOPIC_CONDITION,
        PUBLIC_NODE_CONDITION,
      ))
      .limit(1);

    if (publicRows[0]) return { visible: true, isPublic: true };
  }

  // pending（无链接）或 superseded（链接已全部移除）在宽限期内仅所有者可读。
  return {
    visible: viewerId === image.userId,
    isPublic: false,
  };
}
