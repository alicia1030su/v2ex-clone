import { avatarUrl } from '@/components/Avatar';
import Link from 'next/link';
import { listHotTopics } from '@/server/queries';

export default async function HotTopics() {
  const topics = await listHotTopics(10);
  if (topics.length === 0) return null;

  return (
    <>
      <div className="sep20" />
      <div className="box" id="TopicsHot">
        <div className="cell">
          <span className="fade">今日热议主题</span>
        </div>
        {topics.map((t) => (
          <div className="cell" key={t.id}>
            <table cellPadding={0} cellSpacing={0} border={0} width="100%">
              <tr>
                <td width={24} valign="middle" align="center">
                  <Link href={`/member/${t.username}`}>
                    <img
                      src={avatarUrl({ id: t.authorId, username: t.username, avatar: t.avatar }, 24)}
                      className="avatar"
                      width={24}
                      height={24}
                      alt={t.username}
                      data-uid={t.authorId}
                    />
                  </Link>
                </td>
                <td width={10} />
                <td width="auto" valign="middle">
                  <span className="item_hot_topic_title">
                    <Link href={`/t/${t.id}`}>{t.title}</Link>
                  </span>
                </td>
              </tr>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
