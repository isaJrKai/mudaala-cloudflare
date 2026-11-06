/* Mudaala Web Push service worker. Keep this file dependency-free. */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Mudaala', body: 'You have a new shop update.' }
  }

  const title = payload.title || 'Mudaala'
  const options = {
    body: payload.body || 'There is something useful to do in your shop.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || payload.notificationId || 'mudaala-growth',
    renotify: false,
    requireInteraction: payload.priority === 'HIGH',
    data: {
      url: payload.url || '/#/home',
      notificationId: payload.notificationId || null,
    },
    actions: [
      { action: 'open', title: payload.actionLabel || 'Open Mudaala' },
      { action: 'snooze', title: 'Remind me in 30 min' },
    ],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}

  if (event.action === 'snooze' && data.notificationId) {
    event.waitUntil(fetch('/api/notifications/' + encodeURIComponent(data.notificationId) + '/lifecycle', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snooze', minutes: 30 }),
    }).catch(() => undefined))
    return
  }

  const target = new URL(data.url || '/#/home', self.location.origin)
  if (target.origin !== self.location.origin) return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('focus' in client) {
        client.navigate(target.href)
        return client.focus()
      }
    }
    return self.clients.openWindow(target.href)
  }))
})
