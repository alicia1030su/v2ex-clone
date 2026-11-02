/**
 * RSS / JSON Feed 图标
 *
 * 原站使用受保护的图片资源（/static/img/planet/rss512.png 等）。
 * 本项目以内联 SVG 绘制等价图标，避免 404 且不复制原站素材。
 */
export function RssIcon({ size = 28 }: { size?: number }) {
  const r = Math.round(size / 2);
  const dot = Math.max(3, Math.round(size / 7));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="RSS"
      style={{ borderRadius: 4, verticalAlign: 'bottom' }}
    >
      <rect width={size} height={size} rx={4} fill="#f26522" />
      <circle cx={r} cy={size - r} r={dot} fill="#fff" />
      <path
        d={`M ${r} ${size - r - dot - 1.2} a ${dot + 1.2} ${dot + 1.2} 0 0 1 ${dot + 1.2} ${dot + 1.2}`}
        stroke="#fff"
        strokeWidth={Math.max(1.5, size / 12)}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M ${r} ${size - r - dot - 1.2 - size * 0.28} a ${dot + 1.2 + size * 0.28} ${
          dot + 1.2 + size * 0.28
        } 0 0 1 ${dot + 1.2 + size * 0.28} ${dot + 1.2 + size * 0.28}`}
        stroke="#fff"
        strokeWidth={Math.max(1.5, size / 12)}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function JsonFeedIcon({ size = 28 }: { size?: number }) {
  const r = Math.round(size / 2);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="JSON Feed"
      style={{ borderRadius: 4, verticalAlign: 'bottom' }}
    >
      <rect width={size} height={size} rx={4} fill="#1e88e5" />
      <text
        x="50%"
        y="50%"
        dy="0.35em"
        textAnchor="middle"
        fontFamily="Consolas,Menlo,monospace"
        fontSize={Math.round(size * 0.5)}
        fontWeight="700"
        fill="#fff"
      >
        {'{ }'}
      </text>
    </svg>
  );
}
