'use client';

import { useEffect, useState } from 'react';
import { csrfFetch } from '@/components/CsrfProvider';
import type { ThemePreference } from '@/server/reply-preferences';

const LOCAL_KEY = 'v2ex-theme';
const OPTIONS: ThemePreference[] = ['light', 'dark', 'system'];
const LABELS: Record<ThemePreference, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

function applyTheme(theme: ThemePreference) {
  const effective = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.effectiveTheme = effective;
  document.documentElement.style.colorScheme = effective;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === 'light' || current === 'dark' || current === 'system') {
      setTheme(current);
      applyTheme(current);
      return;
    }
    try {
      const local = window.localStorage.getItem(LOCAL_KEY);
      if (local === 'light' || local === 'dark' || local === 'system') {
        setTheme(local);
        applyTheme(local);
      }
    } catch {
      /* 默认跟随系统 */
    }
  }, []);

  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyTheme('system');
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, [theme]);

  async function change(next: ThemePreference) {
    const previous = theme;
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(LOCAL_KEY, next);
    } catch {
      /* 服务端登录用户仍可保存 */
    }
    setSaving(true);
    try {
      const res = await csrfFetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themePreference: next }),
      });
      if (res.status === 401) return;
      if (!res.ok) throw new Error('save failed');
    } catch {
      setTheme(previous);
      applyTheme(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="theme-toggle" title="主题外观">
      <span className="sr-only">主题外观</span>
      <select
        aria-label="主题外观"
        value={theme}
        disabled={saving}
        onChange={(event) => void change(event.target.value as ThemePreference)}
      >
        {OPTIONS.map((option) => (
          <option key={option} value={option}>{LABELS[option]}</option>
        ))}
      </select>
    </label>
  );
}
