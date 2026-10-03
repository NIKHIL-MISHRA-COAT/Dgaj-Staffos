'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Check, Trash2, BellOff, BellRing, Smartphone } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRouter } from 'next/navigation';
import { getNotificationVisual, notificationRoute } from '@/lib/notificationConfig';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  related_id: string | null;
  related_type: string;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  const { user, effectiveUserId } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const { t } = useLanguage();

  const fetchNotifications = useCallback(async () => {
    const uid = effectiveUserId;
    if (!uid) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) setNotifications(data || []);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Check push permission state
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushEnabled(Notification.permission === 'granted');
    }
  }, []);

  // Real-time subscription — keeps this list live (popups are handled by NotificationListener)
  useEffect(() => {
    const uid = effectiveUserId;
    if (!uid) return;
    const channel = supabase
      .channel('notifications-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${uid}`,
      }, (payload) => {
        const n = payload.new as Notification;
        setNotifications((prev) => [n, ...prev]);
        // Popups + system notifications are handled globally by NotificationListener.
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [effectiveUserId]);

  const requestPushPermission = async () => {
    if (!('Notification' in window)) {
      toast.error('Push notifications are not supported in this browser');
      return;
    }
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setPushEnabled(true);
        toast.success('Push notifications enabled! You\'ll receive alerts on this device.');
      } else {
        toast.error('Push notifications blocked. Please enable them in your browser settings.');
      }
    } catch {
      toast.error('Failed to enable push notifications');
    } finally {
      setPushLoading(false);
    }
  };

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    const uid = effectiveUserId;
    if (!uid) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', uid).eq('is_read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    toast.success('All notifications marked as read');
  };

  const deleteNotification = async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            {t('notificationsTitle')}
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5">{unreadCount}</span>
            )}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('allAppAlerts')}</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-600 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-xl transition-colors border border-blue-200 dark:border-blue-800">
            <Check size={15} /> {t('markAllRead')}
          </button>
        )}
      </div>

      {/* Push Notification Banner */}
      {!pushEnabled && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
            <Smartphone size={18} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('enablePushNotifications')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('pushNotificationsDesc')}</p>
          </div>
          <button onClick={requestPushPermission} disabled={pushLoading}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-60 flex-shrink-0">
            {pushLoading ? <Loader2 size={12} className="animate-spin" /> : <BellRing size={12} />}
            {t('enable')}
          </button>
        </div>
      )}
      {pushEnabled && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 mb-5 flex items-center gap-2">
          <BellRing size={14} className="text-emerald-600 flex-shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">{t('pushNotificationsActive')}</p>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-colors capitalize ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
            {f === 'all' ? `${t('allNotifications')} (${notifications.length})` : `${t('unread')} (${unreadCount})`}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <BellOff size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-semibold">{filter === 'unread' ? t('noUnreadNotifications') : t('noNotificationsYet')}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {filtered.map((n) => {
              const cfg = getNotificationVisual(n.type);
              const NIcon = cfg.icon;
              return (
                <div key={n.id} onClick={() => { if (!n.is_read) markRead(n.id); const target = notificationRoute(n.related_type); if (target !== '/notifications') router.push(target); }}
                  className={`flex items-start gap-3 p-4 transition-colors cursor-pointer group ${!n.is_read ? 'bg-blue-50/40 dark:bg-blue-900/20 hover:bg-blue-50/70 dark:hover:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                  <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <NIcon size={16} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className={`text-sm font-semibold ${n.is_read ? 'text-slate-700 dark:text-slate-300' : 'text-slate-900 dark:text-slate-100'}`}>{n.title}</p>
                      {!n.is_read && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{n.message}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all flex-shrink-0">
                    <Trash2 size={13} className="text-slate-400 hover:text-red-500" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}