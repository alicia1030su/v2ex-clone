import type { Metadata, Viewport } from 'next';
import { getSessionUser } from '@/lib/auth';
import { getUserPreferences } from '@/server/reply-preferences';
import './globals.css';

export const metadata: Metadata = {
  title: 'V2EX',
  description: 'way to explore',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const serverTheme = user ? (await getUserPreferences(user.id)).themePreference : null;
  const themeBootstrap = `(function(){try{window.__V2EX_SERVER_THEME__=${JSON.stringify(serverTheme)};var s=window.__V2EX_SERVER_THEME__;var m=document.cookie.match(/(?:^|; )v2_theme=([^;]+)/);var c=m?decodeURIComponent(m[1]):null;var l=null;try{l=localStorage.getItem('v2ex-theme');}catch(e){}var t=(s==='light'||s==='dark'||s==='system')?s:((c==='light'||c==='dark'||c==='system')?c:((l==='light'||l==='dark'||l==='system')?l:'system'));function a(v){document.documentElement.dataset.theme=v;document.documentElement.dataset.effectiveTheme=v==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):v;document.documentElement.style.colorScheme=document.documentElement.dataset.effectiveTheme;}a(t);if(t==='system'&&matchMedia){var q=matchMedia('(prefers-color-scheme: dark)');if(q.addEventListener)q.addEventListener('change',function(){a('system');});}}catch(e){document.documentElement.dataset.theme='system';document.documentElement.dataset.effectiveTheme='light';}})();`;

  return (
    <html
      lang="zh-CN"
      data-theme={serverTheme ?? 'system'}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
