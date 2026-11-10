import Link from 'next/link';
import { relativeTime, fullTimestamp, DOT } from '@/lib/time';
import { avatarUrl } from './Avatar';
import type { TopicListItem } from '@/server/queries';

export default function TopicItem({ topic }: { topic: TopicListItem }) {
  return (
    <div className="cell item">
      {/* v0.0.6：必须显式 <tbody> —— 浏览器解析 <table><tr> 时会自动插入
          tbody，React 水合对比虚拟 DOM（table>tr）与实际 DOM（table>tbody>tr）
          不匹配 ⇒ React #418 水合失败（生产模式仅报错后客户端恢复，
          E2E 照过 ⇒ 长期静默缺陷）。 */}
      <table cellPadding={0} cellSpacing={0} border={0} width="100%">
        <tbody>
          <tr>
          <td width={48} valign="top" align="center">
            <Link href={`/member/${topic.author.username}`}>
              <img
                src={avatarUrl(
                  {
                    id: topic.author.id,
                    username: topic.author.username,
                    avatar: topic.author.avatar,
                  },
                  48,
                )}
                className="avatar"
                width={48}
                height={48}
                alt={topic.author.username}
                data-uid={topic.author.id}
              />
            </Link>
          </td>
          <td width={10} />
          <td width="auto" valign="middle">
            <span className="item_title">
              <Link
                href={`/t/${topic.id}#reply${topic.repliesCount}`}
                className="topic-link"
                id={`topic-link-${topic.id}`}
              >
                {topic.title}
              </Link>
            </span>
            <div className="sep5" />
            <span className="topic_info">
              <div className="votes">
                {topic.votes > 0 ? (
                  <>
                    <li className="fa fa-chevron-up" /> &nbsp;{topic.votes} &nbsp;&nbsp;
                  </>
                ) : null}
              </div>
              <Link className="node" href={`/go/${topic.node.name}`}>
                {topic.node.title}
              </Link>{' '}
              {DOT}
              <strong>
                <Link href={`/member/${topic.author.username}`}>{topic.author.username}</Link>
              </strong>{' '}
              {DOT}
              <span title={fullTimestamp(topic.createdAt)}>{relativeTime(topic.createdAt)}</span>
              {/*
               * v0.0.16：`最后回复来自 X` 只在**确实有回复者**时渲染。
               *
               * 修复前这里是 `topic.lastReplier?.username ?? topic.author.username` ——
               * 「取不到就显示楼主」。后果是**最热 tab 每一行都写着楼主**，
               * 而数据库里 6 条有 5 条真实最后回复者是别人。
               *
               * 根因不是这里，而是 `listTopicsByNodeIds()` 把 lastReplier 硬编码 null
               * （已在 queries.ts 修掉）。但组件这一层的兜底同样是错的：
               * 它把「没有数据」伪装成「数据是楼主」——一种看不出来的错误。
               * 现在改为：没有回复者就不渲染这一段，宁可少一行字，也不写假名字。
               */}
              {topic.lastReplier ? (
                <>
                  {' '}
                  {DOT} 最后回复来自{' '}
                  <strong>
                    <Link href={`/member/${topic.lastReplier.username}`}>
                      {topic.lastReplier.username}
                    </Link>
                  </strong>
                </>
              ) : null}
            </span>
          </td>
          <td width={70} align="right" valign="middle">
            <Link href={`/t/${topic.id}#reply${topic.repliesCount}`} className="count_livid">
              {topic.repliesCount}
            </Link>
          </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
