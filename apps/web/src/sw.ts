/// <reference lib="WebWorker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import type { PushPendingNotification } from '@renrakun/shared'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string }>
}

type Language = 'ja' | 'en'

interface PushContext {
  apiBase: string
  groupId: string
  memberId: string
  deviceId: string
  language: Language
}

type PushContextMessage =
  | {
      type: 'SYNC_PUSH_CONTEXT'
      payload: PushContext
    }
  | {
      type: 'CLEAR_PUSH_CONTEXT'
    }

interface PushPayloadMessage {
  title?: string
  body?: string
}

const SW_DB_NAME = 'renrakun-sw'
const SW_DB_VERSION = 1
const SW_STORE_NAME = 'kv'
const SW_PUSH_CONTEXT_KEY = 'push-context'
const PENDING_FETCH_LIMIT = 5

const FALLBACK_TEXT: Record<Language, { title: string; body: string }> = {
  ja: {
    title: 'れんらくん',
    body: '新しい依頼があります。'
  },
  en: {
    title: 'renrakun',
    body: 'You have a new request.'
  }
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  event.waitUntil(handleContextMessage(event))
})

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const url = String(event.notification.data?.url ?? '/?inbox=1')
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        const windowClient = client as WindowClient
        await windowClient.navigate(url)
        await windowClient.focus()
        return
      }
      await self.clients.openWindow(url)
    })()
  )
})

async function handleContextMessage(event: ExtendableMessageEvent): Promise<void> {
  const message = event.data as PushContextMessage | undefined
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return
  }

  if (message.type === 'CLEAR_PUSH_CONTEXT') {
    await clearPushContext()
    console.info('[sw] push context cleared')
    return
  }

  if (message.type !== 'SYNC_PUSH_CONTEXT') return

  const payload = message.payload
  if (!isValidPushContext(payload)) {
    console.warn('[sw] invalid push context payload')
    return
  }

  await savePushContext(payload)
  console.info('[sw] push context synced')
}

async function handlePush(event: PushEvent): Promise<void> {
  const context = await readPushContext()
  const payloadMessage = readPayloadMessage(event.data)

  if (!context) {
    await showFallbackNotification('ja', payloadMessage)
    await notifyClientsRefresh('push')
    console.warn('[sw] push context missing, used fallback notification')
    return
  }

  try {
    const notifications = await fetchPendingNotifications(context)

    if (notifications.length === 0) {
      await showFallbackNotification(context.language, payloadMessage)
      await notifyClientsRefresh('push')
      console.info('[sw] no pending notifications, used fallback notification')
      return
    }

    await Promise.all(
      notifications.map((notification) =>
        self.registration.showNotification(
          buildTitle(notification, context.language),
          {
            body: buildBody(notification, context.language),
            icon: '/icon.svg',
            badge: '/icon.svg',
            tag: `renrakun-${notification.id}`,
            data: {
              requestId: notification.requestId,
              kind: notification.kind,
              url: '/?inbox=1'
            }
          }
        )
      )
    )

    await notifyClientsRefresh('push')
    console.info('[sw] notifications shown', { count: notifications.length })
  } catch (error) {
    console.error('[sw] pending fetch failed', error)
    await showFallbackNotification(context.language, payloadMessage)
    await notifyClientsRefresh('push')
  }
}

async function notifyClientsRefresh(reason: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  clients.forEach((client) => {
    ;(client as WindowClient).postMessage({ type: 'REFRESH_DATA', reason })
  })
}

async function fetchPendingNotifications(context: PushContext): Promise<PushPendingNotification[]> {
  const url = `${context.apiBase}/api/push/pending?groupId=${encodeURIComponent(context.groupId)}&limit=${PENDING_FETCH_LIMIT}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-device-id': context.deviceId,
      'x-member-id': context.memberId,
      'x-app-lang': context.language
    }
  })

  if (!response.ok) {
    throw new Error(`pending fetch failed: ${response.status}`)
  }

  const payload = (await response.json()) as PushPendingNotification[]
  return Array.isArray(payload) ? payload : []
}

function buildTitle(notification: PushPendingNotification, language: Language): string {
  const isVisit = notification.intent === 'visit'

  if (language === 'ja') {
    if (notification.kind === 'acknowledged') {
      return `${notification.senderName}さんが依頼を対応中にしました`
    }
    if (notification.kind === 'completed') {
      return `${notification.senderName}さんが依頼を完了にしました`
    }
    return isVisit
      ? `${notification.senderName}さんが「行きたい」依頼を送りました`
      : `${notification.senderName}さんから依頼が届きました`
  }

  if (notification.kind === 'acknowledged') {
    return `${notification.senderName} marked your request as In progress`
  }
  if (notification.kind === 'completed') {
    return `${notification.senderName} marked your request as Completed`
  }
  return isVisit
    ? `${notification.senderName} sent a visit request`
    : `${notification.senderName} sent a request`
}
function buildBody(notification: PushPendingNotification, language: Language): string {
  const summary = notification.itemsSummary?.trim()
  if (summary) return summary
  if (language === 'ja') {
    return notification.intent === 'visit'
      ? 'アプリで行きたい依頼を確認してください。'
      : 'アプリで依頼内容を確認してください。'
  }
  return notification.intent === 'visit'
    ? 'Open the app to check visit request details.'
    : 'Open the app to check request details.'
}
function readPayloadMessage(data: PushMessageData | null): PushPayloadMessage | null {
  if (!data) return null
  try {
    const parsed = data.json() as PushPayloadMessage
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    const text = data.text()
    if (!text) return null
    return { body: text }
  }
}

async function showFallbackNotification(language: Language, payloadMessage: PushPayloadMessage | null): Promise<void> {
  const fallback = FALLBACK_TEXT[language]
  const title = payloadMessage?.title || fallback.title
  const body = payloadMessage?.body || fallback.body

  await self.registration.showNotification(title, {
    body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'renrakun-fallback',
    data: { url: '/?inbox=1' }
  })
}

function isValidPushContext(value: unknown): value is PushContext {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PushContext>
  if (!candidate.apiBase || !candidate.groupId || !candidate.memberId || !candidate.deviceId) {
    return false
  }
  return candidate.language === 'ja' || candidate.language === 'en'
}

function openSwDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SW_DB_NAME, SW_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SW_STORE_NAME)) {
        db.createObjectStore(SW_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('failed to open service worker db'))
  })
}

function toRequestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'))
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb transaction aborted'))
  })
}

async function savePushContext(context: PushContext): Promise<void> {
  const db = await openSwDb()
  try {
    const tx = db.transaction(SW_STORE_NAME, 'readwrite')
    const store = tx.objectStore(SW_STORE_NAME)
    await toRequestPromise(store.put(context, SW_PUSH_CONTEXT_KEY))
    await waitForTransaction(tx)
  } finally {
    db.close()
  }
}

async function readPushContext(): Promise<PushContext | null> {
  const db = await openSwDb()
  try {
    const tx = db.transaction(SW_STORE_NAME, 'readonly')
    const store = tx.objectStore(SW_STORE_NAME)
    const value = await toRequestPromise(store.get(SW_PUSH_CONTEXT_KEY))
    return isValidPushContext(value) ? value : null
  } finally {
    db.close()
  }
}

async function clearPushContext(): Promise<void> {
  const db = await openSwDb()
  try {
    const tx = db.transaction(SW_STORE_NAME, 'readwrite')
    const store = tx.objectStore(SW_STORE_NAME)
    await toRequestPromise(store.delete(SW_PUSH_CONTEXT_KEY))
    await waitForTransaction(tx)
  } finally {
    db.close()
  }
}

export {}
