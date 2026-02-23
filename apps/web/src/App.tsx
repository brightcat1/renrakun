import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RequestIntent, RequestStatus } from '@renrakun/shared'
import {
  API_BASE_URL,
  ApiClientError,
  ackRequest,
  completeRequest,
  createCustomItem,
  createCustomStore,
  createCustomTab,
  deleteCustomItem,
  deleteCustomStore,
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
  type LayoutResponse,
  type StoreButton
} from './api'
import { clearSession, getOrCreateDeviceId, readSession, writeSession, type AppSession } from './session'

type JoinMode = 'create' | 'join'
type Language = 'ja' | 'en'
type DeleteTargetKind = 'tab' | 'item' | 'store'
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
type SwRefreshMessage = {
  type: 'REFRESH_DATA'
  reason?: string
}

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
  iosInviteContextTitle?: string
  iosInviteContextBody?: string
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
  copyInviteToken?: string
  inviteHybridHint?: string
  membersTitle?: string
  membersCount?: (count: number) => string
  memberCreatorBadge?: string
  memberPushReady?: string
  memberPushNotReady?: string
  memberYouSuffix?: string
  memberResyncHint?: string
  notifyGuideTitle?: string
  notifyGuideSummary?: string
  notifyGuideDetailsTitle?: string
  notifyGuidePlatformIOS?: string[]
  notifyGuidePlatformAndroid?: string[]
  notifyGuidePlatformPC?: string[]
  notifyGuidePlatformNote?: string
  notifyGuideBehaviorTitle?: string
  notifyGuideBehaviorPoints?: string[]
  notifyGuideUnsupported?: string
  pushSupportBestEffortNote?: string
  pushSupportUnsupportedNote?: string
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
  requestOwnVisitSuffix?: string
  requestOtherVisitSuffix?: string
  ack: string
  complete: string
  intentBuy?: string
  intentVisit?: string
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
  customStoresSection?: string
  noCustomTabs: string
  noCustomItems: string
  noCustomStores?: string
  newStore?: string
  newStorePlaceholder?: string
  addStore?: string
  deleteAction: string
  deleteCancel: string
  deleteConfirm: string
  deleteModalTitle: string
  deleteModalBodyTab: (name: string) => string
  deleteModalBodyItem: (name: string) => string
  cartTitle: string
  cartEmpty: string
  cartHintBuy?: string
  cartHintVisit?: string
  cartStoreLabel?: string
  cartClearStore?: string
  addToCartLabel?: string
  removeFromCartLabel?: string
  sendRequest: string
  languageSwitch: string
  toastGroupCreated?: string
  toastGroupJoined?: string
  toastPushEnabled?: string
  toastInviteCopied?: string
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
    visitStoreRequired?: string
    ackFailed: string
    completeFailed: string
    addTabFailed: string
    addItemFailed: string
    addStoreFailed?: string
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
    storeAdded?: (name: string) => string
    storeDeleted?: (name: string) => string
    inviteLinkCopied: string
  }
}

const LANGUAGE_STORAGE_KEY = 'renrakun_language'
const LANGUAGE_USER_SET_KEY = 'renrakun_language_user_set'
const AUTO_SYNC_POLL_INTERVAL_MS = 45_000
const AUTO_SYNC_MIN_INTERVAL_MS = 5_000

