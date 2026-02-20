import { z } from 'zod'

export type Role = 'admin' | 'member'
export type RequestStatus = 'requested' | 'acknowledged' | 'completed'
export type QuotaState = 'open' | 'paused'

export interface CatalogTab {
  id: string
  groupId: string | null
  name: string
  isSystem: boolean
  sortOrder: number
}

export interface CatalogItem {
  id: string
  tabId: string
  name: string
  isSystem: boolean
  sortOrder: number
}

export interface StoreButton {
  id: string
  groupId: string | null
  name: string
  isSystem: boolean
  sortOrder: number
}

export interface RequestCreateInput {
  groupId: string
  senderMemberId: string
  storeId?: string
  itemIds: string[]
}

export interface ApiError {
  code: string
  message: string
  resumeAt?: string
}

export const createGroupSchema = z.object({
  deviceId: z.string().trim().min(8).max(120),
  displayName: z.string().trim().min(1).max(40),
  passphrase: z.string().trim().min(6).max(64)
})

export const joinGroupSchema = z.object({
  inviteToken: z.string().trim().min(8).max(120),
  deviceId: z.string().trim().min(8).max(120),
  displayName: z.string().trim().min(1).max(40),
  passphrase: z.string().trim().min(6).max(64)
})

export const createRequestSchema = z.object({
  groupId: z.string().min(1),
  senderMemberId: z.string().min(1),
  storeId: z.string().min(1).optional(),
  itemIds: z.array(z.string().min(1)).min(1).max(50)
})

export const createCustomTabSchema = z.object({
  name: z.string().trim().min(1).max(30)
})

export const createCustomItemSchema = z.object({
  tabId: z.string().min(1),
  name: z.string().trim().min(1).max(30)
})

export const pushSubscriptionSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1)
    })
  })
})

export interface GroupCreateResponse {
  groupId: string
  memberId: string
  role: Role
  inviteToken: string
}

export interface GroupJoinResponse {
  groupId: string
  memberId: string
  role: Role
}

export interface LayoutResponse {
  tabs: CatalogTab[]
  items: CatalogItem[]
  stores: StoreButton[]
}

export interface InboxEvent {
  eventId: string
  requestId: string
  status: RequestStatus
  senderName: string
  storeName: string | null
  items: Array<{ name: string; qty: number }>
  createdAt: string
  readAt: string | null
}

export interface QuotaResponse {
  state: QuotaState
  resumeAt: string
  count: number
  limit: number
}

export const SYSTEM_TABS: Array<Omit<CatalogTab, 'groupId'>> = [
  { id: 'sys-tab-detergent', name: '洗剤', isSystem: true, sortOrder: 10 },
  { id: 'sys-tab-washroom', name: '洗面', isSystem: true, sortOrder: 20 },
  { id: 'sys-tab-beauty', name: '美容', isSystem: true, sortOrder: 30 },
  { id: 'sys-tab-kitchen', name: 'キッチン', isSystem: true, sortOrder: 40 },
  { id: 'sys-tab-store', name: '店舗依頼', isSystem: true, sortOrder: 50 }
]

export const SYSTEM_ITEMS: CatalogItem[] = [
  {
    id: 'sys-item-detergent',
    tabId: 'sys-tab-detergent',
    name: '洗剤',
    isSystem: true,
    sortOrder: 10
  },
  {
    id: 'sys-item-refill',
    tabId: 'sys-tab-detergent',
    name: '詰替え',
    isSystem: true,
    sortOrder: 20
  },
  {
    id: 'sys-item-tissue',
    tabId: 'sys-tab-washroom',
    name: 'ティッシュ',
    isSystem: true,
    sortOrder: 10
  },
  {
    id: 'sys-item-toilet-paper',
    tabId: 'sys-tab-washroom',
    name: 'トイレットペーパー',
    isSystem: true,
    sortOrder: 20
  },
  {
    id: 'sys-item-hand-paper',
    tabId: 'sys-tab-washroom',
    name: 'ハンドペーパー',
    isSystem: true,
    sortOrder: 30
  },
  {
    id: 'sys-item-cotton',
    tabId: 'sys-tab-beauty',
    name: 'コットン',
    isSystem: true,
    sortOrder: 10
  },
  {
    id: 'sys-item-shampoo',
    tabId: 'sys-tab-beauty',
    name: 'シャンプー',
    isSystem: true,
    sortOrder: 20
  },
  {
    id: 'sys-item-conditioner',
    tabId: 'sys-tab-beauty',
    name: 'リンス',
    isSystem: true,
    sortOrder: 30
  },
  {
    id: 'sys-item-kitchen-paper',
    tabId: 'sys-tab-kitchen',
    name: 'キッチンペーパー',
    isSystem: true,
    sortOrder: 10
  },
  {
    id: 'sys-item-carrot',
    tabId: 'sys-tab-store',
    name: 'にんじん',
    isSystem: true,
    sortOrder: 10
  }
]

export const SYSTEM_STORES: StoreButton[] = [
  {
    id: 'sys-store-summit',
    groupId: null,
    name: 'サミット',
    isSystem: true,
    sortOrder: 10
  },
  {
    id: 'sys-store-nitori',
    groupId: null,
    name: 'ニトリ',
    isSystem: true,
    sortOrder: 20
  },
  {
    id: 'sys-store-ikea',
    groupId: null,
    name: 'IKEA',
    isSystem: true,
    sortOrder: 30
  },
  {
    id: 'sys-store-aeon',
    groupId: null,
    name: 'イオン',
    isSystem: true,
    sortOrder: 40
  },
  {
    id: 'sys-store-gyomu',
    groupId: null,
    name: '業務スーパー',
    isSystem: true,
    sortOrder: 50
  }
]
