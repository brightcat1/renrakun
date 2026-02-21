import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RequestStatus } from '@renrakun/shared'
import {
  API_BASE_URL,
  ApiClientError,
  ackRequest,
  completeRequest,
  createCustomItem,
  createCustomTab,
  deleteCustomItem,
  deleteCustomTab,
  createGroup,
  fetchCatalog,
  fetchInbox,
  fetchLayout,
  fetchQuotaStatus,
  joinGroup,
  setApiLanguage,
  sendRequest,
  subscribePush,
  type CatalogItem,
  type CatalogTab,
  type InboxEvent,
  type LayoutResponse
} from './api'
import { clearSession, getOrCreateDeviceId, readSession, writeSession, type AppSession } from './session'

type JoinMode = 'create' | 'join'
type Language = 'ja' | 'en'
type DeleteTargetKind = 'tab' | 'item'
type InboxFilter = 'open' | 'all'
type SwPushContextMessage =
  | {
      type: 'SYNC_PUSH_CONTEXT'
      payload: {
        apiBase: string
        groupId: string
        memberId: string
        deviceId: string
        language: Language
      }
    }
  | { type: 'CLEAR_PUSH_CONTEXT' }

interface DeleteTarget {
  kind: DeleteTargetKind
  id: string
  name: string
}

interface Messages {
  locale: string
  appTitle: string
  heroKicker: string
  onboardingLead: string
  createMode: string
  joinMode: string
  displayName: string
  defaultDisplayName: string
  passphrase: string
  passphrasePlaceholder: string
  passphraseHint: string
  inviteToken: string
  inviteTokenPlaceholder: string
  inviteEntryTitle: string
  inviteEntryLead: string
  switchToManualJoin: string
  createAction: string
  joinAction: string
  fixedCatalog: string
  fixedCatalogLead: string
  dashboardTitle: string
  hello: (name: string) => string
  enableNotifications: string
  resyncNotifications?: string
  leaveGroup: string
  quotaPaused: (resumeAt: string) => string
  retentionBannerTitle: string
  retentionBannerSummary: string
  retentionBannerDetailsTitle: string
  retentionBannerDetailsPoints: string[]
  inviteLinkLabel: string
  copyInviteLink: string
  membersTitle?: string
  membersCount?: (count: number) => string
  memberCreatorBadge?: string
  memberPushReady?: string
  memberPushNotReady?: string
  memberYouSuffix?: string
  memberResyncHint?: string
  touchLoading: string
  touchEmpty: string
  inboxTitle: string
  inboxFilterOpen: string
  inboxFilterAll: string
  refresh: string
  inboxEmpty: string
  selfLabel: string
  requestOwnSuffix: string
  requestOtherSuffix: string
  ack: string
  complete: string
  adminTitle: string
  adminLead: string
  newTab: string
  newTabPlaceholder: string
  addTab: string
  itemTargetTab: string
  newItem: string
  newItemPlaceholder: string
  addItem: string
  customTabsSection: string
  customItemsSection: string
  noCustomTabs: string
  noCustomItems: string
  deleteAction: string
  deleteCancel: string
  deleteConfirm: string
  deleteModalTitle: string
  deleteModalBodyTab: (name: string) => string
  deleteModalBodyItem: (name: string) => string
  cartTitle: string
  cartEmpty: string
  sendRequest: string
  languageSwitch: string
  defaultStatus: string
  statusRequested: string
  statusAcknowledged: string
  statusCompleted: string
  requestSentFallback: string
  errors: {
    quotaReached: string
    profileRequired: string
    inviteRequired: string
    invalidSession: string
    loadFailed: string
    groupFailed: string
    vapidMissing: string
    pushFailed: string
    cartEmpty: string
    sendFailed: string
    ackFailed: string
    completeFailed: string
    addTabFailed: string
    addItemFailed: string
    clipboardFailed: string
    deleteTabFailed: string
    deleteItemFailed: string
    tabInUse: string
    itemInUse: string
  }
  statusTexts: {
    groupCreated: string
    groupJoined: string
    pushEnabled: string
    tabAdded: (name: string) => string
    itemAdded: (name: string) => string
    tabDeleted: (name: string) => string
    itemDeleted: (name: string) => string
    inviteLinkCopied: string
  }
}

const LANGUAGE_STORAGE_KEY = 'renrakun_language'
const LANGUAGE_USER_SET_KEY = 'renrakun_language_user_set'

