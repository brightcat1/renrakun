import type { RequestStatus, Role } from '@renrakun/shared'

export interface Env {
  DB: D1Database
  QUOTA_GATE: DurableObjectNamespace
  DAILY_WRITE_LIMIT?: string
  DAILY_JOIN_CREATE_LIMIT_PER_ACTOR?: string
  COMPLETED_RETENTION_DAYS?: string
  MAINTENANCE_MAX_DELETE_PER_RUN?: string
  MAINTENANCE_MAX_BATCHES_PER_RUN?: string
  UNUSED_GROUP_CANDIDATE_DAYS?: string
  UNUSED_GROUP_DELETE_GRACE_DAYS?: string
  MAINTENANCE_MAX_UNUSED_GROUPS_PER_RUN?: string
  MAINTENANCE_MAX_UNUSED_GROUP_BATCHES_PER_RUN?: string
  LOG_LEVEL?: string
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

export interface DbMemberPresence {
  id: string
  displayName: string
  role: Role
  pushReady: number
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

export interface DbPushPendingRow {
  id: string
  requestId: string
  kind: RequestStatus
  senderMemberId: string
  senderName: string
  storeName: string | null
  itemsSummary: string
  createdAt: string
}

export interface DbRequestItemNameRow {
  name: string
  qty: number
  sortOrder: number
}

export interface DbRequestStoreRow {
  storeId: string | null
  storeName: string | null
}
