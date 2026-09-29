'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Search, FileText, AlertCircle, Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

// Quick-jump targets for the header search — lets people jump straight to a
// page by typing part of its name instead of hunting through the sidebar.
const QUICK_LINKS = [
  { label: 'My Tasks', href: '/my-tasks' }, { label: 'Calendar', href: '/calendar' },
  { label: 'Chat', href: '/chat' }, { label: 'Attendance', href: '/attendance-records' },
  { label: 'Leave Dashboard', href: '/leave-management' }, { label: 'Apply Leave', href: '/leave-request' },
  { label: 'Holiday Management', href: '/holiday-management' }, { label: 'Payroll', href: '/payroll' },
  { label: 'Ticket Centre', href: '/ticket-centre' }, { label: 'Expense Centre', href: '/expense-centre' },
  { label: 'Documents', href: '/documents' }, { label: 'Reports', href: '/reports' },
  { label: 'Notifications', href: '/notifications' }, { label: 'My Profile', href: '/employee-profile' },
];

export default function DashboardHeader() {
  const { canInstall, isIOS, triggerInstall, showIOSInstructions, setShowIOSInstructions } = usePWAInstall();
  const { t } = useLanguage();
  const { user, pinSession } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<{ full_name?: string; job_title?: string; role?: string } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = searchQuery.trim()
    ? QUICK_LINKS.filter((l) => l.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : QUICK_LINKS;

  useEffect(() => {
    const uid = user?.id || pinSession?.userId;
    if (!uid) return;
    const supabase = createClient();
    supabase
      .from('user_profiles')
      .select('full_name, job_title, role')
      .eq('id', uid)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data);
      });
  }, [user?.id, pinSession?.userId]);

  const displayName = profile?.full_name || user?.email?.split('@')[0] || pinSession?.email?.split('@')[0] || 'User';
  const displayRole = profile?.job_title || profile?.role || pinSession?.jobTitle || pinSession?.role || '';

  return (
    <div className="flex flex-col gap-3 mb-5">
      <div>
        <p className="text-xs font-600 uppercase tracking-wider text-slate-400 mb-1">{t('welcomeBack')}</p>
        <h1 className="text-xl sm:text-2xl font-700 text-slate-900 dark:text-slate-100">
          {t('goodMorning')}, {displayName}
        </h1>
        {displayRole ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 capitalize">{displayRole}</p>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('dashboardReady')}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Install App Button */}
        {canInstall && (
          <button
            onClick={triggerInstall}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2.5 rounded-lg transition-colors shadow-sm min-h-[40px]"
          >
            {isIOS ? <Smartphone size={14} /> : <Download size={14} />}
            {t('installApp')}
          </button>
        )}

        {/* iOS Instructions Modal */}
        {showIOSInstructions && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4" onClick={() => setShowIOSInstructions(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl" onClick={(e) => e?.stopPropagation()}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                  <Smartphone size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">Install DGaj Connect</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Add to your Home Screen</p>
                </div>
              </div>
              <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">1</span>
                  <span>Tap the <strong>Share</strong> button (box with arrow) at the bottom of Safari</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">2</span>
                  <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">3</span>
                  <span>Tap <strong>"Add"</strong> in the top right corner</span>
                </li>
              </ol>
              <button
                onClick={() => setShowIOSInstructions(false)}
                className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <button onClick={() => router.push('/leave-request')} className="btn-ghost text-xs gap-1.5 border border-slate-200 dark:border-slate-700 min-h-[40px] px-3">
          <FileText size={14} />
          <span className="hidden sm:inline">{t('applyLeave')}</span>
          <span className="sm:hidden">Leave</span>
        </button>
        <button onClick={() => router.push('/ticket-centre')} className="btn-ghost text-xs gap-1.5 border border-slate-200 dark:border-slate-700 min-h-[40px] px-3">
          <AlertCircle size={14} />
          <span className="hidden sm:inline">{t('raiseTicket')}</span>
          <span className="sm:hidden">Ticket</span>
        </button>

        {/* Search */}
        <div className="relative">
          <button
            onClick={() => setShowSearch((s) => !s)}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <Search size={16} className="text-slate-500 dark:text-slate-400" />
          </button>
          {showSearch && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
                <Search size={14} className="text-slate-400 flex-shrink-0" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Jump to a page…"
                  className="flex-1 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200"
                />
                <button onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
                  <X size={14} className="text-slate-400" />
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {searchResults.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-400 text-center">No matching page</p>
                ) : (
                  searchResults.map((r) => (
                    <button
                      key={r.href}
                      onClick={() => { router.push(r.href); setShowSearch(false); setSearchQuery(''); }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      {r.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Notifications */}
        <button onClick={() => router.push('/notifications')} className="relative min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <Bell size={16} className="text-slate-500 dark:text-slate-400" />
        </button>
      </div>
    </div>
  );
}