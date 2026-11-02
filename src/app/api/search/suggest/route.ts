import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

export const dynamic = 'force-dynamic';

type Suggest = {
  id: number;
  type: 'topic' | 'node' | 'member';
  title: string;
  extra: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ items: [] });

  const kw = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const [topics, nodes, members] = await Promise.all([
    db
      .select({
        id: schema.topics.id,
        title: schema.topics.title,
        node: schema.nodes.title,
      })
      .from(schema.topics)
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.topics.nodeId))
      .where(
        and(
          eq(schema.topics.status, 'published'),
          or(ilike(schema.topics.title, kw), ilike(schema.topics.content, kw))!,
        ),
      )
      .orderBy(desc(schema.topics.lastReplyAt))
      .limit(6),
    db
      .select({ id: schema.nodes.id, title: schema.nodes.title, name: schema.nodes.name })
      .from(schema.nodes)
      .where(
        or(ilike(schema.nodes.title, kw), ilike(schema.nodes.name, kw))!,
      )
      .limit(4),
    db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(ilike(schema.users.username, kw))
      .limit(4),
  ]);

  const items: Suggest[] = [
    ...topics.map((t) => ({
      id: t.id,
      type: 'topic' as const,
      title: t.title,
      extra: t.node,
    })),
    ...nodes.map((n) => ({
      id: n.id,
      type: 'node' as const,
      title: n.title,
      extra: n.name,
    })),
    ...members.map((m) => ({
      id: m.id,
      type: 'member' as const,
      title: m.username,
      extra: '会员',
    })),
  ];

  return NextResponse.json({ items });
}
