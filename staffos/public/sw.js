// Cache version — updated on every deploy via build timestamp injected at build time
// Fallback: use a timestamp so old installs always get a fresh cache
const CACHE_NAME = 'dgaj-connect-' + (self.__BUILD_ID__ || Date.now());

// Minimal offline shell assets only — NOT page HTML (those must always be fresh)
const STATIC_ASSETS = [
  '/manifest.json',
  '/favicon.ico',
  '/assets/images/app_logo.png',
  '/assets/images/DGaj_Logo_Black-1776504240302.png',
  '/assets/images/no_image.png',
];




// Install: cache only static shell assets, skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  // Take over immediately — don't wait for old SW to die
  self.skipWaiting();
});

// Activate: delete ALL old caches, claim all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Notify all open tabs that a new version is active — they will reload
      return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
      });
    })
  );
  self.clients.claim();
});

// Fetch strategy:
//   - Supabase / API calls  → network only (never cache live data)
//   - Next.js JS/CSS chunks → network first, cache as fallback
//   - Navigation (HTML)     → network first, NO cache storage (always fresh)
//   - Static images/fonts   → cache first with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip HMR / webpack dev sockets
  if (
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.startsWith('/_next/static/webpack')
  ) {
    return;
  }

  // Supabase & internal API — network only, never cache
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/api/')
  ) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'You are offline. Please reconnect.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // Next.js JS/CSS chunks — network first, stale cache as offline fallback only
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Navigation requests (page HTML) — network first, NO caching of HTML
  // This ensures the latest page shell is always fetched from the server
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        // Offline fallback: serve cached shell or root
        return caches.match('/') || caches.match('/employee-dashboard');
      })
    );
    return;
  }

  // Everything else (images, fonts, icons) — cache first with network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

// Push notification handler — with vibration and sound support
self.addEventListener('push', (event) => {
  let data = {
    title: 'DGaj Connect',
    body: 'You have a new notification',
    url: '/notifications',
    type: 'general',
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  // Vibration patterns by notification type
  const vibrationPatterns = {
    task_assigned: [200, 100, 200, 100, 400],
    task_updated: [200, 100, 200],
    leave_approved: [300, 100, 300],
    leave_rejected: [500, 100, 100, 100, 100],
    leave_applied: [200, 100, 200],
    approval_pending: [400, 200, 400],
    approval_reminder: [300, 150, 300, 150, 300],
    general: [200, 100, 200],
  };

  const vibrate = vibrationPatterns[data.type] || vibrationPatterns.general;

  // Notification actions based on type
  const actions = [];
  if (data.type === 'task_assigned' || data.type === 'task_updated') {
    actions.push({ action: 'view', title: '📋 View Task' });
  } else if (data.type === 'leave_applied') {
    actions.push({ action: 'view', title: '✅ Review' });
  } else {
    actions.push({ action: 'view', title: '👁 View' });
  }
  actions.push({ action: 'dismiss', title: '✕ Dismiss' });

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/images/DGaj_Logo_Black-1776504240302.png',
      badge: '/assets/images/app_logo.png',
      tag: `dgaj-${data.type}-${Date.now()}`,
      data: { url: data.url || '/notifications', type: data.type },
      requireInteraction: data.type === 'approval_pending' || data.type === 'approval_reminder',
      vibrate: vibrate,
      silent: false,
      actions: actions,
      // Sound is controlled by the OS — we set silent:false to allow it
    })
  );
});

// Notification click — open the app and navigate to the relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/notifications';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
