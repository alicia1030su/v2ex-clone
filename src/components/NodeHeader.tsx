import Link from 'next/link';
import { RssIcon, JsonFeedIcon } from '@/components/FeedIcons';

/**
 * 节点横幅 —— 对应原站的 .box-title.node-header
 *
 * 结构（实测自 node_tech.html / go_search_q_node.html）：
 *   .box.box-title.node-header
 *     .cell.page-content-header
 *       img[64x64]              节点图标
 *       .title
 *         .node-breadcrumb       V2EX › 节点名
 *         .topic-count           主题总数 N
 *         .node-feed             RSS / JSON Feed 图标
 */
export default function NodeHeader({
  title,
  topicCount,
  feedName,
  avatar,
}: {
  title: string;
  topicCount: number;
  /** feed 文件名前缀，用于生成 /feed/{name}.xml 与 /feed/{name}.json */
  feedName: string;
  avatar?: string | null;
}) {
  return (
    <div className="box box-title node-header">
      <div className="cell page-content-header">
        {avatar ? (
          <img src={avatar} alt={title} width={64} height={64} />
        ) : (
          <div
            style={{
              width: 64,
              height: 64,
              flex: '0 0 64px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.08)',
              border: '1px dashed rgba(255,255,255,0.35)',
            }}
          />
        )}
        <div>
          <div className="title">
            <div className="node-breadcrumb">
              <Link href="/">V2EX</Link> <span className="chevron">&nbsp;›&nbsp;</span> {title}
            </div>
            <span className="topic-count">
              主题总数 <strong>{topicCount}</strong>
            </span>
            <span className="node-feed">
              <Link href={`/feed/${feedName}.xml`} target="_blank">
                <RssIcon size={16} />
              </Link>
              <Link href={`/feed/${feedName}.json`} target="_blank">
                <JsonFeedIcon size={16} />
              </Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
