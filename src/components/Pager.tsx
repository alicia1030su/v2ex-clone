'use client';

import Link from 'next/link';

/**
 * 原站风格分页器
 *
 * 结构（实测自 node_tech.html / go_search_q_node.html）：
 *   .cell.ps_container
 *     table
 *       td[92%]  a.page_current / a.page_normal × N + input.page_input（跳转框）
 *       td[8%]   ❮（禁用） / ❯（下一页）
 *
 * 与早期实现相比，这里补上了原站的三个细节：
 *  - 跳转输入框（.page_input）
 *  - 左右箭头按钮
 *  - 当前页高亮
 */
export default function Pager({
  page,
  totalPages,
  basePath,
  query,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  /** 额外的查询参数（如搜索关键词），会被保留在翻页链接中 */
  query?: Record<string, string>;
}) {
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) params.set(k, v);
    }
    if (p > 1) params.set('p', String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const pages = buildWindow(page, totalPages);

  return (
    <div className="cell ps_container">
      <table cellPadding={0} cellSpacing={0} border={0} width="100%">
        <tbody>
          <tr>
            <td width="92%" align="left">
              {pages.map((p, i) =>
                p === -1 ? (
                  <span key={`gap-${i}`} className="fade">
                    ...
                  </span>
                ) : p === page ? (
                  <span key={p} className="page_current">
                    {p}
                  </span>
                ) : (
                  <Link key={p} href={makeHref(p)} className="page_normal">
                    {p}
                  </Link>
                ),
              )}{' '}
              <input
                type="number"
                className="page_input"
                autoComplete="off"
                defaultValue={page}
                min={1}
                max={totalPages}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const value = Number((e.target as HTMLInputElement).value);
                    if (Number.isInteger(value) && value >= 1 && value <= totalPages) {
                      window.location.href = makeHref(value);
                    }
                  }
                }}
              />
            </td>
            <td width="8%" align="right">
              <table cellPadding={0} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                    <td
                      width="50%"
                      align="center"
                      className={`super normal button${page <= 1 ? ' disable_now' : ''}`}
                      style={{
                        display: 'table-cell',
                        borderRight: 'none',
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                        cursor: page <= 1 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      ❮
                    </td>
                    <td
                      width="50%"
                      align="center"
                      className="super normal_page_right button"
                      style={{
                        display: 'table-cell',
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        cursor: page < totalPages ? 'pointer' : 'not-allowed',
                      }}
                      onClick={() => {
                        if (page < totalPages) window.location.href = makeHref(page + 1);
                      }}
                      title="下一页"
                    >
                      ❯
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 页码窗口：1 … 4 5 6 … 20 */
function buildWindow(page: number, totalPages: number): number[] {
  const out: number[] = [];
  const push = (n: number) => {
    if (n >= 1 && n <= totalPages && !out.includes(n)) out.push(n);
  };

  if (totalPages <= 9) {
    for (let i = 1; i <= totalPages; i++) push(i);
    return out.sort((a, b) => a - b);
  }

  push(1);
  const start = Math.max(2, page - 2);
  const end = Math.min(totalPages - 1, page + 2);
  if (start > 2) out.push(-1);
  for (let i = start; i <= end; i++) push(i);
  if (end < totalPages - 1) out.push(-1);
  push(totalPages);
  return out;
}