const MESSAGES: Record<Language, Messages> = {
  ja: {
    locale: 'ja-JP',
    appTitle: 'れんらくん',
    heroKicker: 'Tap. Notify. Done.',
    onboardingLead: '家の消耗品連絡を、チャットではなく専用タッチパネルで。',
    createMode: 'グループ作成',
    joinMode: 'グループ参加',
    displayName: '表示名',
    defaultDisplayName: 'ゲスト',
    passphrase: '合言葉',
    passphrasePlaceholder: '例: secret123',
    passphraseHint: '半角英数字（6文字以上）',
    inviteToken: '招待リンクまたはトークン',
    inviteTokenPlaceholder: '例: https://.../?invite=... またはトークン',
    inviteEntryTitle: '招待リンクから参加',
    inviteEntryLead: '表示名と合言葉を入力すると、このグループに参加できます。',
    switchToManualJoin: '手動でトークン入力に切り替える',
    createAction: 'グループを作る',
    joinAction: 'グループに参加する',
    fixedCatalog: '固定カタログ',
    fixedCatalogLead: '通常操作は入力不要。タップだけで依頼できます。',
    dashboardTitle: '家の消耗品ダッシュボード',
    hello: (name) => `こんにちは、${name}さん`,
    enableNotifications: '通知を有効化',
    leaveGroup: 'グループ退出',
    quotaPaused: (resumeAt) => `無料枠上限のため書き込み機能を一時停止中です。再開予定: ${resumeAt}（JST基準）`,
    retentionBannerTitle: '履歴の保存期間',
    retentionBannerSummary: '未対応の依頼は残ります。完了した依頼は14日後に自動で削除されます。',
    retentionBannerDetailsTitle: '詳細を見る',
    retentionBannerDetailsPoints: [
      '「依頼中」「対応中」の依頼は自動では削除されません。',
      '「購入完了」にした依頼は、リストが長くなりすぎないよう14日後に自動で削除されます。',
      '長期間使われていないグループは段階的に整理されます。'
    ],
    inviteLinkLabel: '招待リンク',
    copyInviteLink: '招待リンクをコピー',
    touchLoading: '項目を読み込み中です。',
    touchEmpty: '表示できる項目がありません。更新して再度お試しください。',
    inboxTitle: '受信箱',
    inboxFilterOpen: '未完了',
    inboxFilterAll: 'すべて',
    refresh: '更新',
    inboxEmpty: '未対応の依頼はありません',
    selfLabel: 'あなた',
    requestOwnSuffix: 'を依頼しました',
    requestOtherSuffix: 'を買ってほしいと言っています',
    ack: '対応する',
    complete: '購入完了',
    adminTitle: 'グループ専用アイテムの追加',
    adminLead: 'このグループを作成した人のみ、タブやアイテムを追加・管理できます。',
    newTab: '新しいタブ名',
    newTabPlaceholder: '例: 日用品',
    addTab: 'タブを追加',
    itemTargetTab: '追加先のタブ',
    newItem: '新しいアイテム名',
    newItemPlaceholder: '例: 食洗機用洗剤',
    addItem: 'アイテムを追加',
    customTabsSection: '追加したタブの削除',
    customItemsSection: '追加したアイテムの削除',
    noCustomTabs: '削除できるタブはありません',
    noCustomItems: 'このタブに削除できるアイテムはありません',
    deleteAction: '削除',
    deleteCancel: '取り消し',
    deleteConfirm: '削除する',
    deleteModalTitle: '削除の確認',
    deleteModalBodyTab: (name) => `タブ「${name}」を削除します。よろしいですか？`,
    deleteModalBodyItem: (name) => `アイテム「${name}」を削除します。よろしいですか？`,
    cartTitle: 'カート',
    cartEmpty: 'アイテムがありません',
    sendRequest: '依頼を送信する',
    languageSwitch: 'English',
    defaultStatus: 'タブを選んで、必要なものをポチポチ追加してください。',
    statusRequested: '依頼中',
    statusAcknowledged: '対応中',
    statusCompleted: '購入完了',
    requestSentFallback: '依頼を送信しました。',
    errors: {
      quotaReached: '無料枠の上限に達しました。翌日0:00 JSTに自動再開します。',
      profileRequired: '表示名と合言葉は必須です。',
      inviteRequired: '参加には招待リンクまたはトークンが必要です。',
      invalidSession: 'セッションが無効になりました。グループに入り直してください。',
      loadFailed: 'データを読み込めませんでした。更新して再度お試しください。',
      groupFailed: 'グループ操作に失敗しました',
      vapidMissing: 'VITE_VAPID_PUBLIC_KEY が未設定です。',
      pushFailed: '通知設定に失敗しました',
      cartEmpty: 'カートが空です。',
      sendFailed: '依頼送信に失敗しました',
      ackFailed: '対応中への更新に失敗しました',
      completeFailed: '購入完了への更新に失敗しました',
      addTabFailed: 'カスタムタブ追加に失敗しました',
      addItemFailed: 'カスタムアイテム追加に失敗しました',
      clipboardFailed: 'クリップボードへコピーできませんでした。',
      deleteTabFailed: 'タブ削除に失敗しました',
      deleteItemFailed: 'アイテム削除に失敗しました',
      tabInUse: 'このタブは過去の依頼に含まれているため削除できません。',
      itemInUse: 'このアイテムは過去の依頼に含まれているため削除できません。'
    },
    statusTexts: {
      groupCreated: 'グループを作成しました。招待リンクを共有してください。',
      groupJoined: 'グループに参加しました。',
      pushEnabled: '通知を有効化しました。',
      tabAdded: (name) => `タブ「${name}」を追加しました。`,
      itemAdded: (name) => `アイテム「${name}」を追加しました。`,
      tabDeleted: (name) => `タブ「${name}」を削除しました。`,
      itemDeleted: (name) => `アイテム「${name}」を削除しました。`,
      inviteLinkCopied: '招待リンクをコピーしました。'
    }
  },
  en: {
    locale: 'en-US',
    appTitle: 'renrakun',
    heroKicker: 'Tap. Notify. Done.',
    onboardingLead: 'Use a dedicated touch-panel UI for household restock requests.',
    createMode: 'Create Group',
    joinMode: 'Join Group',
    displayName: 'Display name',
    defaultDisplayName: 'Guest',
    passphrase: 'Passphrase',
    passphrasePlaceholder: 'e.g. secret123',
    passphraseHint: '6+ characters (alphanumeric)',
    inviteToken: 'Invite link or token',
    inviteTokenPlaceholder: 'e.g. https://.../?invite=... or token',
    inviteEntryTitle: 'Join from invite link',
    inviteEntryLead: 'Enter your display name and passphrase to join this group.',
    switchToManualJoin: 'Switch to manual token input',
    createAction: 'Create group',
    joinAction: 'Join group',
    fixedCatalog: 'Built-in catalog',
    fixedCatalogLead: 'Regular operations are tap-only with no typing.',
    dashboardTitle: 'Household Restock Dashboard',
    hello: (name) => `Hello, ${name}`,
    enableNotifications: 'Enable notifications',
    leaveGroup: 'Leave group',
    quotaPaused: (resumeAt) => `Write APIs are paused by daily quota. Resume at: ${resumeAt} (JST)`,
    retentionBannerTitle: 'How history is kept',
    retentionBannerSummary: 'Open requests stay. Completed requests are deleted after 14 days.',
    retentionBannerDetailsTitle: 'View details',
    retentionBannerDetailsPoints: [
      'Requests in "Requested" or "In progress" are not auto-deleted.',
      'Requests marked "Completed" are auto-deleted after 14 days to keep the list tidy.',
      'Long-unused groups are cleaned up gradually.'
    ],
    inviteLinkLabel: 'Invite link',
    copyInviteLink: 'Copy invite link',
    touchLoading: 'Loading items...',
    touchEmpty: 'No items to show. Please refresh and try again.',
    inboxTitle: 'Inbox',
    inboxFilterOpen: 'Active',
    inboxFilterAll: 'All',
    refresh: 'Refresh',
    inboxEmpty: 'No pending requests',
    selfLabel: 'You',
    requestOwnSuffix: ' requested this.',
    requestOtherSuffix: ' needs this purchased.',
    ack: 'Acknowledge',
    complete: 'Complete',
    adminTitle: 'Add group-only items',
    adminLead: 'Only the person who created this group can add and manage tabs and items.',
    newTab: 'New tab name',
    newTabPlaceholder: 'e.g. Household',
    addTab: 'Add tab',
    itemTargetTab: 'Tab to add into',
    newItem: 'New item name',
    newItemPlaceholder: 'e.g. Dishwasher detergent',
    addItem: 'Add item',
    customTabsSection: 'Delete added tabs',
    customItemsSection: 'Delete added items',
    noCustomTabs: 'No added tabs to delete',
    noCustomItems: 'No added items in this tab',
    deleteAction: 'Delete',
    deleteCancel: 'Cancel',
    deleteConfirm: 'Delete',
    deleteModalTitle: 'Confirm deletion',
    deleteModalBodyTab: (name) => `Delete tab "${name}"?`,
    deleteModalBodyItem: (name) => `Delete item "${name}"?`,
    cartTitle: 'Cart',
    cartEmpty: 'No items',
    sendRequest: 'Send request',
    languageSwitch: '日本語',
    defaultStatus: 'Select a tab and tap items to add them.',
    statusRequested: 'Requested',
    statusAcknowledged: 'Acknowledged',
    statusCompleted: 'Completed',
    requestSentFallback: 'Request sent.',
    errors: {
      quotaReached: 'Daily free-tier quota reached. It will resume automatically at 00:00 JST.',
      profileRequired: 'Display name and passphrase are required.',
      inviteRequired: 'Invite link or token is required to join.',
      invalidSession: 'Session is invalid. Please join the group again.',
      loadFailed: 'Could not load data. Please refresh in a moment.',
      groupFailed: 'Group operation failed',
      vapidMissing: 'VITE_VAPID_PUBLIC_KEY is missing.',
      pushFailed: 'Failed to enable notifications',
      cartEmpty: 'Cart is empty.',
      sendFailed: 'Failed to send request',
      ackFailed: 'Failed to update status to acknowledged',
      completeFailed: 'Failed to update status to completed',
      addTabFailed: 'Failed to add custom tab',
      addItemFailed: 'Failed to add custom item',
      clipboardFailed: 'Failed to copy to clipboard.',
      deleteTabFailed: 'Failed to delete tab',
      deleteItemFailed: 'Failed to delete item',
      tabInUse: 'This tab cannot be deleted because it is referenced by past requests.',
      itemInUse: 'This item cannot be deleted because it is referenced by past requests.'
    },
    statusTexts: {
      groupCreated: 'Group created. Share the invite link.',
      groupJoined: 'Joined the group.',
      pushEnabled: 'Notifications enabled.',
      tabAdded: (name) => `Added tab: ${name}`,
      itemAdded: (name) => `Added item: ${name}`,
      tabDeleted: (name) => `Deleted tab: ${name}`,
      itemDeleted: (name) => `Deleted item: ${name}`,
      inviteLinkCopied: 'Invite link copied.'
    }
  }
}

