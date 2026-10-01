// Service worker: shows alert notifications from the server and opens the app when one is tapped.
// No caching: the app updates itself through version.json.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'ليان', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'ليان';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    requireInteraction: Boolean(d.sticky),
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    lang: 'ar', dir: 'rtl',
    data: { url: d.url || './#/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#/', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.navigate?.(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});
