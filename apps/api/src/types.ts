import type { RequestStatus, Role } from '@renrakun/shared'

export interface Env {
  DB: D1Database
  QUOTA_GATE: DurableObjectNamespace
  DAILY_WRITE_LIMIT?: string
  DAILY_JOIN_CREATE_LIMIT_PER_ACTOR?: string
  COMPLETED_RETENTION_DAYS?: string
  MAINTENANCE_MAX_DELETE_PER_RUN?: string
  MAINTENANCE_MAX_BATCHES_PER_RUN?: string
  APP_ORIGIN: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export interface AuthedMember {
  id: string
  groupId: string
  displayName: string
  role: Role
}

export interface DbTab {
  id: string
  groupId: string | null
  name: string
  isSystem: number
  sortOrder: number
}

export interface DbItem {
  id: string
  tabId: string
  name: string
  isSystem: number
  sortOrder: number
}

export interface DbStore {
  id: string
  groupId: string | null
  name: string
  isSystem: number
  sortOrder: number
}

export interface DbRequestRow {
  eventId: string
  requestId: string
  status: RequestStatus
  senderMemberId: string
  senderName: string
  storeId: string | null
  storeName: string | null
  createdAt: string
  readAt: string | null
}

export interface DbRequestItemRow {
  requestId: string
  itemId: string
  name: string
  qty: number
}
