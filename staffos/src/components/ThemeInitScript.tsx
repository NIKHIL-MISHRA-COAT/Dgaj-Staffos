'use client';

import { useEffect } from 'react';

/**
 * Reads the stored theme from localStorage and applies the 'dark' class
 * to <html> immediately on mount — before the first paint — to prevent
 * a flash of the wrong theme.
 */
export default function ThemeInitScript() {
  useEffect(() => {
    try {
      const stored = localStorage.getItem('dgaj_app_preferences');
      if (stored) {
        const prefs = JSON.parse(stored);
        const theme = prefs?.theme;
        if (theme === 'dark') {
          document.documentElement?.classList?.add('dark');
        } else if (theme === 'system') {
          if (window.matchMedia('(prefers-color-scheme: dark)')?.matches) {
            document.documentElement?.classList?.add('dark');
          } else {
            document.documentElement?.classList?.remove('dark');
          }
        } else {
          document.documentElement?.classList?.remove('dark');
        }
      }
    } catch {}
  }, []);

  return null;
}
