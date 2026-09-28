'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const PREFS_KEY = 'dgaj_app_preferences';

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  setTheme: () => {},
  isDark: false,
});

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const isDark = theme === 'dark' || (theme === 'system' && getSystemDark());
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.theme) {
          setThemeState(parsed.theme as ThemeMode);
          applyTheme(parsed.theme as ThemeMode);
        }
      }
    } catch {}

    // Listen for system theme changes when in 'system' mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      setThemeState((prev) => {
        if (prev === 'system') applyTheme('system');
        return prev;
      });
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    applyTheme(newTheme);
    // Persist inside existing prefs object
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      const prefs = stored ? JSON.parse(stored) : {};
      prefs.theme = newTheme;
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  };

  const isDark =
    theme === 'dark' || (theme === 'system' && (mounted ? getSystemDark() : false));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
