/// <reference lib="WebWorker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('push', (event) => {
  let title = 'れんらくん'
  let body = '新しい買い物依頼があります。'

  if (event.data) {
    try {
      const payload = event.data.json() as { title?: string; body?: string }
      title = payload.title ?? title
      body = payload.body ?? body
    } catch {
      body = event.data.text() || body
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'renrakun-request'
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (clients.length > 0) {
        const focused = clients[0]
        await focused.focus()
        return
      }
      await self.clients.openWindow('/')
    })()
  )
})

export {}
