'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getNotificationVisual, notificationRoute } from '@/lib/notificationConfig';

interface IncomingNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  related_type?: string | null;
}

const POPUP_MS = 7000;
const MAX_VISIBLE = 3;

function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close().catch(() => {}), 700);
  } catch {
    // Browsers block audio until the user has interacted with the page — fine to skip silently.
  }
}

/**
 * Mounted once in AppLayout, so it works on EVERY page (previously the popup
 * only existed inside the Notifications page, meaning it only ever appeared
 * if that page happened to be open).
 *
 * When a notification row is inserted for the current user:
 *  - tab visible  → in-app popup card (+ chime, + vibration on phones)
 *  - tab hidden   → system notification via the service worker
 * Clicking either opens the page the notification is about.
 */
export default function NotificationListener() {
  const { effectiveUserId } = useAuth();
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [items, setItems] = useState<IncomingNotification[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const openNotification = useCallback(
    (n: IncomingNotification) => {
      supabase.from('notifications').update({ is_read: true }).eq('id', n.id).then(() => {});
      dismiss(n.id);
      router.push(notificationRoute(n.related_type));
    },
    [supabase, dismiss, router]
  );

  useEffect(() => {
    if (!effectiveUserId) return;

    const channel = supabase
      .channel(`notification-listener-${effectiveUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${effectiveUserId}` },
        (payload) => {
          const n = payload.new as IncomingNotification;
          const route = notificationRoute(n.related_type);

          // Tab in the background → system notification (works with the app minimised).
          if (
            document.visibilityState === 'hidden' &&
            'Notification' in window &&
            Notification.permission === 'granted' &&
            'serviceWorker' in navigator
          ) {
            navigator.serviceWorker.ready
              .then((reg) =>
                reg.showNotification(n.title, {
                  body: n.message,
                  icon: '/assets/images/DGaj_Logo_Black-1776504240302.png',
                  badge: '/assets/images/app_logo.png',
                  tag: n.id,
                  data: { url: route, type: n.type },
                })
              )
              .catch(() => {});
            return;
          }

          // Tab visible → in-app popup.
          setItems((prev) => [n, ...prev.filter((p) => p.id !== n.id)].slice(0, MAX_VISIBLE));
          timers.current[n.id] = setTimeout(() => dismiss(n.id), POPUP_MS);
          playChime();
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate([120, 60, 120]); } catch { /* not supported */ }
          }
        }
      )
      .subscribe();

    const currentTimers = timers.current;
    return () => {
      supabase.removeChannel(channel);
      Object.values(currentTimers).forEach(clearTimeout);
    };
  }, [effectiveUserId, supabase, dismiss]);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 z-[9999] flex flex-col gap-2 pointer-events-none">
      {items.map((n) => {
        const visual = getNotificationVisual(n.type);
        const Icon = visual.icon;
        return (
          <div
            key={n.id}
            role="alert"
            onClick={() => openNotification(n)}
            className="pointer-events-auto cursor-pointer flex items-start gap-3 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl hover:shadow-2xl transition-shadow"
          >
            <div className={`w-9 h-9 rounded-xl ${visual.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={16} className={visual.color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{n.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">{n.message}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}