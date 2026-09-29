'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Moon, Sun, Monitor, Type, Check, Palette, Globe } from 'lucide-react';
import { useTheme, ThemeMode } from '@/contexts/ThemeContext';
import { useLanguage, Language } from '@/contexts/LanguageContext';

type FontFamily = 'dm-sans' | 'inter' | 'roboto' | 'poppins';
type FontSize = 'small' | 'medium' | 'large';

interface AppPreferences {
  theme: ThemeMode;
  fontFamily: FontFamily;
  fontSize: FontSize;
  compactMode: boolean;
  animationsEnabled: boolean;
}

const PREFS_KEY = 'dgaj_app_preferences';

const defaultPrefs: AppPreferences = {
  theme: 'light',
  fontFamily: 'dm-sans',
  fontSize: 'medium',
  compactMode: false,
  animationsEnabled: true,
};

const fontFamilies: { id: FontFamily; label: string; preview: string; cssVar: string }[] = [
  { id: 'dm-sans',  label: 'DM Sans',  preview: 'The quick brown fox', cssVar: "'DM Sans', sans-serif" },
  { id: 'inter',    label: 'Inter',    preview: 'The quick brown fox', cssVar: "'Inter', sans-serif" },
  { id: 'roboto',   label: 'Roboto',   preview: 'The quick brown fox', cssVar: "'Roboto', sans-serif" },
  { id: 'poppins',  label: 'Poppins',  preview: 'The quick brown fox', cssVar: "'Poppins', sans-serif" },
];

const fontSizes: { id: FontSize; label: string; desc: string; scale: string }[] = [
  { id: 'small',  label: 'Small',  desc: '13px base',  scale: '0.8125rem' },
  { id: 'medium', label: 'Medium', desc: '14px base',  scale: '0.875rem' },
  { id: 'large',  label: 'Large',  desc: '16px base',  scale: '1rem' },
];

function applyFontPreferences(prefs: AppPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const fontMap: Record<FontFamily, string> = {
    'dm-sans': "'DM Sans', sans-serif",
    'inter': "'Inter', sans-serif",
    'roboto': "'Roboto', sans-serif",
    'poppins': "'Poppins', sans-serif",
  };
  document.body.style.fontFamily = fontMap[prefs.fontFamily];
  root.style.setProperty('--font-family', fontMap[prefs.fontFamily]);

  const sizeMap: Record<FontSize, string> = {
    small: '13px',
    medium: '14px',
    large: '16px',
  };
  root.style.fontSize = sizeMap[prefs.fontSize];
}

function showToast(message: string) {
  if (typeof window === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:9999',
    'background:#7c3aed', 'color:#fff', 'padding:10px 18px',
    'border-radius:10px', 'font-size:13px', 'font-weight:600',
    'box-shadow:0 4px 16px rgba(0,0,0,0.18)', 'pointer-events:none',
    'transition:opacity 0.3s',
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1400);
  setTimeout(() => { el.remove(); }, 1700);
}

