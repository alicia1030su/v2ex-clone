import Link from 'next/link';

export default function PageNav({
  page,
  totalPages,
  basePath,
  tab,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  tab?: string;
}) {
  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);
    if (p > 1) params.set('p', String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const visible = buildWindow(page, totalPages);

  return (
    <div style={{ textAlign: 'center' }}>
      {page > 1 ? (
        <Link href={makeHref(page - 1)} className="page_normal">
          ‹ 上一页
        </Link>
      ) : (
        <span className="page_normal" style={{ opacity: 0.45 }}>
          ‹ 上一页
        </span>
      )}
      &nbsp;
      {visible.map((p, i) =>
        p === -1 ? (
          <span key={`gap-${i}`} className="page_normal" style={{ opacity: 0.5 }}>
            …
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
      )}
      &nbsp;
      {page < totalPages ? (
        <Link href={makeHref(page + 1)} className="page_normal">
          下一页 ›
        </Link>
      ) : (
        <span className="page_normal" style={{ opacity: 0.45 }}>
          下一页 ›
        </span>
      )}
    </div>
  );
}

/** 生成页码窗口：首页 1 … 4 5 6 … 20 */
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
