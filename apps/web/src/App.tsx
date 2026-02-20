import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RequestStatus } from '@renrakun/shared'
import {
  ApiClientError,
  ackRequest,
  completeRequest,
  createCustomItem,
  createCustomTab,
  createGroup,
  fetchCatalog,
  fetchInbox,
  fetchLayout,
  fetchQuotaStatus,
  joinGroup,
  sendRequest,
  subscribePush,
  type InboxEvent,
  type LayoutResponse
} from './api'
import { clearSession, getOrCreateDeviceId, readSession, writeSession, type AppSession } from './session'

const PRESET_NAMES = ['お母さん', 'お父さん', 'パートナー']
const DEFAULT_STATUS = 'タブを選んで、必要なものをポチポチ追加してください。'

type JoinMode = 'create' | 'join'

function toServerKey(base64Url: string): Uint8Array {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function formatStatus(status: RequestStatus): string {
  if (status === 'requested') return '依頼中'
  if (status === 'acknowledged') return '対応中'
  return '購入完了'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function isQuotaError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && error.code === 'SERVICE_PAUSED_DAILY_QUOTA'
}

export default function App() {
  const [deviceId] = useState(() => getOrCreateDeviceId())
  const [session, setSession] = useState<AppSession | null>(() => readSession())
  const [catalog, setCatalog] = useState<LayoutResponse | null>(null)
  const [layout, setLayout] = useState<LayoutResponse | null>(null)
  const [inbox, setInbox] = useState<InboxEvent[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const [selectedStoreId, setSelectedStoreId] = useState<string | undefined>(undefined)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [joinMode, setJoinMode] = useState<JoinMode>('create')
  const [displayName, setDisplayName] = useState(PRESET_NAMES[0])
  const [passphrase, setPassphrase] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [customTabName, setCustomTabName] = useState('')
  const [customItemName, setCustomItemName] = useState('')
  const [customItemTabId, setCustomItemTabId] = useState('')
  const [statusText, setStatusText] = useState(DEFAULT_STATUS)
  const [errorText, setErrorText] = useState('')
  const [quotaResumeAt, setQuotaResumeAt] = useState<string | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )
  const [isLoading, setIsLoading] = useState(false)

  const auth = useMemo(
    () => (session ? { deviceId, memberId: session.memberId } : null),
    [deviceId, session]
  )

  const loadPublicCatalog = useCallback(async () => {
    try {
      const data = await fetchCatalog()
      setCatalog(data)
    } catch {
      // Catalog preview is optional on onboarding.
    }
  }, [])

  const loadPrivateData = useCallback(async () => {
    if (!session || !auth) return
    setIsLoading(true)
    setErrorText('')
    try {
      const [layoutData, inboxData] = await Promise.all([
        fetchLayout(session.groupId, auth),
        fetchInbox(session.groupId, auth)
      ])
      setLayout(layoutData)
      setInbox(inboxData)
      setActiveTabId((current) => current || layoutData.tabs[0]?.id || '')
      if (!customItemTabId && layoutData.tabs[0]?.id) {
        setCustomItemTabId(layoutData.tabs[0].id)
      }
    } catch (error) {
      if (isQuotaError(error)) {
        setQuotaResumeAt(error.resumeAt ?? null)
      } else if (error instanceof ApiClientError && error.status === 401) {
        setErrorText('セッションが無効になりました。グループに入り直してください。')
        setSession(null)
        clearSession()
      } else {
        setErrorText('データ読み込みに失敗しました。')
      }
    } finally {
      setIsLoading(false)
    }
  }, [auth, customItemTabId, session])

  const refreshQuota = useCallback(async () => {
    try {
      const quota = await fetchQuotaStatus()
      if (quota.state === 'paused') {
        setQuotaResumeAt(quota.resumeAt)
      } else {
        setQuotaResumeAt(null)
      }
    } catch {
      // Non-critical.
    }
  }, [])

  useEffect(() => {
    void loadPublicCatalog()
    void refreshQuota()
  }, [loadPublicCatalog, refreshQuota])

  useEffect(() => {
    if (!session) return
    void loadPrivateData()
  }, [loadPrivateData, session])

  const itemsByTab = useMemo(() => {
    const source = layout ?? catalog
    const map = new Map<string, Array<{ id: string; name: string; isSystem: boolean }>>()
    if (!source) return map
    for (const item of source.items) {
      const bucket = map.get(item.tabId) ?? []
      bucket.push({ id: item.id, name: item.name, isSystem: item.isSystem })
      map.set(item.tabId, bucket)
    }
    return map
  }, [catalog, layout])

  const storeButtons = useMemo(() => (layout ?? catalog)?.stores ?? [], [catalog, layout])
  const tabs = useMemo(() => (layout ?? catalog)?.tabs ?? [], [catalog, layout])
  const itemMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of (layout ?? catalog)?.items ?? []) {
      map.set(item.id, item.name)
    }
    return map
  }, [catalog, layout])

  const cartEntries = useMemo(() => Object.entries(cart).filter(([, qty]) => qty > 0), [cart])
  const cartCount = useMemo(() => cartEntries.reduce((sum, [, qty]) => sum + qty, 0), [cartEntries])

  const applyError = useCallback((error: unknown, fallback: string) => {
    if (isQuotaError(error)) {
      setQuotaResumeAt(error.resumeAt ?? null)
      setErrorText('無料枠の上限に達しました。翌日0:00 JSTに自動再開します。')
      return
    }
    if (error instanceof ApiClientError) {
      setErrorText(`${fallback} (${error.code})`)
      return
    }
    setErrorText(fallback)
  }, [])

  const handleCreateOrJoin = useCallback(async () => {
    if (!displayName.trim() || !passphrase.trim()) {
      setErrorText('表示名と合言葉は必須です。')
      return
    }

    setErrorText('')
    setIsLoading(true)
    try {
      if (joinMode === 'create') {
        const result = await createGroup({
          deviceId,
          displayName,
          passphrase
        })
        const nextSession: AppSession = {
          groupId: result.groupId,
          memberId: result.memberId,
          role: result.role,
          displayName,
          inviteToken: result.inviteToken
        }
        writeSession(nextSession)
        setSession(nextSession)
        setStatusText('グループを作成しました。招待トークンを共有してください。')
      } else {
        if (!inviteToken.trim()) {
          setErrorText('参加には招待トークンが必要です。')
          return
        }
        const result = await joinGroup({
          deviceId,
          displayName,
          passphrase,
          inviteToken
        })
        const nextSession: AppSession = {
          groupId: result.groupId,
          memberId: result.memberId,
          role: result.role,
          displayName
        }
        writeSession(nextSession)
        setSession(nextSession)
        setStatusText('グループに参加しました。')
      }
    } catch (error) {
      applyError(error, 'グループ操作に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [applyError, deviceId, displayName, inviteToken, joinMode, passphrase])

  const handleEnablePush = useCallback(async () => {
    if (!session || !auth) return
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') {
      setNotificationPermission('unsupported')
      return
    }

    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!publicKey) {
      setErrorText('VITE_VAPID_PUBLIC_KEY が未設定です。')
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      if (permission !== 'granted') return

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toServerKey(publicKey) as unknown as BufferSource
      })

      await subscribePush(session.groupId, session.memberId, auth, subscription)
      setStatusText('通知を有効化しました。')
    } catch (error) {
      applyError(error, '通知設定に失敗しました')
    }
  }, [applyError, auth, session])

  const handleAddToCart = useCallback((itemId: string) => {
    setCart((current) => ({
      ...current,
      [itemId]: (current[itemId] ?? 0) + 1
    }))
  }, [])

  const handleDecreaseFromCart = useCallback((itemId: string) => {
    setCart((current) => {
      const next = { ...current }
      const qty = next[itemId] ?? 0
      if (qty <= 1) {
        delete next[itemId]
      } else {
        next[itemId] = qty - 1
      }
      return next
    })
  }, [])

  const handleSendRequest = useCallback(async () => {
    if (!session || !auth) return
    if (cartEntries.length === 0) {
      setErrorText('カートが空です。')
      return
    }

    setIsLoading(true)
    setErrorText('')
    try {
      const itemIds = cartEntries.flatMap(([itemId, qty]) => new Array(qty).fill(itemId))
      const result = await sendRequest(auth, {
        groupId: session.groupId,
        senderMemberId: session.memberId,
        storeId: selectedStoreId,
        itemIds
      })
      setStatusText(result.pushMessage)
      setCart({})
      setSelectedStoreId(undefined)
      await loadPrivateData()
    } catch (error) {
      applyError(error, '依頼送信に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [applyError, auth, cartEntries, loadPrivateData, selectedStoreId, session])

  const handleAck = useCallback(
    async (requestId: string) => {
      if (!auth) return
      try {
        await ackRequest(requestId, auth)
        await loadPrivateData()
      } catch (error) {
        applyError(error, '対応中への更新に失敗しました')
      }
    },
    [applyError, auth, loadPrivateData]
  )

  const handleComplete = useCallback(
    async (requestId: string) => {
      if (!auth) return
      try {
        await completeRequest(requestId, auth)
        await loadPrivateData()
      } catch (error) {
        applyError(error, '購入完了への更新に失敗しました')
      }
    },
    [applyError, auth, loadPrivateData]
  )

  const handleCreateCustomTab = useCallback(async () => {
    if (!session || !auth || !customTabName.trim()) return
    try {
      const created = await createCustomTab(session.groupId, auth, { name: customTabName.trim() })
      setCustomTabName('')
      setStatusText(`タブ「${created.name}」を追加しました。`)
      await loadPrivateData()
      setActiveTabId(created.id)
    } catch (error) {
      applyError(error, 'カスタムタブ追加に失敗しました')
    }
  }, [applyError, auth, customTabName, loadPrivateData, session])

  const handleCreateCustomItem = useCallback(async () => {
    if (!session || !auth || !customItemName.trim() || !customItemTabId) return
    try {
      const created = await createCustomItem(session.groupId, auth, {
        tabId: customItemTabId,
        name: customItemName.trim()
      })
      setCustomItemName('')
      setStatusText(`ボタン「${created.name}」を追加しました。`)
      await loadPrivateData()
      setActiveTabId(customItemTabId)
    } catch (error) {
      applyError(error, 'カスタムボタン追加に失敗しました')
    }
  }, [applyError, auth, customItemName, customItemTabId, loadPrivateData, session])

  const handleCopyInviteToken = useCallback(async () => {
    if (!session?.inviteToken) return
    try {
      await navigator.clipboard.writeText(session.inviteToken)
      setStatusText('招待トークンをコピーしました。')
    } catch {
      setErrorText('クリップボードへコピーできませんでした。')
    }
  }, [session?.inviteToken])

  const activeItems = itemsByTab.get(activeTabId) ?? []

  if (!session) {
    return (
      <div className="app-shell onboarding-shell">
        <header className="hero">
          <p className="hero-kicker">Tap. Notify. Done.</p>
          <h1>れんらくん</h1>
          <p>家の消耗品連絡を、チャットではなく専用タッチパネルで。</p>
        </header>

        <section className="card onboarding-card">
          <div className="mode-switch">
            <button
              className={joinMode === 'create' ? 'active' : ''}
              onClick={() => setJoinMode('create')}
              type="button"
            >
              グループ作成
            </button>
            <button className={joinMode === 'join' ? 'active' : ''} onClick={() => setJoinMode('join')} type="button">
              グループ参加
            </button>
          </div>

          <label>
            表示名
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} />
          </label>
          <div className="quick-names">
            {PRESET_NAMES.map((name) => (
              <button key={name} type="button" onClick={() => setDisplayName(name)}>
                {name}
              </button>
            ))}
          </div>

          <label>
            合言葉
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="6文字以上"
              maxLength={64}
            />
          </label>

          {joinMode === 'join' && (
            <label>
              招待トークン
              <input
                value={inviteToken}
                onChange={(event) => setInviteToken(event.target.value)}
                placeholder="共有されたトークン"
                maxLength={120}
              />
            </label>
          )}

          <button className="primary-button" onClick={handleCreateOrJoin} type="button" disabled={isLoading}>
            {joinMode === 'create' ? 'グループを作る' : 'グループに参加する'}
          </button>
          {errorText && <p className="error-text">{errorText}</p>}
        </section>

        <section className="card preview-card">
          <h2>固定カタログ</h2>
          <p>通常操作は入力不要。タップだけで依頼できます。</p>
          <div className="chip-row">
            {catalog?.tabs.map((tab) => (
              <span key={tab.id} className="chip">
                {tab.name}
              </span>
            ))}
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="top-header">
        <div>
          <p className="hero-kicker">家の消耗品ダッシュボード</p>
          <h1>れんらくん</h1>
          <p className="sub-text">こんにちは、{session.displayName}さん</p>
        </div>
        <div className="header-actions">
          {notificationPermission !== 'granted' && (
            <button type="button" onClick={handleEnablePush}>
              通知を有効化
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              clearSession()
              setSession(null)
              setLayout(null)
              setInbox([])
              setCart({})
            }}
          >
            グループ退出
          </button>
        </div>
      </header>

      {quotaResumeAt && (
        <aside className="quota-banner">
          無料枠上限のため書き込み機能を一時停止中です。再開予定: {formatTime(quotaResumeAt)}（JST基準）
        </aside>
      )}

      {session.inviteToken && (
        <section className="card invite-card">
          <p>招待トークン: <code>{session.inviteToken}</code></p>
          <button type="button" onClick={handleCopyInviteToken}>
            トークンをコピー
          </button>
        </section>
      )}

      <div className="main-grid">
        <section className="card touch-card">
          <div className="tab-strip">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTabId === tab.id ? 'active' : ''}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.name}
              </button>
            ))}
          </div>

          <div className="item-grid">
            {activeItems.map((item) => (
              <button key={item.id} type="button" className="item-button" onClick={() => handleAddToCart(item.id)}>
                <span>{item.name}</span>
                <small>+1</small>
              </button>
            ))}
          </div>

          <div className="store-row">
            {storeButtons.map((store) => (
              <button
                key={store.id}
                type="button"
                className={selectedStoreId === store.id ? 'selected' : ''}
                onClick={() => setSelectedStoreId((current) => (current === store.id ? undefined : store.id))}
              >
                {store.name}
              </button>
            ))}
          </div>
        </section>

        <section className="card inbox-card">
          <div className="panel-header">
            <h2>受信箱</h2>
            <button type="button" onClick={() => void loadPrivateData()} disabled={isLoading}>
              更新
            </button>
          </div>
          <ul className="inbox-list">
            {inbox.length === 0 && <li className="empty">未対応の依頼はありません</li>}
            {inbox.map((event) => (
              <li key={event.eventId} className="inbox-item">
                <div className="inbox-top">
                  <strong>{event.senderName}</strong>
                  <span className={`status ${event.status}`}>{formatStatus(event.status)}</span>
                </div>
                <p className="inbox-message">
                  {event.senderName}さんが
                  {event.storeName ? `${event.storeName}で` : ''}
                  {event.items.map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name)).join('、')}
                  を買ってほしいと言っています
                </p>
                <div className="inbox-meta">{formatTime(event.createdAt)}</div>
                <div className="inbox-actions">
                  <button type="button" disabled={event.status !== 'requested'} onClick={() => void handleAck(event.requestId)}>
                    対応する
                  </button>
                  <button type="button" disabled={event.status === 'completed'} onClick={() => void handleComplete(event.requestId)}>
                    購入完了
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {session.role === 'admin' && (
          <section className="card admin-card">
            <h2>管理者設定</h2>
            <p>通常利用者は入力不要。ここだけ管理者がカスタム追加できます。</p>
            <div className="admin-form">
              <label>
                新しいタブ
                <input
                  value={customTabName}
                  onChange={(event) => setCustomTabName(event.target.value)}
                  placeholder="例: 洗濯室"
                  maxLength={30}
                />
              </label>
              <button type="button" onClick={() => void handleCreateCustomTab()}>
                タブ追加
              </button>
            </div>
            <div className="admin-form">
              <label>
                ボタン追加先
                <select value={customItemTabId} onChange={(event) => setCustomItemTabId(event.target.value)}>
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                新しいボタン名
                <input
                  value={customItemName}
                  onChange={(event) => setCustomItemName(event.target.value)}
                  placeholder="例: 食洗機用洗剤"
                  maxLength={30}
                />
              </label>
              <button type="button" onClick={() => void handleCreateCustomItem()}>
                ボタン追加
              </button>
            </div>
          </section>
        )}
      </div>

      <footer className="cart-bar">
        <div className="cart-header">
          <h3>カート ({cartCount})</h3>
          <p>{statusText}</p>
        </div>
        <div className="cart-items">
          {cartEntries.length === 0 && <span className="empty">アイテムがありません</span>}
          {cartEntries.map(([itemId, qty]) => (
            <button key={itemId} type="button" className="cart-pill" onClick={() => handleDecreaseFromCart(itemId)}>
              {itemMap.get(itemId) ?? itemId} x{qty}
            </button>
          ))}
        </div>
        <button className="primary-button" onClick={() => void handleSendRequest()} disabled={cartEntries.length === 0 || isLoading}>
          依頼を送信する
        </button>
      </footer>

      {errorText && <p className="error-text floating">{errorText}</p>}
    </div>
  )
}
