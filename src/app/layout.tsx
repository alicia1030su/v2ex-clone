import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'V2EX',
  description: 'way to explore',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // CSRF Cookie 由 src/middleware.ts 下发
  // （Server Component 不允许修改 Cookie）
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
