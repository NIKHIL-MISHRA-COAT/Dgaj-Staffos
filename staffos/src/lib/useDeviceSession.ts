'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

const DEVICE_ID_KEY = 'dgaj_device_id';
const HEARTBEAT_MS = 3 * 60 * 1000; // 3 min — comfortably under the 10-min stale cutoff

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function describeDevice(): { label: string; platform: 'mobile' | 'tablet' | 'desktop' } {
  if (typeof navigator === 'undefined') return { label: 'Unknown device', platform: 'desktop' };
  const ua = navigator.userAgent;

  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';

  const isTablet = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua));
  const isMobile = !isTablet && /iPhone|Android|Mobile/.test(ua);
  const platform: 'mobile' | 'tablet' | 'desktop' = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';

  return { label: `${browser} on ${os}`, platform };
}

/**
 * Registers this browser tab as a distinct device session for the current
 * user, and keeps it alive with a periodic heartbeat. Lets directors see
 * "same employee, 2 devices" (e.g. phone + laptop) instead of one row.
 */
export function useDeviceSession(userId: string | null | undefined, firmId?: string | null) {
  const supabase = createClient();

  useEffect(() => {
    if (!userId) return;

    const deviceId = getOrCreateDeviceId();
    const { label, platform } = describeDevice();

    const upsertSession = async () => {
      await supabase.from('user_device_sessions').upsert(
        {
          user_id: userId,
          device_id: deviceId,
          device_label: label,
          platform,
          firm_id: firmId || null,
          last_seen: new Date().toISOString(),
          is_active: true,
        },
        { onConflict: 'user_id,device_id' }
      );
    };

    upsertSession();
    const interval = setInterval(upsertSession, HEARTBEAT_MS);

    // Refresh immediately when the tab becomes visible again (e.g. after
    // being backgrounded past the heartbeat interval on mobile).
    const onVisible = () => { if (document.visibilityState === 'visible') upsertSession(); };
    document.addEventListener('visibilitychange', onVisible);

    // Best-effort: mark inactive on a clean tab close.
    const onUnload = () => {
      const payload = JSON.stringify({ user_id: userId, device_id: deviceId });
      navigator.sendBeacon?.(
        '/api/device-session-end',
        new Blob([payload], { type: 'application/json' })
      );
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [userId, firmId]);
}
