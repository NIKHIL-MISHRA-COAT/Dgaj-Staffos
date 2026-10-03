'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getNotificationVisual, notificationRoute } from '@/lib/notificationConfig';



interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  related_type?: string | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationBell() {
  const { user, pinSession, effectiveUserId } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, message, is_read, created_at, related_type')
      .eq('user_id', effectiveUserId)
      .order('created_at', { ascending: false })
      .limit(20);
    setNotifications(data || []);
  }, [effectiveUserId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!effectiveUserId) return;
    const channel = supabase
      .channel('bell-notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${effectiveUserId}`,
      }, (payload) => {
        setNotifications((prev) => [payload.new as Notification, ...prev.slice(0, 19)]);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${effectiveUserId}`,
      }, () => {
        fetchNotifications();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [effectiveUserId, fetchNotifications]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!effectiveUserId) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', effectiveUserId).eq('is_read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl hover:bg-slate-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} className="text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1">
                <Check size={11} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <Bell size={28} className="mb-2 opacity-30" />
                <p className="text-xs font-semibold">No notifications</p>
              </div>
            ) : (
              notifications.map((n) => {
                const cfg = getNotificationVisual(n.type);
                const NIcon = cfg.icon;
                return (
                  <div
                    key={n.id}
                    onClick={() => { if (!n.is_read) markRead(n.id); setOpen(false); router.push(notificationRoute(n.related_type)); }}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${!n.is_read ? 'bg-blue-50/50 dark:bg-blue-900/20 hover:bg-blue-50 dark:hover:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                  >
                    <div className={`w-8 h-8 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <NIcon size={14} className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={`text-xs font-semibold truncate ${n.is_read ? 'text-slate-700 dark:text-slate-300' : 'text-slate-900 dark:text-slate-100'}`}>{n.title}</p>
                        {!n.is_read && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-xs font-semibold text-blue-600 hover:underline"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}