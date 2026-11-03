/**
 * V2EX 文字标志
 *
 * 原站使用受保护的图片资源 /static/img/v2ex@2x.png。
 * 本项目以同样尺寸（94x30 / 100x30）渲染文字标志，不复制原站品牌图片。
 */
export default function Logo({ width = 100 }: { width?: number }) {
  const height = 30;
  const fontSize = width <= 94 ? 21 : 22;
  return (
    <div
      id="Logo"
      style={{
        width,
        height,
        fontSize,
        fontWeight: 700,
        letterSpacing: '-0.5px',
        // 原站 Logo 是背景图片（图片自身有留白，实际像素从 y=9 开始）。
        // 文字 Logo 需要上移 5px 才能让字形像素落在同一位置 ——
        // 该偏移由截图逐像素比对测得（docs/VISUAL_DIFF_REPORT.md）。
        transform: 'translateY(-5px)',
        lineHeight: `${height}px`,
        color: '#000',
        textAlign: 'left',
        backgroundImage: 'none',
      }}
    >
      V2EX
    </div>
  );
}