const MESSAGES: Record<Language, Messages> = {
  ja: {
    locale: 'ja-JP',
    appTitle: 'れんらくん',
    heroKicker: 'Tap. Notify. Done.',
    onboardingLead: '家庭内の「買ってほしい / 行きたい」依頼を、専用タッチパネルでサッと共有できます。',
    createMode: 'グループ作成',
    joinMode: 'グループ参加',
    displayName: '表示名',
    defaultDisplayName: 'ゲスト',
    passphrase: '合言葉',
    passphrasePlaceholder: '例: secret123',
    passphraseHint: '6文字以上（日本語・英数字どちらでも可）',
    inviteToken: '招待リンクまたはトークン',
    inviteTokenPlaceholder: '例: https://.../?invite=... またはトークン',
    inviteEntryTitle: '招待リンクから参加',
    inviteEntryLead: '表示名と合言葉を入力すると、このグループに参加できます。',
    switchToManualJoin: '手動でトークン入力に切り替える',
    iosInviteContextTitle: 'iPhoneで参加する場合',
    iosInviteContextBody:
      'Safariで開いた画面とホーム画面アプリは別扱いです。ホーム画面アプリで使う場合は、招待リンクまたはトークンをコピーして「グループ参加」に貼り付けてください。',
    createAction: 'グループを作る',
    joinAction: 'グループに参加する',
    fixedCatalog: '固定カタログ',
    fixedCatalogLead: '通常操作はタップだけで使えます。',
    dashboardTitle: '家庭内 依頼ダッシュボード',
    hello: (name) => `こんにちは、${name}さん`,
    enableNotifications: '通知を有効化',
    resyncNotifications: '通知を再同期',
    leaveGroup: 'グループ退出',
    quotaPaused: (resumeAt) => `無料枠上限のため書き込みを一時停止中です。再開予定: ${resumeAt}（JST）`,
    retentionBannerTitle: '履歴の保存期間',
    retentionBannerSummary: '未対応の依頼は残ります。完了した依頼は14日後に自動で削除されます。',
    retentionBannerDetailsTitle: '詳細を見る',
    retentionBannerDetailsPoints: [
      '「依頼中」「対応中」の依頼は自動では削除されません。',
      '「完了」にした依頼は、14日後に自動で削除されます。',
      '長期間使われていないグループは段階的に整理されます。'
    ],
    inviteLinkLabel: '招待リンク',
    copyInviteLink: '招待リンクをコピー',
    copyInviteToken: 'トークンをコピー',
    inviteHybridHint: '招待相手がiPhoneでホーム画面アプリを使う場合は、招待リンクまたはトークンを共有し、「グループ参加」で入力してもらってください。',
    membersTitle: '参加中メンバー',
    membersCount: (count) => `${count}人`,
    memberCreatorBadge: '作成者',
    memberPushReady: '通知OK',
    memberPushNotReady: '通知未設定',
    memberYouSuffix: '（あなた）',
    memberResyncHint: '通知が届かない場合は「通知を再同期」を押してください。',
    notifyGuideTitle: '通知の使い方',
    notifyGuideSummary:
      'iOSはホーム画面に追加したWebアプリからのみ通知を有効化できます。Android/PCはブラウザの通知許可をONにして、アプリ内「通知を有効化/再同期」を押してください。',
    notifyGuideDetailsTitle: '詳しい手順を見る',
    notifyGuidePlatformIOS: [
      'Safariでれんらくんを開く',
      '共有メニューから「ホーム画面に追加」を選ぶ',
      'ホーム画面のアプリアイコンから開く',
      'アプリ内「通知を有効化」を押して許可する'
    ],
    notifyGuidePlatformAndroid: [
      'ブラウザでれんらくんを開く',
      'ブラウザの通知許可をONにする',
      'アプリ内「通知を有効化/再同期」を押す'
    ],
    notifyGuidePlatformPC: [
      'Chrome/Edgeなど対応ブラウザでれんらくんを開く',
      'ブラウザの通知許可をONにする',
      'アプリ内「通知を有効化/再同期」を押す'
    ],
    notifyGuidePlatformNote: 'OS・ブラウザにより表示名や手順が異なる場合があります。',
    notifyGuideBehaviorTitle: '通知の届き方',
    notifyGuideBehaviorPoints: [
      '新しい依頼: 同じグループの通知ONメンバー（送信者以外）に届きます。',
      '対応中/完了: 依頼を送った人に届きます。',
      '「参加中メンバー」で通知OK/通知未設定を確認できます。'
    ],
    notifyGuideUnsupported:
      'このブラウザでは通知機能を利用できません。対応ブラウザまたはホーム画面アプリで利用してください。',
    pushSupportBestEffortNote:
      '通知はスマホ利用が最も安定し、iOSはホーム画面アプリが必須です。PCはブラウザ/OS設定により動作が変わる場合があります。',
    pushSupportUnsupportedNote:
      'この環境では通知を利用できません。スマホのホーム画面アプリ、または対応ブラウザでお試しください。',
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
    requestOwnVisitSuffix: 'に行きたいと依頼しました',
    requestOtherVisitSuffix: 'に行きたいと言っています',
    ack: '対応する',
    complete: '完了',
    intentBuy: '買ってほしい',
    intentVisit: '行きたい',
    adminTitle: 'グループ専用アイテムの追加',
    adminLead: 'このグループを作成した人のみ、タブ・アイテム・場所を追加/管理できます。',
    newTab: '新しいタブ名',
    newTabPlaceholder: '例: 日用品',
    addTab: 'タブを追加',
    itemTargetTab: '追加先のタブ',
    newItem: '新しいアイテム名',
    newItemPlaceholder: '例: 食洗機用洗剤',
    addItem: 'アイテムを追加',
    customTabsSection: '追加したタブの削除',
    customItemsSection: '追加したアイテムの削除',
    customStoresSection: '追加した場所の削除',
    noCustomTabs: '削除できるタブはありません',
    noCustomItems: 'このタブに削除できるアイテムはありません',
    noCustomStores: '削除できる場所はありません',
    newStore: '新しい場所名',
    newStorePlaceholder: '例: コストコ',
    addStore: '場所を追加',
    deleteAction: '削除',
    deleteCancel: '取り消し',
    deleteConfirm: '削除する',
    deleteModalTitle: '削除の確認',
    deleteModalBodyTab: (name) => `タブ「${name}」を削除します。よろしいですか？`,
    deleteModalBodyItem: (name) => `アイテム「${name}」を削除します。よろしいですか？`,
    cartTitle: 'カート',
    cartEmpty: 'アイテムがありません',
    cartHintBuy: '必要なものを追加して送信してください。',
    cartHintVisit: '行きたい場所を1つ選んで送信してください。',
    cartStoreLabel: '場所',
    cartClearStore: '解除',
    addToCartLabel: '追加',
    removeFromCartLabel: '減らす',
    sendRequest: '依頼を送信する',
    languageSwitch: 'English',
    toastGroupCreated: 'グループを作成しました。招待リンクを共有してください。',
    toastGroupJoined: 'グループに参加しました。',
    toastPushEnabled: '通知を有効化しました。',
    toastInviteCopied: '招待リンクをコピーしました。',
    defaultStatus: 'タブを選んで、必要なものを追加してください。',
    statusRequested: '依頼中',
    statusAcknowledged: '対応中',
    statusCompleted: '完了',
    requestSentFallback: '依頼を送信しました。',
    errors: {
      quotaReached: '無料枠の上限に達しました。00:00 JST に自動復帰します。',
      profileRequired: '表示名と合言葉は必須です。',
      inviteRequired: '参加には招待リンクまたはトークンが必要です。',
      invalidSession: 'セッションが無効です。もう一度参加してください。',
      loadFailed: 'データを読み込めませんでした。更新して再度お試しください。',
      groupFailed: 'グループ操作に失敗しました',
      vapidMissing: 'VITE_VAPID_PUBLIC_KEY が未設定です。',
      pushFailed: '通知の設定に失敗しました',
      cartEmpty: 'カートが空です。',
      sendFailed: '依頼の送信に失敗しました',
      visitStoreRequired: '行きたい依頼には場所の選択が必要です。',
      ackFailed: '対応中への更新に失敗しました',
      completeFailed: '完了への更新に失敗しました',
      addTabFailed: 'タブ追加に失敗しました',
      addItemFailed: 'アイテム追加に失敗しました',
      addStoreFailed: '場所追加に失敗しました',
      clipboardFailed: 'クリップボードへのコピーに失敗しました。',
      deleteTabFailed: 'タブ削除に失敗しました',
      deleteItemFailed: 'アイテム削除に失敗しました',
      tabInUse: 'このタブは過去の依頼で使われているため削除できません。',
      itemInUse: 'このアイテムは過去の依頼で使われているため削除できません。'
    },
    statusTexts: {
      groupCreated: 'グループを作成しました。招待リンクを共有してください。',
      groupJoined: 'グループに参加しました。',
      pushEnabled: '通知を有効化しました。',
      tabAdded: (name) => `タブを追加しました: ${name}`,
      itemAdded: (name) => `アイテムを追加しました: ${name}`,
      storeAdded: (name) => `場所を追加しました: ${name}`,
      tabDeleted: (name) => `タブを削除しました: ${name}`,
      itemDeleted: (name) => `アイテムを削除しました: ${name}`,
      storeDeleted: (name) => `場所を削除しました: ${name}`,
      inviteLinkCopied: '招待リンクをコピーしました。'
    }
  },
  en: {
    locale: 'en-US',
    appTitle: 'renrakun',
    heroKicker: 'Tap. Notify. Done.',
    onboardingLead: 'Use a dedicated touch-panel UI to quickly share household "Need to buy / Want to visit" requests.',
    createMode: 'Create Group',
    joinMode: 'Join Group',
    displayName: 'Display name',
    defaultDisplayName: 'Guest',
    passphrase: 'Passphrase',
    passphrasePlaceholder: 'e.g. secret123',
    passphraseHint: '6+ characters (Japanese or alphanumeric)',
    inviteToken: 'Invite link or token',
    inviteTokenPlaceholder: 'e.g. https://.../?invite=... or token',
    inviteEntryTitle: 'Join from invite link',
    inviteEntryLead: 'Enter your display name and passphrase to join this group.',
    switchToManualJoin: 'Switch to manual token input',
    iosInviteContextTitle: 'When joining on iPhone',
    iosInviteContextBody:
      'Safari and the Home Screen app are handled separately. If you use the Home Screen app, copy the invite link or token and paste it into "Join Group".',
    createAction: 'Create group',
    joinAction: 'Join group',
    fixedCatalog: 'Built-in catalog',
    fixedCatalogLead: 'Regular operations are tap-only with no typing.',
    dashboardTitle: 'Household Restock Dashboard',
    hello: (name) => `Hello, ${name}`,
    enableNotifications: 'Enable notifications',
    resyncNotifications: 'Resync notifications',
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
    copyInviteToken: 'Copy token',
    inviteHybridHint: 'If the person you invite uses the iPhone Home Screen app, share the invite link or token and have them enter it in "Join Group".',
    membersTitle: 'Members in group',
    membersCount: (count) => `${count} members`,
    memberCreatorBadge: 'Creator',
    memberPushReady: 'Notifications OK',
    memberPushNotReady: 'Notifications off',
    memberYouSuffix: '(You)',
    memberResyncHint: 'If notifications do not arrive, tap "Resync notifications".',
    notifyGuideTitle: 'How to enable notifications',
    notifyGuideSummary:
      'On iOS, notifications work only from the Home Screen web app. On Android/PC, allow browser notifications, then tap "Enable notifications" or "Resync notifications" in the app.',
    notifyGuideDetailsTitle: 'View setup steps',
    notifyGuidePlatformIOS: [
      'Open renrakun in Safari',
      'Use Share menu -> "Add to Home Screen"',
      'Open from the Home Screen icon',
      'Tap "Enable notifications" in the app and allow notifications'
    ],
    notifyGuidePlatformAndroid: [
      'Open renrakun in your browser',
      'Allow browser notifications for this site',
      'Tap "Enable notifications" or "Resync notifications" in the app'
    ],
    notifyGuidePlatformPC: [
      'Open renrakun in a supported browser (for example Chrome/Edge)',
      'Allow browser notifications for this site',
      'Tap "Enable notifications" or "Resync notifications" in the app'
    ],
    notifyGuidePlatformNote: 'Exact labels and steps may vary by OS and browser.',
    notifyGuideBehaviorTitle: 'How notifications are delivered',
    notifyGuideBehaviorPoints: [
      'New request: sent to notification-enabled members in the same group (except the sender).',
      'In progress / Complete: sent to the person who originally sent the request.',
      'Use "Members in group" to check notification status.'
    ],
    notifyGuideUnsupported:
      'Notifications are not supported in this browser. Use a supported browser or a Home Screen app.',
    pushSupportBestEffortNote:
      'Notifications are most reliable on mobile, and iOS requires the Home Screen app. On PC, behavior depends on browser and OS settings.',
    pushSupportUnsupportedNote:
      'This environment cannot use notifications. Try a supported browser or the mobile Home Screen app.',
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
    requestOwnVisitSuffix: ' requested a visit.',
    requestOtherVisitSuffix: ' wants to visit.',
    ack: 'Acknowledge',
    complete: 'Complete',
    intentBuy: 'Need to buy',
    intentVisit: 'Want to visit',
    adminTitle: 'Add group-only items',
    adminLead: 'Only the person who created this group can add and manage tabs, items, and places.',
    newTab: 'New tab name',
    newTabPlaceholder: 'e.g. Household',
    addTab: 'Add tab',
    itemTargetTab: 'Tab to add into',
    newItem: 'New item name',
    newItemPlaceholder: 'e.g. Dishwasher detergent',
    addItem: 'Add item',
    customTabsSection: 'Delete added tabs',
    customItemsSection: 'Delete added items',
    customStoresSection: 'Delete added places',
    noCustomTabs: 'No added tabs to delete',
    noCustomItems: 'No added items in this tab',
    noCustomStores: 'No added places to delete',
    newStore: 'New place name',
    newStorePlaceholder: 'e.g. Costco',
    addStore: 'Add place',
    deleteAction: 'Delete',
    deleteCancel: 'Cancel',
    deleteConfirm: 'Delete',
    deleteModalTitle: 'Confirm deletion',
    deleteModalBodyTab: (name) => `Delete tab "${name}"?`,
    deleteModalBodyItem: (name) => `Delete item "${name}"?`,
    cartTitle: 'Cart',
    cartEmpty: 'No items',
    cartHintBuy: 'Add items and send your request.',
    cartHintVisit: 'Select one place and send your visit request.',
    cartStoreLabel: 'Place',
    cartClearStore: 'Clear',
    addToCartLabel: 'Add',
    removeFromCartLabel: 'Decrease',
    sendRequest: 'Send request',
    languageSwitch: '日本語',
    toastGroupCreated: 'Group created. Share the invite link.',
    toastGroupJoined: 'Joined the group.',
    toastPushEnabled: 'Notifications enabled.',
    toastInviteCopied: 'Invite link copied.',
    defaultStatus: 'Select a tab and tap items to add them.',
    statusRequested: 'Requested',
    statusAcknowledged: 'In progress',
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
      visitStoreRequired: 'Select a place for a visit request.',
      ackFailed: 'Failed to update status to acknowledged',
      completeFailed: 'Failed to update status to completed',
      addTabFailed: 'Failed to add custom tab',
      addItemFailed: 'Failed to add custom item',
      addStoreFailed: 'Failed to add custom place',
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
      storeAdded: (name) => `Added place: ${name}`,
      tabDeleted: (name) => `Deleted tab: ${name}`,
      itemDeleted: (name) => `Deleted item: ${name}`,
      storeDeleted: (name) => `Deleted place: ${name}`,
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

function isIosBrowserEnv(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const maxTouchPoints = navigator.maxTouchPoints || 0
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)
}

function isStandaloneEnv(): boolean {
  if (typeof window === 'undefined') return false
  const navStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const mediaStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  return navStandalone || mediaStandalone
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
  const [requestIntent, setRequestIntent] = useState<RequestIntent>('buy')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [joinMode, setJoinMode] = useState<JoinMode>('create')
  const [displayName, setDisplayName] = useState(() => MESSAGES[getInitialLanguage()].defaultDisplayName)
  const [passphrase, setPassphrase] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [customTabName, setCustomTabName] = useState('')
  const [customItemName, setCustomItemName] = useState('')
  const [customStoreName, setCustomStoreName] = useState('')
  const [customItemTabId, setCustomItemTabId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [actionToast, setActionToast] = useState('')
  const [errorText, setErrorText] = useState('')
  const [lastLoadErrorCode, setLastLoadErrorCode] = useState('')
  const [quotaResumeAt, setQuotaResumeAt] = useState<string | null>(null)
  const [inviteFromLink, setInviteFromLink] = useState(false)
  const [showManualJoinInput, setShowManualJoinInput] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    () => {
      if (typeof window === 'undefined') return 'unsupported'
      const supportsPush =
        'Notification' in window &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        window.isSecureContext
      return supportsPush ? Notification.permission : 'unsupported'
    }
  )
  const [isLoading, setIsLoading] = useState(false)
  const lastSyncedMemberIdRef = useRef<string | null>(null)
  const autoSyncInFlightRef = useRef(false)
  const lastAutoSyncAtRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)

  const auth = useMemo(
    () => (session ? { deviceId, memberId: session.memberId } : null),
    [deviceId, session]
  )
  const pushCapability = useMemo<'supported' | 'unsupported'>(() => {
    if (typeof window === 'undefined') return 'unsupported'
    const supportsPush =
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      window.isSecureContext
    return supportsPush ? 'supported' : 'unsupported'
  }, [])
  const isIosBrowser = useMemo(() => isIosBrowserEnv(), [])
  const isStandalone = useMemo(() => isStandaloneEnv(), [])

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

  const runAutoSyncRefresh = useCallback(
    async (reason: string) => {
      if (!session || !auth) return
      if (autoSyncInFlightRef.current) return
      if (isLoading) return

      const now = Date.now()
      if (now - lastAutoSyncAtRef.current < AUTO_SYNC_MIN_INTERVAL_MS) return

      autoSyncInFlightRef.current = true
      lastAutoSyncAtRef.current = now
      try {
        console.info('[auto-sync] refresh requested', { reason })
        await loadPrivateData()
      } finally {
        autoSyncInFlightRef.current = false
      }
    },
    [auth, isLoading, loadPrivateData, session]
  )

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
    setDisplayName((current) => {
      const isLegacyDefault = current === MESSAGES.ja.defaultDisplayName || current === MESSAGES.en.defaultDisplayName
      return isLegacyDefault ? messages.defaultDisplayName : current
    })
  }, [messages.defaultDisplayName])

  useEffect(() => {
    if (!session) return
    void loadPrivateData()
  }, [loadPrivateData, session])

  useEffect(() => {
    if (session) return
    autoSyncInFlightRef.current = false
    lastAutoSyncAtRef.current = 0
  }, [session])

  useEffect(() => {
    if (!session || !('serviceWorker' in navigator)) return

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as Partial<SwRefreshMessage> | undefined
      if (!data || data.type !== 'REFRESH_DATA') return
      void runAutoSyncRefresh(data.reason ?? 'sw-message')
    }

    navigator.serviceWorker.addEventListener('message', handleSwMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage)
    }
  }, [runAutoSyncRefresh, session])

  useEffect(() => {
    if (!session || typeof window === 'undefined' || typeof document === 'undefined') return

    let intervalId: number | null = null

    const startVisiblePolling = () => {
      if (intervalId !== null || document.visibilityState !== 'visible') return
      intervalId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return
        void runAutoSyncRefresh('visible-polling')
      }, AUTO_SYNC_POLL_INTERVAL_MS)
    }

    const stopVisiblePolling = () => {
      if (intervalId === null) return
      window.clearInterval(intervalId)
      intervalId = null
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runAutoSyncRefresh('visibilitychange')
        startVisiblePolling()
        return
      }
      stopVisiblePolling()
    }

    const handleFocus = () => {
      void runAutoSyncRefresh('focus')
    }

    const handleOnline = () => {
      void runAutoSyncRefresh('online')
    }

    startVisiblePolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)

    return () => {
      stopVisiblePolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
    }
  }, [runAutoSyncRefresh, session])

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
  const customStores = useMemo(
    () => storeButtons.filter((store) => !store.isSystem && (!session || store.groupId === session.groupId)),
    [session, storeButtons]
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
  const storeMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const store of storeButtons) {
      map.set(store.id, store.name)
    }
    return map
  }, [storeButtons])

  useEffect(() => {
    if (!selectedStoreId) return
    if (!storeButtons.some((store) => store.id === selectedStoreId)) {
      setSelectedStoreId(undefined)
    }
  }, [selectedStoreId, storeButtons])

  const cartEntries = useMemo(() => Object.entries(cart).filter(([, qty]) => qty > 0), [cart])
  const cartCount = useMemo(() => cartEntries.reduce((sum, [, qty]) => sum + qty, 0), [cartEntries])
  const selectedStoreName = selectedStoreId ? storeMap.get(selectedStoreId) : undefined
  const visibleInbox = useMemo(
    () => (inboxFilter === 'all' ? inbox : inbox.filter((event) => event.status !== 'completed')),
    [inbox, inboxFilter]
  )
  const inviteLink = useMemo(
    () => (session?.inviteToken ? buildInviteUrl(session.inviteToken) : ''),
    [session?.inviteToken]
  )
  const showInviteOnlyJoin = inviteFromLink && !showManualJoinInput
  const shouldShowIosInviteNotice = !session && showInviteOnlyJoin && isIosBrowser && !isStandalone
  const inviteCopyLabel = messages.copyInviteLink || (language === 'ja' ? '招待リンクをコピー' : 'Copy invite link')
  const inviteTokenCopyLabel = messages.copyInviteToken || (language === 'ja' ? 'トークンをコピー' : 'Copy token')
  const inviteHybridHint =
    messages.inviteHybridHint ||
    (language === 'ja'
      ? '招待相手がiPhoneでホーム画面アプリを使う場合は、招待リンクまたはトークンを共有し、「グループ参加」で入力してもらってください。'
      : 'If the person you invite uses the iPhone Home Screen app, share the invite link or token and have them enter it in "Join Group".')
  const iosInviteContextTitle =
    messages.iosInviteContextTitle || (language === 'ja' ? 'iPhoneで参加する場合' : 'When joining on iPhone')
  const iosInviteContextBody =
    messages.iosInviteContextBody ||
    (language === 'ja'
      ? 'Safariで開いた画面とホーム画面アプリは別扱いです。ホーム画面アプリで使う場合は、招待リンクまたはトークンをコピーして「グループ参加」に貼り付けてください。'
      : 'Safari and the Home Screen app are handled separately. If you use the Home Screen app, copy the invite link or token and paste it into "Join Group".')
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
  const notifyGuideTitle = messages.notifyGuideTitle || (language === 'ja' ? '通知の使い方' : 'How to enable notifications')
  const notifyGuideSummary =
    messages.notifyGuideSummary ||
    (language === 'ja'
      ? 'iOSはホーム画面に追加したWebアプリからのみ通知を有効化できます。Android/PCはブラウザの通知許可をONにして、アプリ内「通知を有効化/再同期」を押してください。'
      : 'On iOS, notifications work only from the Home Screen web app. On Android/PC, allow browser notifications, then tap "Enable notifications" or "Resync notifications" in the app.')
  const notifyGuideDetailsTitle = messages.notifyGuideDetailsTitle || (language === 'ja' ? '詳しい手順を見る' : 'View setup steps')
  const notifyGuidePlatformIOS = messages.notifyGuidePlatformIOS || [
    language === 'ja' ? 'Safariでれんらくんを開く' : 'Open renrakun in Safari',
    language === 'ja' ? '共有メニューから「ホーム画面に追加」を選ぶ' : 'Use Share menu -> "Add to Home Screen"',
    language === 'ja' ? 'ホーム画面のアイコンから開く' : 'Open from the Home Screen icon',
    language === 'ja' ? 'アプリ内「通知を有効化」を押して許可する' : 'Tap "Enable notifications" in the app and allow notifications'
  ]
  const notifyGuidePlatformAndroid = messages.notifyGuidePlatformAndroid || [
    language === 'ja' ? 'ブラウザでれんらくんを開く' : 'Open renrakun in your browser',
    language === 'ja'
      ? 'ブラウザの通知許可をONにする'
      : 'Allow browser notifications for this site',
    language === 'ja'
      ? 'アプリ内「通知を有効化/再同期」を押す'
      : 'Tap "Enable notifications" or "Resync notifications" in the app'
  ]
  const notifyGuidePlatformPC = messages.notifyGuidePlatformPC || [
    language === 'ja'
      ? 'Chrome/Edgeなど対応ブラウザでれんらくんを開く'
      : 'Open renrakun in a supported browser (for example Chrome/Edge)',
    language === 'ja' ? 'ブラウザの通知許可をONにする' : 'Allow browser notifications for this site',
    language === 'ja'
      ? 'アプリ内「通知を有効化/再同期」を押す'
      : 'Tap "Enable notifications" or "Resync notifications" in the app'
  ]
  const notifyGuidePlatformNote =
    messages.notifyGuidePlatformNote ||
    (language === 'ja'
      ? 'OS・ブラウザにより表示名や手順が異なる場合があります。'
      : 'Exact labels and steps may vary by OS and browser.')
  const notifyGuideBehaviorTitle =
    messages.notifyGuideBehaviorTitle || (language === 'ja' ? '通知の届き方' : 'How notifications are delivered')
  const notifyGuideBehaviorPoints = messages.notifyGuideBehaviorPoints || [
    language === 'ja'
      ? '新しい依頼: 同じグループの通知ONメンバー（送信者以外）に届きます。'
      : 'New request: sent to notification-enabled members in the same group (except the sender).',
    language === 'ja'
      ? '対応中/完了: 依頼を送った人に届きます。'
      : 'In progress / Complete: sent to the person who originally sent the request.',
    language === 'ja'
      ? '「参加中メンバー」で通知OK/通知未設定を確認できます。'
      : 'Use "Members in group" to check notification status.'
  ]
  const notifyGuideUnsupported =
    messages.notifyGuideUnsupported ||
    (language === 'ja'
      ? 'このブラウザでは通知機能を利用できません。対応ブラウザまたはホーム画面アプリで利用してください。'
      : 'Notifications are not supported in this browser. Use a supported browser or a Home Screen app.')
  const pushSupportBestEffortNote =
    messages.pushSupportBestEffortNote ||
    (language === 'ja'
      ? '通知はスマホ利用が最も安定し、iOSはホーム画面アプリが必須です。PCはブラウザ/OS設定により動作が変わる場合があります。'
      : 'Notifications are most reliable on mobile, and iOS requires the Home Screen app. On PC, behavior depends on browser and OS settings.')
  const pushSupportUnsupportedNote =
    messages.pushSupportUnsupportedNote ||
    (language === 'ja'
      ? 'この環境では通知を利用できません。スマホのホーム画面アプリ、または対応ブラウザでお試しください。'
      : 'This environment cannot use notifications. Try a supported browser or the mobile Home Screen app.')
  const intentBuyLabel = messages.intentBuy || (language === 'ja' ? '買ってほしい' : 'Need to buy')
  const intentVisitLabel = messages.intentVisit || (language === 'ja' ? '行きたい' : 'Want to visit')
  const isVisitIntent = requestIntent === 'visit'
  const customStoresSection =
    messages.customStoresSection || (language === 'ja' ? '追加した場所の削除' : 'Delete added places')
  const noCustomStores =
    messages.noCustomStores || (language === 'ja' ? '削除できる場所はありません' : 'No added places to delete')
  const newStoreLabel = messages.newStore || (language === 'ja' ? '新しい場所名' : 'New place name')
  const newStorePlaceholder =
    messages.newStorePlaceholder || (language === 'ja' ? '例: コストコ' : 'e.g. Costco')
  const addStoreLabel = messages.addStore || (language === 'ja' ? '場所を追加' : 'Add place')
  const cartStoreLabel = messages.cartStoreLabel || (language === 'ja' ? '場所' : 'Place')
  const cartClearStoreLabel = messages.cartClearStore || (language === 'ja' ? '解除' : 'Clear')
  const addToCartLabel = messages.addToCartLabel || (language === 'ja' ? '追加' : 'Add')
  const removeFromCartLabel = messages.removeFromCartLabel || (language === 'ja' ? '減らす' : 'Decrease')
  const cartHint =
    isVisitIntent
      ? (messages.cartHintVisit ?? (language === 'ja' ? '行きたい場所を1つ選んで送信してください。' : 'Select one place and send your visit request.'))
      : (messages.cartHintBuy ?? (language === 'ja' ? '必要なものを追加して送信してください。' : 'Add items and send your request.'))
  const itemButtonsDisabled = isVisitIntent
  const visitModeItemDisabledHint =
    language === 'ja'
      ? '「行きたい」ではアイテムを追加できません。行きたい場所を選択してください。'
      : 'Item add is disabled in "Want to visit". Select a place.'
  const visitStoreRequiredMessage =
    language === 'ja'
      ? '行きたい依頼には場所の選択が必要です。'
      : 'Select a place for a visit request.'
  const showActionToast = useCallback((message: string) => {
    if (!message.trim()) return
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    setActionToast(message)
    toastTimerRef.current = window.setTimeout(() => {
      setActionToast('')
      toastTimerRef.current = null
    }, 2800)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (pushCapability === 'supported') return
    setNotificationPermission('unsupported')
  }, [pushCapability])

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
        showActionToast(
          messages.toastGroupCreated ?? messages.statusTexts.groupCreated
        )
      } else {
        const normalizedInvite = normalizeInviteInput(inviteToken)
        if (!normalizedInvite) {
          setErrorText(messages.errors.inviteRequired)
          return
        }
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
        showActionToast(
          messages.toastGroupJoined ?? messages.statusTexts.groupJoined
        )
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
    messages.toastGroupCreated,
    messages.toastGroupJoined,
    passphrase,
    showActionToast
  ])

  const handleEnablePush = useCallback(async () => {
    if (!session || !auth) return
    if (pushCapability === 'unsupported') {
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
      showActionToast(messages.toastPushEnabled ?? messages.statusTexts.pushEnabled)
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
    messages.toastPushEnabled,
    session,
    pushCapability,
    showActionToast
  ])

  const syncPushSubscription = useCallback(async () => {
    if (!session || !auth) return
    if (pushCapability === 'unsupported') return
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
  }, [auth, loadPrivateData, notificationPermission, pushCapability, session])

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

  const handleToggleStore = useCallback((storeId: string) => {
    setSelectedStoreId((current) => (current === storeId ? undefined : storeId))
  }, [])

  const handleClearStoreFromCart = useCallback(() => {
    setSelectedStoreId(undefined)
  }, [])

  const switchIntent = useCallback((nextIntent: RequestIntent) => {
    setErrorText((current) => {
      if (!current) return current
      const visitRequiredText = messages.errors.visitStoreRequired ?? visitStoreRequiredMessage
      if (current === visitRequiredText || current === messages.errors.cartEmpty) {
        return ''
      }
      return current
    })
    if (nextIntent === requestIntent) return
    if (requestIntent === 'buy' && nextIntent === 'visit') {
      setCart({})
    }
    setRequestIntent(nextIntent)
  }, [messages.errors.cartEmpty, messages.errors.visitStoreRequired, requestIntent, visitStoreRequiredMessage])

  const handleSwitchToBuy = useCallback(() => {
    switchIntent('buy')
  }, [switchIntent])

  const handleSwitchToVisit = useCallback(() => {
    switchIntent('visit')
  }, [switchIntent])

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
    if (requestIntent === 'buy' && cartEntries.length === 0) {
      setErrorText(messages.errors.cartEmpty)
      return
    }
    if (requestIntent === 'visit' && !selectedStoreId) {
      setErrorText(visitStoreRequiredMessage)
      return
    }

    setIsLoading(true)
    setErrorText('')
    try {
      const itemIds =
        requestIntent === 'buy'
          ? cartEntries.flatMap(([itemId, qty]) => new Array(qty).fill(itemId))
          : []
      const result = await sendRequest(auth, {
        groupId: session.groupId,
        senderMemberId: session.memberId,
        storeId: selectedStoreId,
        itemIds,
        intent: requestIntent
      })
      showActionToast(result.pushMessage || messages.requestSentFallback)
      setCart({})
      setSelectedStoreId(undefined)
      setRequestIntent('buy')
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
    loadPrivateData,
    messages.errors.cartEmpty,
    messages.errors.sendFailed,
    messages.requestSentFallback,
    requestIntent,
    selectedStoreId,
    session,
    showActionToast,
    visitStoreRequiredMessage
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
      showActionToast(messages.statusTexts.tabAdded(created.name))
      await loadPrivateData()
      setActiveTabId(created.id)
    } catch (error) {
      applyError(error, messages.errors.addTabFailed)
    }
  }, [applyError, auth, customTabName, loadPrivateData, messages.errors.addTabFailed, messages.statusTexts, session, showActionToast])

  const handleCreateCustomItem = useCallback(async () => {
    if (!session || !auth || !customItemName.trim() || !customItemTabId) return
    try {
      const created = await createCustomItem(session.groupId, auth, {
        tabId: customItemTabId,
        name: customItemName.trim()
      })
      setCustomItemName('')
      showActionToast(messages.statusTexts.itemAdded(created.name))
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
    session,
    showActionToast
  ])

  const handleCreateCustomStore = useCallback(async () => {
    if (!session || !auth || !customStoreName.trim()) return
    try {
      const created = await createCustomStore(session.groupId, auth, { name: customStoreName.trim() })
      setCustomStoreName('')
      showActionToast(
        messages.statusTexts.storeAdded
          ? messages.statusTexts.storeAdded(created.name)
          : language === 'ja'
            ? `場所「${created.name}」を追加しました。`
            : `Added place: ${created.name}`
      )
      await loadPrivateData()
      setSelectedStoreId(created.id)
    } catch (error) {
      applyError(error, messages.errors.addStoreFailed ?? messages.errors.addItemFailed)
    }
  }, [
    applyError,
    auth,
    customStoreName,
    language,
    loadPrivateData,
    messages.errors.addItemFailed,
    messages.errors.addStoreFailed,
    messages.statusTexts,
    session,
    showActionToast
  ])

  const openDeleteModal = useCallback((kind: DeleteTargetKind, target: CatalogTab | CatalogItem | StoreButton) => {
    setDeleteTarget({ kind, id: target.id, name: target.name })
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || !session || !auth) return

    try {
      if (deleteTarget.kind === 'tab') {
        await deleteCustomTab(session.groupId, deleteTarget.id, auth)
        showActionToast(messages.statusTexts.tabDeleted(deleteTarget.name))
      } else if (deleteTarget.kind === 'item') {
        await deleteCustomItem(session.groupId, deleteTarget.id, auth)
        showActionToast(messages.statusTexts.itemDeleted(deleteTarget.name))
      } else {
        await deleteCustomStore(session.groupId, deleteTarget.id, auth)
        showActionToast(
          messages.statusTexts.storeDeleted
            ? messages.statusTexts.storeDeleted(deleteTarget.name)
            : language === 'ja'
              ? `場所「${deleteTarget.name}」を削除しました。`
              : `Deleted place: ${deleteTarget.name}`
        )
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
        deleteTarget.kind === 'tab'
          ? messages.errors.deleteTabFailed
          : deleteTarget.kind === 'item'
            ? messages.errors.deleteItemFailed
            : messages.errors.deleteItemFailed
      )
    }
  }, [
    applyError,
    auth,
    deleteTarget,
    language,
    loadPrivateData,
    messages.errors.deleteItemFailed,
    messages.errors.deleteTabFailed,
    messages.errors.itemInUse,
    messages.errors.tabInUse,
    messages.statusTexts,
    session,
    showActionToast
  ])

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      showActionToast(messages.toastInviteCopied ?? messages.statusTexts.inviteLinkCopied)
    } catch {
      setErrorText(messages.errors.clipboardFailed)
    }
  }, [inviteLink, messages.errors.clipboardFailed, messages.statusTexts.inviteLinkCopied, messages.toastInviteCopied, showActionToast])

  const handleCopyInviteToken = useCallback(
    async (rawValue: string | undefined) => {
      if (!rawValue) return
      const token = normalizeInviteInput(rawValue)
      if (!token) return
      try {
        await navigator.clipboard.writeText(token)
        showActionToast(language === 'ja' ? '招待トークンをコピーしました。' : 'Invite token copied.')
      } catch {
        setErrorText(messages.errors.clipboardFailed)
      }
    },
    [language, messages.errors.clipboardFailed, showActionToast]
  )

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
          {isIosBrowser && (
            <p className="sub-text onboarding-platform-note">
              {language === 'ja'
                ? 'iPhoneでプッシュ通知を使う場合は、先に「ホーム画面に追加」したアプリ側から参加・利用してください。'
                : 'To use push notifications on iPhone, add renrakun to Home Screen first, then join/use it from that app.'}
            </p>
          )}
        </header>

        <section className="card onboarding-card">
          {showInviteOnlyJoin ? (
            <>
              <h2>{messages.inviteEntryTitle}</h2>
              <p className="sub-text">{messages.inviteEntryLead}</p>
              {shouldShowIosInviteNotice && (
                <aside className="ios-invite-context">
                  <strong>{iosInviteContextTitle}</strong>
                  <p>{iosInviteContextBody}</p>
                  <button
                    type="button"
                    className="inline-text-button"
                    onClick={() => void handleCopyInviteToken(inviteToken)}
                  >
                    {inviteTokenCopyLabel}
                  </button>
                </aside>
              )}

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
          {pushCapability === 'supported' && (
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
              setRequestIntent('buy')
              setPassphrase('')
              setInviteToken('')
              setJoinMode('create')
              setInviteFromLink(false)
              setShowManualJoinInput(false)
              setLastLoadErrorCode('')
              setActionToast('')
              lastSyncedMemberIdRef.current = null
            }}
          >
            {messages.leaveGroup}
          </button>
        </div>
      </header>

      {actionToast && (
        <div className="action-toast" role="status" aria-live="polite">
          {actionToast}
        </div>
      )}

      {quotaResumeAt && (
        <aside className="quota-banner">{messages.quotaPaused(formatTime(quotaResumeAt, messages.locale))}</aside>
      )}

      <aside className="notification-guide" aria-live="polite">
        <strong>{notifyGuideTitle}</strong>
        <p>{pushCapability === 'unsupported' ? notifyGuideUnsupported : notifyGuideSummary}</p>
        <p className="sub-text notify-guide-support">
          {pushCapability === 'unsupported' ? pushSupportUnsupportedNote : pushSupportBestEffortNote}
        </p>
        <details>
          <summary>{notifyGuideDetailsTitle}</summary>
          <div className="notify-guide-grid">
            <section>
              <h3>iOS</h3>
              <ul>
                {notifyGuidePlatformIOS.map((step) => (
                  <li key={`ios-${step}`}>{step}</li>
                ))}
              </ul>
            </section>
          </div>
          <p className="sub-text notify-guide-note">{notifyGuidePlatformNote}</p>
          <h4>{notifyGuideBehaviorTitle}</h4>
          <ul>
            {notifyGuideBehaviorPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </details>
      </aside>

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
          <div className="invite-actions">
            <button type="button" onClick={handleCopyInviteLink}>
              {inviteCopyLabel}
            </button>
            {session.inviteToken && (
              <button type="button" onClick={() => void handleCopyInviteToken(session.inviteToken)}>
                {inviteTokenCopyLabel}
              </button>
            )}
          </div>
          {isIosBrowser && <p className="sub-text invite-hybrid-hint">{inviteHybridHint}</p>}
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
                      className={`item-button${itemButtonsDisabled ? ' disabled' : ''}`}
                      disabled={itemButtonsDisabled}
                      onClick={() => handleAddToCart(item.id)}
                    >
                      <span className="item-name">{item.name}</span>
                      <span className="item-add">
                        <span aria-hidden="true">＋</span>
                        {addToCartLabel}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="sub-text mode-hint" aria-live="polite">
                  {itemButtonsDisabled ? visitModeItemDisabledHint : ''}
                </p>

                <div className="store-row">
                  {storeButtons.map((store) => (
                    <button
                      key={store.id}
                      type="button"
                      className={selectedStoreId === store.id ? 'selected' : ''}
                      onClick={() => handleToggleStore(store.id)}
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
                <label>
                  {newStoreLabel}
                  <input
                    value={customStoreName}
                    onChange={(event) => setCustomStoreName(event.target.value)}
                    placeholder={newStorePlaceholder}
                    maxLength={30}
                  />
                </label>
                <button
                  type="button"
                  className="admin-action-button"
                  onClick={() => void handleCreateCustomStore()}
                  disabled={!customStoreName.trim()}
                >
                  {addStoreLabel}
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
              <div className="admin-form">
                <h3>{customStoresSection}</h3>
                {customStores.length === 0 ? (
                  <p className="empty">{noCustomStores}</p>
                ) : (
                  <ul className="admin-list">
                    {customStores.map((store) => (
                      <li key={store.id}>
                        <span>{store.name}</span>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => openDeleteModal('store', store)}
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
                const isVisitIntent = event.intent === 'visit'
                const storePrefix =
                  !isVisitIntent && event.storeName
                    ? language === 'ja'
                      ? `${event.storeName}で`
                      : `at ${event.storeName} `
                    : ''
                const itemText = event.items
                  .map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name))
                  .join(language === 'ja' ? '・' : ', ')
                const requestSuffix = isVisitIntent
                  ? isOwnRequest
                    ? (messages.requestOwnVisitSuffix ?? (language === 'ja' ? 'に行きたいと依頼しました' : ' requested a visit.'))
                    : (messages.requestOtherVisitSuffix ?? (language === 'ja' ? 'に行きたいと言っています' : ' wants to visit.'))
                  : isOwnRequest
                    ? messages.requestOwnSuffix
                    : messages.requestOtherSuffix
                const requestSubject = isVisitIntent
                  ? (event.storeName ?? (language === 'ja' ? '場所' : 'a place'))
                  : (itemText || (language === 'ja' ? '項目' : 'items'))
                const visitExtra =
                  isVisitIntent && itemText
                    ? language === 'ja'
                      ? `（${itemText}）`
                      : ` (${itemText})`
                    : ''
                return (
                  <li key={event.eventId} className="inbox-item">
                    <div className="inbox-top">
                      <strong>{actorLabel}</strong>
                      <span className={`status ${event.status}`}>{formatStatus(event.status, messages)}</span>
                    </div>
                    <p className="inbox-message">
                      {prefix}
                      {storePrefix}
                      {requestSubject}
                      {visitExtra}
                      {requestSuffix}
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
        <div className="intent-switch" role="group" aria-label="request-intent">
          <button
            type="button"
            className={requestIntent === 'buy' ? 'active' : ''}
            onClick={handleSwitchToBuy}
          >
            {intentBuyLabel}
          </button>
          <button
            type="button"
            className={requestIntent === 'visit' ? 'active' : ''}
            onClick={handleSwitchToVisit}
          >
            {intentVisitLabel}
          </button>
        </div>
        <div className="cart-header">
          <h3>
            {messages.cartTitle} ({cartCount})
          </h3>
          <p>{cartHint}</p>
        </div>
        {selectedStoreName && (
          <div className="cart-store-row">
            <button type="button" className="cart-store-pill" onClick={handleClearStoreFromCart}>
              <span>
                {cartStoreLabel}: {selectedStoreName}
              </span>
              <span className="cart-store-clear">{cartClearStoreLabel}</span>
            </button>
          </div>
        )}
        <div className="cart-items">
          {cartEntries.length === 0 && requestIntent === 'buy' && <span className="empty">{messages.cartEmpty}</span>}
          {cartEntries.map(([itemId, qty]) => (
            <div key={itemId} className="cart-pill">
              <span className="cart-pill-label">
                {itemMap.get(itemId) ?? itemId} x{qty}
              </span>
              <button
                type="button"
                className="cart-pill-minus"
                aria-label={removeFromCartLabel}
                onClick={() => handleDecreaseFromCart(itemId)}
              >
                −
              </button>
            </div>
          ))}
        </div>
        <button
          className="primary-button"
          onClick={() => void handleSendRequest()}
          disabled={(requestIntent === 'buy' ? cartEntries.length === 0 : !selectedStoreId) || isLoading}
        >
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
                : deleteTarget.kind === 'item'
                  ? messages.deleteModalBodyItem(deleteTarget.name)
                  : language === 'ja'
                    ? `場所「${deleteTarget.name}」を削除します。よろしいですか？`
                    : `Delete place "${deleteTarget.name}"?`}
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
