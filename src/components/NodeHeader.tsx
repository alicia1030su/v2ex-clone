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
          // v0.0.6：占位符必须与 img 的盒模型一致 ——
          // `.cell.page-content-header > img` 带 `margin: 0 10px 0 0`，
          // 占位 div 不是 img，拿不到该规则 ⇒ 曾经与右侧标题贴死（0 间距）。
          // 深色横幅（#001d25）上半透明白色可见，无需改色。
          <div
            style={{
              display: 'block',
              width: 64,
              height: 64,
              flex: '0 0 64px',
              margin: '0 10px 0 0',
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
