'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Suggest = {
  id: number;
  type: 'topic' | 'node' | 'member';
  title: string;
  extra: string;
};

export default function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggest[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setItems([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Suggest[] };
        setItems(data.items ?? []);
        setOpen(true);
      } catch {
        /* 忽略中断与网络错误 */
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setOpen(false);
    router.push(`/go/search?q=${encodeURIComponent(term)}`);
  }

  return (
    <div id="search-container" ref={boxRef}>
      <form onSubmit={submit} role="search">
        <input
          id="search"
          type="text"
          maxLength={128}
          autoComplete="off"
          tabIndex={1}
          placeholder="搜索 V2EX"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
        />
      </form>
      <div id="search-result" className={`box${open && items.length ? ' show' : ''}`}>
        {items.map((it) => (
          <a
            key={`${it.type}-${it.id}`}
            className="cell"
            href={
              it.type === 'topic'
                ? `/t/${it.id}`
                : it.type === 'node'
                  ? `/go/${it.title}`
                  : `/member/${it.title}`
            }
          >
            <div className="f12 gray">
              {it.type === 'topic' ? '主题' : it.type === 'node' ? '节点' : '会员'} · {it.extra}
            </div>
            <div>{it.title}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
