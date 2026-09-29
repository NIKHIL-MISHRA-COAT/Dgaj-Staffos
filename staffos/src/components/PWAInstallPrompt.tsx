'use client';

import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    // Check if user dismissed before
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) return;

    if (ios) {
      // Show iOS instructions after a short delay
      const timer = setTimeout(() => setShowBanner(true), 3000);
      return () => clearTimeout(timer);
    }

    // Android/Chrome: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowBanner(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setShowBanner(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (isInstalled || !showBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-80">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        {/* App icon */}
        <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-slate-700">
          <img
            src="/assets/images/app_logo.png"
            alt="DGaj Connect app icon"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm leading-tight">Install DGaj Connect</p>
          {isIOS ? (
            <p className="text-slate-400 text-xs mt-1 leading-snug">
              Tap the <span className="text-white font-medium">Share</span> button then{' '}
              <span className="text-white font-medium">"Add to Home Screen"</span> to install.
            </p>
          ) : (
            <p className="text-slate-400 text-xs mt-1 leading-snug">
              Add to your home screen for a full-screen app experience.
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3">
            {!isIOS && (
              <button
                onClick={handleInstall}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                Install
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1.5 rounded-lg transition-colors"
            >
              Not now
            </button>
          </div>
        </div>

        {/* Close */}
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors mt-0.5"
          aria-label="Dismiss install prompt"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
