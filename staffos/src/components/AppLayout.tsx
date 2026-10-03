'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import MobileMenu from './MobileMenu';
import NotificationBell from './NotificationBell';
import { Menu } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDeviceSession } from '@/lib/useDeviceSession';
import RouteGuard from './RouteGuard';
import NotificationListener from './NotificationListener';

interface AppLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

export default function AppLayout({ children, activePath }: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { effectiveUserId } = useAuth();
  useDeviceSession(effectiveUserId);

  // Close menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activePath]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  return (
    <div className="flex bg-slate-50 dark:bg-slate-950 overflow-hidden" style={{ height: '100dvh' }}>
      <NotificationListener />
      {/* Desktop sidebar — part of normal flow, never shown on mobile */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar activePath={activePath} />
      </div>

      {/* Mobile full-screen menu overlay */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        activePath={activePath}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main content — always full width on mobile */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0 w-full">
        {/* Mobile top bar — respects safe-area top (notch / dynamic island) */}
        <div
          className="flex lg:hidden items-center gap-2 px-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex-shrink-0"
          style={{
            paddingTop: 'max(env(safe-area-inset-top), 10px)',
            paddingBottom: '10px',
            paddingLeft: 'max(env(safe-area-inset-left), 12px)',
            paddingRight: 'max(env(safe-area-inset-right), 12px)',
          }}
        >
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu size={22} className="text-slate-600 dark:text-slate-300" />
          </button>
          <span className="font-bold text-slate-900 dark:text-slate-100 text-base flex-1 truncate min-w-0 ml-1">
            DGaj Connect
          </span>
          <NotificationBell />
        </div>

        {/* Scrollable content area — full width, no sidebar interference */}
        {/* Respects safe-area on left/right/bottom for curved displays & gesture nav */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="min-h-full">
            <RouteGuard>{children}</RouteGuard>
          </div>
        </div>
      </main>
    </div>
  );
}