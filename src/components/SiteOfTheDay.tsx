import Link from 'next/link';

/**
 * Site of the Day —— 对应原站首页侧栏底部的 VXNA 区块
 *
 * 原站结构（实测自 home.html）：
 *   .box
 *     .cell.flex-one-row  [Web 图标] VXNA › Site of the Day
 *     .cell.flex-one-row  站点名 + 简介
 *
 * 本项目不复制原站指向的第三方站点内容，改为展示本站的精选节点。
 */
export default function SiteOfTheDay() {
  return (
    <>
      <div className="sep20" />
      <div className="box">
        <div className="cell flex-one-row" style={{ gap: '10px' }}>
          <strong style={{ fontSize: 12, fontWeight: 700 }}>
            <Link href="/xna">VXNA</Link>
          </strong>
          <span className="chevron">›</span>
          <span style={{ flex: 1 }}>Site of the Day</span>
        </div>
        <div className="cell flex-one-row" style={{ gap: '5px' }}>
          <div style={{ flex: 1 }} className="f16">
            <Link href="/nodes">全部节点</Link>
          </div>
          <span className="f12 fade">浏览社区的每一个分区</span>
        </div>
      </div>
    </>
  );
}