function getInitialLanguage(): Language {
  const userSet = localStorage.getItem(LANGUAGE_USER_SET_KEY) === '1'
  if (!userSet) return 'ja'
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  if (stored === 'ja' || stored === 'en') return stored
  return 'ja'
}

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

function formatStatus(status: RequestStatus, messages: Messages): string {
  if (status === 'requested') return messages.statusRequested
  if (status === 'acknowledged') return messages.statusAcknowledged
  return messages.statusCompleted
}

function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function normalizeInviteInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  try {
    const base = typeof window === 'undefined' ? 'https://renrakun.pages.dev' : window.location.origin
    const parsed = new URL(trimmed, base)
    const fromQuery = parsed.searchParams.get('invite') ?? parsed.searchParams.get('token')
    if (fromQuery && fromQuery.trim()) return fromQuery.trim()
  } catch {
    // Treat non-URL values as a direct token.
  }

  return trimmed
}

function buildInviteUrl(token: string): string {
  if (typeof window === 'undefined') {
    return `https://renrakun.pages.dev/?invite=${encodeURIComponent(token)}`
  }
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(token)}`
}

function isQuotaError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && error.code === 'SERVICE_PAUSED_DAILY_QUOTA'
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage())
  const messages = useMemo(() => MESSAGES[language], [language])
  const [deviceId] = useState(() => getOrCreateDeviceId())
  const [session, setSession] = useState<AppSession | null>(() => readSession())
  const [catalog, setCatalog] = useState<LayoutResponse | null>(null)
  const [layout, setLayout] = useState<LayoutResponse | null>(null)
  const [inbox, setInbox] = useState<InboxEvent[]>([])
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('open')
  const [activeTabId, setActiveTabId] = useState('')
  const [selectedStoreId, setSelectedStoreId] = useState<string | undefined>(undefined)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [joinMode, setJoinMode] = useState<JoinMode>('create')
  const [displayName, setDisplayName] = useState(() => MESSAGES[getInitialLanguage()].defaultDisplayName)
  const [passphrase, setPassphrase] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [customTabName, setCustomTabName] = useState('')
  const [customItemName, setCustomItemName] = useState('')
  const [customItemTabId, setCustomItemTabId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [statusText, setStatusText] = useState(() => MESSAGES[getInitialLanguage()].defaultStatus)
  const [errorText, setErrorText] = useState('')
  const [lastLoadErrorCode, setLastLoadErrorCode] = useState('')
  const [quotaResumeAt, setQuotaResumeAt] = useState<string | null>(null)
  const [inviteFromLink, setInviteFromLink] = useState(false)
  const [showManualJoinInput, setShowManualJoinInput] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )
  const [isLoading, setIsLoading] = useState(false)
  const lastSyncedMemberIdRef = useRef<string | null>(null)

  const auth = useMemo(
    () => (session ? { deviceId, memberId: session.memberId } : null),
    [deviceId, session]
  )

  useEffect(() => {
    setApiLanguage(language)
  }, [language])

  useEffect(() => {
    if (session || typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const inviteFromQuery = params.get('invite') ?? params.get('token')
    if (!inviteFromQuery) return

    const normalized = normalizeInviteInput(inviteFromQuery)
    if (normalized) {
      setJoinMode('join')
      setInviteToken(normalized)
      setInviteFromLink(true)
      setShowManualJoinInput(false)
    }

    const cleanPath = `${window.location.pathname}${window.location.hash}`
    window.history.replaceState(null, '', cleanPath || '/')
  }, [session])

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
    setLastLoadErrorCode('')
    try {
      const [layoutData, inboxData] = await Promise.all([
        fetchLayout(session.groupId, auth),
        fetchInbox(session.groupId, auth)
      ])
      setLayout(layoutData)
      setInbox(inboxData)
      setActiveTabId((current) => (layoutData.tabs.some((tab) => tab.id === current) ? current : layoutData.tabs[0]?.id || ''))
      setCustomItemTabId((current) =>
        layoutData.tabs.some((tab) => tab.id === current) ? current : layoutData.tabs[0]?.id || ''
      )
    } catch (error) {
      if (isQuotaError(error)) {
        setQuotaResumeAt(error.resumeAt ?? null)
      } else if (error instanceof ApiClientError) {
        setLastLoadErrorCode(error.code)
        console.error('[loadPrivateData] API error', {
          status: error.status,
          code: error.code,
          detail: error.detail
        })
        if (
          error.status === 401 ||
          error.code === 'UNAUTHORIZED' ||
          error.code === 'MEMBER_NOT_FOUND' ||
          error.code === 'INVALID_SESSION'
        ) {
          setErrorText(messages.errors.invalidSession)
          setSession(null)
          clearSession()
          setInviteFromLink(false)
          setShowManualJoinInput(false)
          setInviteToken('')
          setJoinMode('create')
        } else {
          setErrorText(messages.errors.loadFailed)
        }
      } else {
        setLastLoadErrorCode('UNKNOWN_ERROR')
        console.error('[loadPrivateData] unexpected error', error)
        setErrorText(messages.errors.loadFailed)
      }
    } finally {
      setIsLoading(false)
    }
  }, [auth, messages.errors.invalidSession, messages.errors.loadFailed, session])

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
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  }, [language])

  const handleToggleLanguage = useCallback(() => {
    localStorage.setItem(LANGUAGE_USER_SET_KEY, '1')
    setLanguage((current) => (current === 'ja' ? 'en' : 'ja'))
  }, [])

  useEffect(() => {
    setStatusText((current) => {
      const isLegacyDefault = current === MESSAGES.ja.defaultStatus || current === MESSAGES.en.defaultStatus
      return isLegacyDefault ? messages.defaultStatus : current
    })

    setDisplayName((current) => {
      const isLegacyDefault = current === MESSAGES.ja.defaultDisplayName || current === MESSAGES.en.defaultDisplayName
      return isLegacyDefault ? messages.defaultDisplayName : current
    })
  }, [messages.defaultDisplayName, messages.defaultStatus])

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
  const customTabs = useMemo(
    () => tabs.filter((tab) => !tab.isSystem && (!session || tab.groupId === session.groupId)),
    [session, tabs]
  )
  const customItemsInSelectedTab = useMemo(() => {
    const source = layout ?? catalog
    if (!source) return []
    return source.items.filter((item) => item.tabId === customItemTabId && !item.isSystem)
  }, [catalog, customItemTabId, layout])
  const itemMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of (layout ?? catalog)?.items ?? []) {
      map.set(item.id, item.name)
    }
    return map
  }, [catalog, layout])

  const cartEntries = useMemo(() => Object.entries(cart).filter(([, qty]) => qty > 0), [cart])
  const cartCount = useMemo(() => cartEntries.reduce((sum, [, qty]) => sum + qty, 0), [cartEntries])
  const visibleInbox = useMemo(
    () => (inboxFilter === 'all' ? inbox : inbox.filter((event) => event.status !== 'completed')),
    [inbox, inboxFilter]
  )
  const inviteLink = useMemo(
    () => (session?.inviteToken ? buildInviteUrl(session.inviteToken) : ''),
    [session?.inviteToken]
  )
  const showInviteOnlyJoin = inviteFromLink && !showManualJoinInput
  const inviteCopyLabel = messages.copyInviteLink || (language === 'ja' ? '招待リンクをコピー' : 'Copy invite link')
  const notificationActionLabel =
    notificationPermission === 'granted'
      ? messages.resyncNotifications || (language === 'ja' ? '通知を再同期' : 'Resync notifications')
      : messages.enableNotifications
  const membersTitle = messages.membersTitle || (language === 'ja' ? '参加中メンバー' : 'Members in group')
  const membersCount = messages.membersCount
    ? messages.membersCount((layout?.members?.length ?? 0))
    : language === 'ja'
      ? `${layout?.members?.length ?? 0}人`
      : `${layout?.members?.length ?? 0} members`
  const memberCreatorBadge = messages.memberCreatorBadge || (language === 'ja' ? '作成者' : 'Creator')
  const memberPushReady = messages.memberPushReady || (language === 'ja' ? '通知OK' : 'Notifications OK')
  const memberPushNotReady =
    messages.memberPushNotReady || (language === 'ja' ? '通知未設定' : 'Notifications off')
  const memberYouSuffix = messages.memberYouSuffix || (language === 'ja' ? '（あなた）' : '(You)')
  const memberResyncHint =
    messages.memberResyncHint ||
    (language === 'ja'
      ? '通知が届かない場合は「通知を再同期」を押してください。'
      : 'If notifications do not arrive, tap "Resync notifications".')

  const applyError = useCallback((error: unknown, fallback: string) => {
    if (isQuotaError(error)) {
      setQuotaResumeAt(error.resumeAt ?? null)
      setErrorText(messages.errors.quotaReached)
      return
    }
    if (error instanceof ApiClientError) {
      setErrorText(`${fallback} (${error.code})`)
      return
    }
    setErrorText(fallback)
  }, [messages.errors.quotaReached])

  const handleCreateOrJoin = useCallback(async (modeOverride?: JoinMode) => {
    const mode = modeOverride ?? joinMode
    if (!displayName.trim() || !passphrase.trim()) {
      setErrorText(messages.errors.profileRequired)
      return
    }

    setErrorText('')
    setIsLoading(true)
    try {
      if (mode === 'create') {
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
        setStatusText(messages.statusTexts.groupCreated)
      } else {
        const normalizedInvite = normalizeInviteInput(inviteToken)
        if (!normalizedInvite) {
          setErrorText(messages.errors.inviteRequired)
          return
        }
        setInviteToken(normalizedInvite)
        const result = await joinGroup({
          deviceId,
          displayName,
          passphrase,
          inviteToken: normalizedInvite
        })
        const nextSession: AppSession = {
          groupId: result.groupId,
          memberId: result.memberId,
          role: result.role,
          displayName
        }
        writeSession(nextSession)
        setSession(nextSession)
        setStatusText(messages.statusTexts.groupJoined)
      }
    } catch (error) {
      applyError(error, messages.errors.groupFailed)
    } finally {
      setIsLoading(false)
    }
  }, [
    applyError,
    deviceId,
    displayName,
    inviteToken,
    joinMode,
    messages.errors.groupFailed,
    messages.errors.inviteRequired,
    messages.errors.profileRequired,
    messages.statusTexts.groupCreated,
    messages.statusTexts.groupJoined,
    passphrase
  ])

  const handleEnablePush = useCallback(async () => {
    if (!session || !auth) return
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') {
      setNotificationPermission('unsupported')
      return
    }

    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!publicKey) {
      setErrorText(messages.errors.vapidMissing)
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      if (permission !== 'granted') return

      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toServerKey(publicKey) as unknown as BufferSource
        })
      }

      await subscribePush(session.groupId, session.memberId, auth, subscription)
      lastSyncedMemberIdRef.current = session.memberId
      setStatusText(messages.statusTexts.pushEnabled)
      await loadPrivateData()
    } catch (error) {
      applyError(error, messages.errors.pushFailed)
    }
  }, [
    applyError,
    auth,
    loadPrivateData,
    messages.errors.pushFailed,
    messages.errors.vapidMissing,
    messages.statusTexts.pushEnabled,
    session
  ])

  const syncPushSubscription = useCallback(async () => {
    if (!session || !auth) return
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return
    if (notificationPermission !== 'granted') return
    if (lastSyncedMemberIdRef.current === session.memberId) return

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return
      await subscribePush(session.groupId, session.memberId, auth, subscription)
      lastSyncedMemberIdRef.current = session.memberId
      await loadPrivateData()
    } catch (error) {
      console.error('[push-sync] failed', error)
    }
  }, [auth, loadPrivateData, notificationPermission, session])

  useEffect(() => {
    if (!session) return
    void syncPushSubscription()
  }, [session, syncPushSubscription])

  const postPushContextMessage = useCallback(async (message: SwPushContextMessage) => {
    if (!('serviceWorker' in navigator)) return
    try {
      const registration = await navigator.serviceWorker.ready
      const target = registration.active ?? navigator.serviceWorker.controller
      target?.postMessage(message)
      console.info('[sw-context] synced', { type: message.type })
    } catch (error) {
      console.error('[sw-context] sync failed', error)
    }
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (session && auth) {
      void postPushContextMessage({
        type: 'SYNC_PUSH_CONTEXT',
        payload: {
          apiBase: API_BASE_URL,
          groupId: session.groupId,
          memberId: session.memberId,
          deviceId,
          language
        }
      })
      return
    }
    void postPushContextMessage({ type: 'CLEAR_PUSH_CONTEXT' })
  }, [auth, deviceId, language, postPushContextMessage, session])

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
      setErrorText(messages.errors.cartEmpty)
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
      setStatusText(language === 'ja' ? result.pushMessage : messages.requestSentFallback)
      setCart({})
      setSelectedStoreId(undefined)
      await loadPrivateData()
    } catch (error) {
      applyError(error, messages.errors.sendFailed)
    } finally {
      setIsLoading(false)
    }
  }, [
    applyError,
    auth,
    cartEntries,
    language,
    loadPrivateData,
    messages.errors.cartEmpty,
    messages.errors.sendFailed,
    messages.requestSentFallback,
    selectedStoreId,
    session
  ])

  const handleAck = useCallback(
    async (requestId: string) => {
      if (!auth) return
      try {
        await ackRequest(requestId, auth)
        await loadPrivateData()
      } catch (error) {
        applyError(error, messages.errors.ackFailed)
      }
    },
    [applyError, auth, loadPrivateData, messages.errors.ackFailed]
  )

  const handleComplete = useCallback(
    async (requestId: string) => {
      if (!auth) return
      try {
        await completeRequest(requestId, auth)
        await loadPrivateData()
      } catch (error) {
        applyError(error, messages.errors.completeFailed)
      }
    },
    [applyError, auth, loadPrivateData, messages.errors.completeFailed]
  )

  const handleCreateCustomTab = useCallback(async () => {
    if (!session || !auth || !customTabName.trim()) return
    try {
      const created = await createCustomTab(session.groupId, auth, { name: customTabName.trim() })
      setCustomTabName('')
      setStatusText(messages.statusTexts.tabAdded(created.name))
      await loadPrivateData()
      setActiveTabId(created.id)
    } catch (error) {
      applyError(error, messages.errors.addTabFailed)
    }
  }, [applyError, auth, customTabName, loadPrivateData, messages.errors.addTabFailed, messages.statusTexts, session])

  const handleCreateCustomItem = useCallback(async () => {
    if (!session || !auth || !customItemName.trim() || !customItemTabId) return
    try {
      const created = await createCustomItem(session.groupId, auth, {
        tabId: customItemTabId,
        name: customItemName.trim()
      })
      setCustomItemName('')
      setStatusText(messages.statusTexts.itemAdded(created.name))
      await loadPrivateData()
      setActiveTabId(customItemTabId)
    } catch (error) {
      applyError(error, messages.errors.addItemFailed)
    }
  }, [
    applyError,
    auth,
    customItemName,
    customItemTabId,
    loadPrivateData,
    messages.errors.addItemFailed,
    messages.statusTexts,
    session
  ])

  const openDeleteModal = useCallback((kind: DeleteTargetKind, target: CatalogTab | CatalogItem) => {
    setDeleteTarget({ kind, id: target.id, name: target.name })
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || !session || !auth) return

    try {
      if (deleteTarget.kind === 'tab') {
        await deleteCustomTab(session.groupId, deleteTarget.id, auth)
        setStatusText(messages.statusTexts.tabDeleted(deleteTarget.name))
      } else {
        await deleteCustomItem(session.groupId, deleteTarget.id, auth)
        setStatusText(messages.statusTexts.itemDeleted(deleteTarget.name))
      }
      setDeleteTarget(null)
      await loadPrivateData()
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'TAB_IN_USE') {
        setErrorText(messages.errors.tabInUse)
        return
      }
      if (error instanceof ApiClientError && error.code === 'ITEM_IN_USE') {
        setErrorText(messages.errors.itemInUse)
        return
      }
      applyError(
        error,
        deleteTarget.kind === 'tab' ? messages.errors.deleteTabFailed : messages.errors.deleteItemFailed
      )
    }
  }, [
    applyError,
    auth,
    deleteTarget,
    loadPrivateData,
    messages.errors.deleteItemFailed,
    messages.errors.deleteTabFailed,
    messages.errors.itemInUse,
    messages.errors.tabInUse,
    messages.statusTexts,
    session
  ])

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setStatusText(messages.statusTexts.inviteLinkCopied)
    } catch {
      setErrorText(messages.errors.clipboardFailed)
    }
  }, [inviteLink, messages.errors.clipboardFailed, messages.statusTexts.inviteLinkCopied])

  const activeItems = itemsByTab.get(activeTabId) ?? []
  const hasTouchData =
    tabs.length > 0 || storeButtons.length > 0 || (((layout ?? catalog)?.items?.length ?? 0) > 0)
  const touchFallbackMessage = isLoading
    ? messages.touchLoading
    : errorText
      ? messages.errors.loadFailed
      : messages.touchEmpty

  if (!session) {
    return (
      <div className="app-shell onboarding-shell">
        <div className="language-row">
          <button
            type="button"
            className="language-button"
            onClick={handleToggleLanguage}
          >
            {messages.languageSwitch}
          </button>
        </div>
        <header className="hero">
          <p className="hero-kicker">{messages.heroKicker}</p>
          <h1>{messages.appTitle}</h1>
          <p>{messages.onboardingLead}</p>
        </header>

        <section className="card onboarding-card">
          {showInviteOnlyJoin ? (
            <>
              <h2>{messages.inviteEntryTitle}</h2>
              <p className="sub-text">{messages.inviteEntryLead}</p>

              <label>
                {messages.displayName}
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={messages.defaultDisplayName}
                  maxLength={40}
                />
              </label>

              <label>
                {messages.passphrase}
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  placeholder={messages.passphrasePlaceholder}
                  maxLength={64}
                />
                <small className="field-hint">{messages.passphraseHint}</small>
              </label>

              <button
                className="primary-button"
                onClick={() => {
                  void handleCreateOrJoin('join')
                }}
                type="button"
                disabled={isLoading}
              >
                {messages.joinAction}
              </button>
              <button
                type="button"
                className="inline-text-button"
                onClick={() => {
                  setShowManualJoinInput(true)
                  setJoinMode('join')
                }}
              >
                {messages.switchToManualJoin}
              </button>
              {errorText && <p className="error-text">{errorText}</p>}
            </>
          ) : (
            <>
              <div className="mode-switch">
                <button
                  className={joinMode === 'create' ? 'active' : ''}
                  onClick={() => setJoinMode('create')}
                  type="button"
                >
                  {messages.createMode}
                </button>
                <button
                  className={joinMode === 'join' ? 'active' : ''}
                  onClick={() => setJoinMode('join')}
                  type="button"
                >
                  {messages.joinMode}
                </button>
              </div>

              <label>
                {messages.displayName}
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={messages.defaultDisplayName}
                  maxLength={40}
                />
              </label>

              <label>
                {messages.passphrase}
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  placeholder={messages.passphrasePlaceholder}
                  maxLength={64}
                />
                <small className="field-hint">{messages.passphraseHint}</small>
              </label>

              {joinMode === 'join' && (
                <label>
                  {messages.inviteToken}
                  <input
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    placeholder={messages.inviteTokenPlaceholder}
                    maxLength={1024}
                  />
                </label>
              )}

              <button 
                className="primary-button" 
                onClick={() => void handleCreateOrJoin()}
                type="button" 
                disabled={isLoading}
              >
                {joinMode === 'create' ? messages.createAction : messages.joinAction}
              </button>
              {errorText && <p className="error-text">{errorText}</p>}
            </>
          )}
        </section>

        <section className="card preview-card">
          <h2>{messages.fixedCatalog}</h2>
          <p>{messages.fixedCatalogLead}</p>
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
          <p className="hero-kicker">{messages.dashboardTitle}</p>
          <h1>{messages.appTitle}</h1>
          <p className="sub-text">{messages.hello(session.displayName)}</p>
        </div>
        <div className="header-actions">
          <button type="button" className="language-button" onClick={handleToggleLanguage}>
            {messages.languageSwitch}
          </button>
          {notificationPermission !== 'unsupported' && (
            <button type="button" onClick={handleEnablePush}>
              {notificationActionLabel}
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
              setPassphrase('')
              setInviteToken('')
              setJoinMode('create')
              setInviteFromLink(false)
              setShowManualJoinInput(false)
              setLastLoadErrorCode('')
              lastSyncedMemberIdRef.current = null
            }}
          >
            {messages.leaveGroup}
          </button>
        </div>
      </header>

      {quotaResumeAt && (
        <aside className="quota-banner">{messages.quotaPaused(formatTime(quotaResumeAt, messages.locale))}</aside>
      )}

      <aside className="retention-banner" aria-live="polite">
        <strong>{messages.retentionBannerTitle}</strong>
        <p>{messages.retentionBannerSummary}</p>
        <details>
          <summary>{messages.retentionBannerDetailsTitle}</summary>
          <ul>
            {messages.retentionBannerDetailsPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </details>
      </aside>

      {inviteLink && (
        <section className="card invite-card">
          <p>
            {messages.inviteLinkLabel}: <code>{inviteLink}</code>
          </p>
          <button type="button" onClick={handleCopyInviteLink}>
            {inviteCopyLabel}
          </button>
        </section>
      )}

      <section className="card members-card">
        <div className="members-header">
          <h2>{membersTitle}</h2>
          <span className="members-count">{membersCount}</span>
        </div>
        <ul className="members-list">
          {!layout && <li className="empty">{messages.touchLoading}</li>}
          {layout?.members.map((member) => {
            const isSelf = member.id === session.memberId
            return (
              <li key={member.id} className="member-row">
                <div className="member-name">
                  <strong>
                    {member.displayName}
                    {isSelf ? ` ${memberYouSuffix}` : ''}
                  </strong>
                  {member.role === 'admin' && <span className="role-badge">{memberCreatorBadge}</span>}
                </div>
                <span className={`push-badge ${member.pushReady ? 'ok' : 'warn'}`}>
                  {member.pushReady ? memberPushReady : memberPushNotReady}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="sub-text members-hint">{memberResyncHint}</p>
      </section>

      <div className="main-grid">
        <div className="main-left">
          <section className="card touch-card">
            {!hasTouchData ? (
              <div className="touch-fallback">
                <p>{touchFallbackMessage}</p>
                {lastLoadErrorCode && <small className="sub-text">Error code: {lastLoadErrorCode}</small>}
                <button type="button" onClick={() => void loadPrivateData()} disabled={isLoading}>
                  {messages.refresh}
                </button>
              </div>
            ) : (
              <>
                <div className="tab-strip">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={activeTabId === tab.id ? 'active' : ''}
                      onClick={() => {
                        setActiveTabId(tab.id)
                        setCustomItemTabId(tab.id)
                      }}
                    >
                      {tab.name}
                    </button>
                  ))}
                </div>

                <div className="item-grid">
                  {activeItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="item-button"
                      onClick={() => handleAddToCart(item.id)}
                    >
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
              </>
            )}
          </section>

          {session.role === 'admin' && (
            <section className="card admin-card">
              <h2>{messages.adminTitle}</h2>
              <p>{messages.adminLead}</p>
              <div className="admin-form">
                <label>
                  {messages.newTab}
                  <input
                    value={customTabName}
                    onChange={(event) => setCustomTabName(event.target.value)}
                    placeholder={messages.newTabPlaceholder}
                    maxLength={30}
                  />
                </label>
                <button type="button" className="admin-action-button" onClick={() => void handleCreateCustomTab()}>
                  {messages.addTab}
                </button>
              </div>
              <div className="admin-form">
                <label>
                  {messages.itemTargetTab}
                  <select value={customItemTabId} onChange={(event) => setCustomItemTabId(event.target.value)}>
                    {tabs.map((tab) => (
                      <option key={tab.id} value={tab.id}>
                        {tab.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {messages.newItem}
                  <input
                    value={customItemName}
                    onChange={(event) => setCustomItemName(event.target.value)}
                    placeholder={messages.newItemPlaceholder}
                    maxLength={30}
                  />
                </label>
                <button
                  type="button"
                  className="admin-action-button"
                  onClick={() => void handleCreateCustomItem()}
                  disabled={!customItemName.trim() || !customItemTabId}
                >
                  {messages.addItem}
                </button>
              </div>
              <div className="admin-form">
                <h3>{messages.customTabsSection}</h3>
                {customTabs.length === 0 ? (
                  <p className="empty">{messages.noCustomTabs}</p>
                ) : (
                  <ul className="admin-list">
                    {customTabs.map((tab) => (
                      <li key={tab.id}>
                        <span>{tab.name}</span>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => openDeleteModal('tab', tab)}
                        >
                          {messages.deleteAction}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="admin-form">
                <h3>{messages.customItemsSection}</h3>
                {customItemsInSelectedTab.length === 0 ? (
                  <p className="empty">{messages.noCustomItems}</p>
                ) : (
                  <ul className="admin-list">
                    {customItemsInSelectedTab.map((item) => (
                      <li key={item.id}>
                        <span>{item.name}</span>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => openDeleteModal('item', item)}
                        >
                          {messages.deleteAction}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="main-right">
          <section className="card inbox-card">
            <div className="panel-header">
              <h2>{messages.inboxTitle}</h2>
              <div className="panel-controls">
                <div className="inbox-filter" role="group" aria-label={messages.inboxTitle}>
                  <button
                    type="button"
                    className={inboxFilter === 'open' ? 'active' : ''}
                    onClick={() => setInboxFilter('open')}
                  >
                    {messages.inboxFilterOpen}
                  </button>
                  <button
                    type="button"
                    className={inboxFilter === 'all' ? 'active' : ''}
                    onClick={() => setInboxFilter('all')}
                  >
                    {messages.inboxFilterAll}
                  </button>
                </div>
                <button type="button" onClick={() => void loadPrivateData()} disabled={isLoading}>
                  {messages.refresh}
                </button>
              </div>
            </div>
            <ul className="inbox-list">
              {visibleInbox.length === 0 && <li className="empty">{messages.inboxEmpty}</li>}
              {visibleInbox.map((event) => {
                const isOwnRequest = event.senderMemberId === session.memberId
                const actorLabel = isOwnRequest ? messages.selfLabel : event.senderName
                const prefix = language === 'ja' ? `${actorLabel}が` : `${actorLabel} `
                const storePrefix = event.storeName
                  ? language === 'ja'
                    ? `${event.storeName}で`
                    : `at ${event.storeName} `
                  : ''
                const itemText = event.items
                  .map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name))
                  .join(language === 'ja' ? '、' : ', ')
                return (
                  <li key={event.eventId} className="inbox-item">
                    <div className="inbox-top">
                      <strong>{actorLabel}</strong>
                      <span className={`status ${event.status}`}>{formatStatus(event.status, messages)}</span>
                    </div>
                    <p className="inbox-message">
                      {prefix}
                      {storePrefix}
                      {itemText}
                      {isOwnRequest ? messages.requestOwnSuffix : messages.requestOtherSuffix}
                    </p>
                    <div className="inbox-meta">{formatTime(event.createdAt, messages.locale)}</div>
                    <div className="inbox-actions">
                      <button
                        type="button"
                        disabled={event.status !== 'requested' || isOwnRequest}
                        onClick={() => void handleAck(event.requestId)}
                      >
                        {messages.ack}
                      </button>
                      <button
                        type="button"
                        disabled={event.status === 'completed' || isOwnRequest}
                        onClick={() => void handleComplete(event.requestId)}
                      >
                        {messages.complete}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      </div>

      <footer className="cart-bar">
        <div className="cart-header">
          <h3>
            {messages.cartTitle} ({cartCount})
          </h3>
          <p>{statusText}</p>
        </div>
        <div className="cart-items">
          {cartEntries.length === 0 && <span className="empty">{messages.cartEmpty}</span>}
          {cartEntries.map(([itemId, qty]) => (
            <button key={itemId} type="button" className="cart-pill" onClick={() => handleDecreaseFromCart(itemId)}>
              {itemMap.get(itemId) ?? itemId} x{qty}
            </button>
          ))}
        </div>
        <button className="primary-button" onClick={() => void handleSendRequest()} disabled={cartEntries.length === 0 || isLoading}>
          {messages.sendRequest}
        </button>
      </footer>

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true">
            <h3>{messages.deleteModalTitle}</h3>
            <p>
              {deleteTarget.kind === 'tab'
                ? messages.deleteModalBodyTab(deleteTarget.name)
                : messages.deleteModalBodyItem(deleteTarget.name)}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>
                {messages.deleteCancel}
              </button>
              <button type="button" className="danger-button" onClick={() => void handleConfirmDelete()}>
                {messages.deleteConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {errorText && <p className="error-text floating">{errorText}</p>}
    </div>
  )
}