export default function AppSettings() {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [prefs, setPrefs] = useState<AppPreferences>(defaultPrefs);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AppPreferences;
        setPrefs(parsed);
        applyFontPreferences(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (mounted) {
      setPrefs((prev) => ({ ...prev, theme }));
    }
  }, [theme, mounted]);

  const updateTheme = (newTheme: ThemeMode) => {
    setTheme(newTheme);
    const updated = { ...prefs, theme: newTheme };
    setPrefs(updated);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(updated)); } catch {}
    showToast(t('preferenceUpdated'));
  };

  const updatePref = <K extends keyof Omit<AppPreferences, 'theme'>>(key: K, value: AppPreferences[K]) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(updated)); } catch {}
    applyFontPreferences(updated);
    showToast(t('preferenceUpdated'));
  };

  const updateLanguage = (lang: Language) => {
    setLanguage(lang);
    showToast(t('preferenceUpdated'));
  };

  if (!mounted) return null;

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <Settings size={20} className="text-slate-600 dark:text-slate-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('appSettingsTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('appSettingsDesc')}</p>
        </div>
      </div>

      <div className="space-y-5">

        {/* Theme */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={16} className="text-slate-600 dark:text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('appearance')}</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('appearanceDesc')}</p>
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: 'light'  as ThemeMode, label: t('light'),  icon: Sun,     preview: 'bg-white border-slate-200' },
              { id: 'dark'   as ThemeMode, label: t('dark'),   icon: Moon,    preview: 'bg-slate-900 border-slate-700' },
              { id: 'system' as ThemeMode, label: t('system'), icon: Monitor, preview: 'bg-gradient-to-br from-white to-slate-900 border-slate-300' },
            ] as const).map((opt) => {
              const OptIcon = opt.icon;
              const isActive = theme === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => updateTheme(opt.id)}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    isActive
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-700'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-2 right-2 w-4 h-4 bg-violet-500 rounded-full flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                  <div className={`w-10 h-10 rounded-lg border ${opt.preview} flex items-center justify-center`}>
                    <OptIcon size={18} className={opt.id === 'dark' ? 'text-white' : 'text-slate-600'} />
                  </div>
                  <span className={`text-xs font-semibold ${isActive ? 'text-violet-700 dark:text-violet-300' : 'text-slate-600 dark:text-slate-300'}`}>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Language */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={16} className="text-slate-600 dark:text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('language')}</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('languageDesc')}</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: 'en' as Language, label: t('english'), flag: '🇬🇧' },
              { id: 'hi' as Language, label: t('hindi'),   flag: '🇮🇳' },
            ]).map((opt) => {
              const isActive = language === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => updateLanguage(opt.id)}
                  className={`relative flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                    isActive
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-700'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-2 right-2 w-4 h-4 bg-violet-500 rounded-full flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                  <span className="text-2xl">{opt.flag}</span>
                  <span className={`text-sm font-semibold ${isActive ? 'text-violet-700 dark:text-violet-300' : 'text-slate-800 dark:text-slate-200'}`}>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Family */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Type size={16} className="text-slate-600 dark:text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('fontFamily')}</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('fontFamilyDesc')}</p>
          <div className="grid grid-cols-2 gap-3">
            {fontFamilies.map((font) => {
              const isActive = prefs.fontFamily === font.id;
              return (
                <button
                  key={font.id}
                  onClick={() => updatePref('fontFamily', font.id)}
                  className={`relative flex flex-col items-start gap-1 p-4 rounded-xl border-2 transition-all text-left ${
                    isActive
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-700'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-2 right-2 w-4 h-4 bg-violet-500 rounded-full flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                  <span className={`text-sm font-bold ${isActive ? 'text-violet-700 dark:text-violet-300' : 'text-slate-800 dark:text-slate-200'}`} style={{ fontFamily: font.cssVar }}>
                    {font.label}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500" style={{ fontFamily: font.cssVar }}>
                    {font.preview}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Size */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Type size={16} className="text-slate-600 dark:text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('fontSize')}</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('fontSizeDesc')}</p>
          <div className="grid grid-cols-3 gap-3">
            {fontSizes.map((size) => {
              const isActive = prefs.fontSize === size.id;
              return (
                <button
                  key={size.id}
                  onClick={() => updatePref('fontSize', size.id)}
                  className={`relative flex flex-col items-center gap-1 p-4 rounded-xl border-2 transition-all ${
                    isActive
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-700'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-2 right-2 w-4 h-4 bg-violet-500 rounded-full flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                  <span className={`font-bold ${isActive ? 'text-violet-700 dark:text-violet-300' : 'text-slate-800 dark:text-slate-200'}`} style={{ fontSize: size.scale }}>Aa</span>
                  <span className={`text-xs font-semibold ${isActive ? 'text-violet-600 dark:text-violet-400' : 'text-slate-600 dark:text-slate-300'}`}>
                    {size.id === 'small' ? t('small') : size.id === 'medium' ? t('medium') : t('large')}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">{size.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Other Preferences */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={16} className="text-slate-600 dark:text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('interfacePreferences')}</h2>
          </div>
          <div className="space-y-4">
            {[
              { key: 'compactMode' as const, label: t('compactMode'), desc: t('compactModeDesc') },
              { key: 'animationsEnabled' as const, label: t('animations'), desc: t('animationsDesc') },
            ].map((opt) => (
              <div key={opt.key} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{opt.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{opt.desc}</p>
                </div>
                <button
                  onClick={() => updatePref(opt.key, !prefs[opt.key])}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${prefs[opt.key] ? 'bg-violet-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${prefs[opt.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Reset */}
        <div className="flex justify-end">
          <button
            onClick={() => {
              setPrefs(defaultPrefs);
              setTheme(defaultPrefs.theme);
              try { localStorage.removeItem(PREFS_KEY); } catch {}
              applyFontPreferences(defaultPrefs);
              showToast(t('settingsReset'));
            }}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline underline-offset-2"
          >
            {t('resetDefaults')}
          </button>
        </div>
      </div>
    </>
  );
}
