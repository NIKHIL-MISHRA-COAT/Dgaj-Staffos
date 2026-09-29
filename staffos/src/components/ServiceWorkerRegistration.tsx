'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// VAPID public key — must match the private key used in the send-push-notification edge function
// Generate with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function ServiceWorkerRegistration() {
  const { user, pinSession } = useAuth();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker?.register('/sw.js', {
          // Always re-fetch the SW file — never serve it from HTTP cache
          updateViaCache: 'none',
        });

        // Check for updates every 60 seconds while the app is open
        const intervalId = setInterval(() => {
          registration?.update()?.catch(() => {});
        }, 60_000);

        // When a new SW is waiting, force-reload all clients to apply the update
        const handleStateChange = () => {
          if (registration?.waiting) {
            // Tell the waiting SW to skip waiting and activate immediately
            registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
          }
        };

        registration?.addEventListener('updatefound', () => {
          const newWorker = registration?.installing;
          if (!newWorker) return;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker?.state === 'installed' && navigator.serviceWorker?.controller) {
              // New version installed — activate it immediately
              newWorker?.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // When the SW sends SW_UPDATED (after activate), reload the page
        navigator.serviceWorker?.addEventListener('message', (event) => {
          if (event?.data?.type === 'SW_UPDATED') {
            window.location?.reload();
          }
        });

        // Cleanup interval on unmount
        return () => clearInterval(intervalId);
      } catch {
        // Registration failed silently
      }
    };

    // Register after page load to not block initial render
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW, { once: true });
    }
  }, []);

  // Subscribe to push notifications once user is authenticated
  useEffect(() => {
    const userId = user?.id || pinSession?.userId;
    if (!userId) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!VAPID_PUBLIC_KEY) return;

    const subscribeToPush = async () => {
      try {
        // Request permission if not yet granted
        let permission = Notification.permission;
        if (permission === 'denied') return;
        
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        
        if (permission !== 'granted') return;

        const registration = await navigator.serviceWorker.ready;

        // Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        if (!subscription) return;

        // Save subscription to database
        const subJson = subscription.toJSON();
        const response = await fetch('/api/push-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: subJson.endpoint,
              keys: {
                p256dh: subJson.keys?.p256dh,
                auth: subJson.keys?.auth,
              },
            },
            userId,
          }),
        });
        
        if (!response.ok) {
          console.warn('Push subscription save failed:', await response.text());
        }
      } catch (err) {
        console.warn('Push subscription failed:', err);
      }
    };

    // Wait for SW to be ready then subscribe
    navigator.serviceWorker.ready.then(() => {
      subscribeToPush();
    });
  }, [user?.id, pinSession?.userId]);

  return null;
}
