import Link from 'next/link';
import { RssIcon, JsonFeedIcon } from '@/components/FeedIcons';
import { avatarDataUri } from '@/components/Avatar';

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
  /**
   * 节点名，用于生成该节点的 feed 地址 **`/feed/{name}.xml` / `.json`**
   * （原站路径，v0.0.13 起由 `src/app/feed/[file]/route.ts` 真实提供）。
   *
   * ⚠️ 这段历史值得记：v0.0.9 时 `/feed/{name}.xml` **确实**恒 404
   * （当时只实现了 `/api/nodes/{name}/feed`），于是把图标改成指向内部
   * API 路径「先修好死链」。但内部路径不是对外契约 —— 原站用的是
   * `/feed/{name}.xml`（Atom 1.0）。v0.0.13 补齐原站路径后，
   * 图标恢复指向原站地址，内部 API 路径继续保留以兼容既有调用方。
   * 传空值表示该页面对应不到真实节点（如搜索结果页）—— 此时不渲染图标。
   */
  feedName?: string | null;
  avatar?: string | null;
}) {
  return (
    <div className="box box-title node-header">
      <div className="cell page-content-header">
        {avatar ? (
          <img src={avatar} alt={title} width={64} height={64} />
        ) : (
          /*
           * v0.0.9：没有图标时**不要**画空框。
           *
           * 原实现是一个 64×64 的虚线空盒（只为占住盒模型）。在 README 截图里
           * 它读起来就是「图片挂了」—— 而真实 V2EX 的每个节点都有彩色图标。
           * 这里改用与用户头像同一套确定性 SVG 生成器（同节点恒同色同首字），
           * 既保留 `img` 的盒模型（`.cell.page-content-header > img` 的
           * `margin: 0 10px 0 0` 才能命中），又不会出现「空框」观感。
           * 仍然**不复制**原站版权图标。
           */
          <img
            /* seed 必须**直接用节点名**：avatarDataUri 取 seed 的首字符做字形，
               写成 `node:${title}` 会让所有节点都显示字母「N」（实测踩到）。 */
            src={avatarDataUri(title, 64)}
            alt={title}
            width={64}
            height={64}
            className="node-icon-generated"
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
            {feedName ? (
              <span className="node-feed">
                {/* 用原生 <a>：feed 不是页面路由，App Router 预取它只会得到一个 404 */}
                <a href={`/feed/${feedName}.xml`} target="_blank" rel="noopener noreferrer">
                  <RssIcon size={16} />
                </a>
                <a
                  href={`/feed/${feedName}.json`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <JsonFeedIcon size={16} />
                </a>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
