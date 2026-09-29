'use client';

import React, { useEffect, useState } from 'react';
import { Activity, Bell, CheckSquare, CalendarDays, AlertCircle, Wallet, Ticket } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';



interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const typeIconMap: Record<string, React.ElementType> = {
  leave_applied: CalendarDays,
  leave_approved: CalendarDays,
  leave_rejected: CalendarDays,
  leave_cancelled: CalendarDays,
  task_assigned: CheckSquare,
  task_updated: CheckSquare,
  ticket_created: Ticket,
  ticket_updated: Ticket,
  expense_submitted: Wallet,
  expense_approved: Wallet,
  expense_rejected: Wallet,
  general: Bell,
  approval_reminder: AlertCircle,
  approval_pending: AlertCircle,
};

const typeColorMap: Record<string, string> = {
  leave_applied: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600',
  leave_approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600',
  leave_rejected: 'bg-red-100 dark:bg-red-900/30 text-red-600',
  task_assigned: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600',
  task_updated: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600',
  ticket_created: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600',
  ticket_updated: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600',
  expense_submitted: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600',
  expense_approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600',
  expense_rejected: 'bg-red-100 dark:bg-red-900/30 text-red-600',
  general: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
  approval_reminder: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600',
  approval_pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ActivityFeed() {
  const { t } = useLanguage();
  const { user, pinSession } = useAuth();
  const supabase = createClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const getEffectiveUserId = (): string | null => {
    if (user?.id) return user.id;
    if (pinSession?.userId) return pinSession.userId;
    try {
      const stored = localStorage.getItem('dgaj_pin_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed?.userId || null;
      }
    } catch {}
    return null;
  };

  useEffect(() => {
    const uid = getEffectiveUserId();
    if (!uid) {
      setLoading(false);
      return;
    }
    fetchActivity(uid);
  }, [user?.id, pinSession?.userId]);

  const fetchActivity = async (uid: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, message, is_read, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(8);

      if (!error && data) {
        setNotifications(data);
      } else if (error) {
        console.error('Activity feed fetch error:', error);
      }
    } catch (err) {
      console.error('Activity feed fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">Recent Activity</h3>
        <Link href="/notifications">
          <button className="text-xs text-blue-600 font-600 hover:underline">View All</button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
              <div className="flex-1">
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-1.5" />
                <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="py-8 text-center">
          <Activity size={28} className="text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No recent activity</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Activity will appear here as you use the app</p>
        </div>
      ) : (
        <div className="space-y-1 divide-y divide-slate-50 dark:divide-slate-700">
          {notifications.map((notif) => {
            const NotifIcon = typeIconMap[notif.type] || Bell;
            const colorClass = typeColorMap[notif.type] || typeColorMap.general;
            return (
              <div
                key={notif.id}
                className={`flex items-start gap-3 py-2.5 ${!notif.is_read ? 'opacity-100' : 'opacity-70'}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                  <NotifIcon size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-600 text-slate-900 dark:text-slate-100 leading-tight ${!notif.is_read ? '' : 'font-500'}`}>
                    {notif.title}
                  </p>
                  {notif.message && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{notif.message}</p>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0 mt-0.5">
                  {timeAgo(notif.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
