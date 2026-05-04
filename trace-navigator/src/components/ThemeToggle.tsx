'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'trace-navigator-theme';

function resolveTheme(): Theme {
  if (typeof document !== 'undefined') {
    const current = document.documentElement.dataset.theme;
    if (current === 'dark' || current === 'light') return current;
  }

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

export default function ThemeToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const initialTheme = resolveTheme();
    setTheme(initialTheme);
    setMounted(true);
  }, []);

  const nextTheme: Theme = theme === 'light' ? 'dark' : 'light';

  const handleToggle = () => {
    const updatedTheme = nextTheme;
    setTheme(updatedTheme);
    applyTheme(updatedTheme);
  };

  const useDarkIconButton = iconOnly && theme === 'light';

  return (
    <button
      type="button"
      aria-label={mounted ? `Switch to ${nextTheme} mode` : 'Toggle color mode'}
      aria-pressed={theme === 'dark'}
      onClick={handleToggle}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.55rem',
        justifyContent: 'center',
        padding: iconOnly ? '0.45rem' : '0.5rem 0.75rem',
        minWidth: iconOnly ? '32px' : undefined,
        minHeight: iconOnly ? '32px' : undefined,
        borderRadius: iconOnly ? '3px' : '999px',
        border: useDarkIconButton ? '1px solid var(--ink)' : '1px solid var(--rule)',
        background: useDarkIconButton ? 'var(--ink)' : 'var(--paper-warm)',
        color: useDarkIconButton ? 'var(--paper)' : 'var(--ink)',
        cursor: 'pointer',
        fontFamily: 'var(--sans)',
        fontSize: '0.82rem',
        fontWeight: 600,
        lineHeight: 1,
        transition: 'background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease',
      }}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
      {!iconOnly && <span>{mounted ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : 'Theme'}</span>}
    </button>
  );
}