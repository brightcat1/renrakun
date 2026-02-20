import type {
  ApiError,
  CatalogItem,
  CatalogTab,
  GroupCreateResponse,
  GroupJoinResponse,
  InboxEvent,
  LayoutResponse,
  QuotaResponse,
  RequestCreateInput,
  StoreButton
} from '@renrakun/shared'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8787'
export type ApiLanguage = 'ja' | 'en'
let apiLanguage: ApiLanguage = 'ja'

export interface SessionAuth {
  deviceId: string
  memberId: string
}

export function setApiLanguage(lang: ApiLanguage): void {
  apiLanguage = lang
}

export class ApiClientError extends Error {
  status: number
  code: string
  resumeAt?: string
  detail?: unknown

  constructor(status: number, payload: Partial<ApiError> & { detail?: unknown }) {
    super(payload.message ?? 'API request failed')
    this.status = status
    this.code = payload.code ?? 'UNKNOWN_ERROR'
    this.resumeAt = payload.resumeAt
    this.detail = payload.detail
  }
}

async function apiFetch<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
    auth?: SessionAuth
  } = {}
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'x-app-lang': apiLanguage
  }

  if (options.auth) {
    headers['x-device-id'] = options.auth.deviceId
    headers['x-member-id'] = options.auth.memberId
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  if (!response.ok) {
    let payload: Partial<ApiError> & { detail?: unknown } = {}
    try {
      payload = (await response.json()) as Partial<ApiError> & { detail?: unknown }
    } catch {
      // Ignore parse failures and fallback to defaults.
    }
    throw new ApiClientError(response.status, payload)
  }

  return (await response.json()) as T
}

export function fetchCatalog(): Promise<LayoutResponse> {
  return apiFetch<LayoutResponse>('/api/catalog')
}

export function createGroup(input: {
  deviceId: string
  displayName: string
  passphrase: string
}): Promise<GroupCreateResponse> {
  return apiFetch<GroupCreateResponse>('/api/groups/create', {
    method: 'POST',
    body: input
  })
}

export function joinGroup(input: {
  inviteToken: string
  deviceId: string
  displayName: string
  passphrase: string
}): Promise<GroupJoinResponse> {
  return apiFetch<GroupJoinResponse>('/api/groups/join', {
    method: 'POST',
    body: input
  })
}

export function fetchLayout(groupId: string, auth: SessionAuth): Promise<LayoutResponse> {
  return apiFetch<LayoutResponse>(`/api/groups/${groupId}/layout`, { auth })
}

export function createCustomTab(
  groupId: string,
  auth: SessionAuth,
  input: { name: string }
): Promise<CatalogTab> {
  return apiFetch<CatalogTab>(`/api/groups/${groupId}/custom-tabs`, {
    method: 'POST',
    auth,
    body: input
  })
}

export function createCustomItem(
  groupId: string,
  auth: SessionAuth,
  input: { tabId: string; name: string }
): Promise<CatalogItem> {
  return apiFetch<CatalogItem>(`/api/groups/${groupId}/custom-items`, {
    method: 'POST',
    auth,
    body: input
  })
}

export function deleteCustomTab(groupId: string, tabId: string, auth: SessionAuth): Promise<{ ok: boolean }> {
  return apiFetch(`/api/groups/${groupId}/custom-tabs/${tabId}/delete`, {
    method: 'POST',
    auth
  })
}

export function deleteCustomItem(groupId: string, itemId: string, auth: SessionAuth): Promise<{ ok: boolean }> {
  return apiFetch(`/api/groups/${groupId}/custom-items/${itemId}/delete`, {
    method: 'POST',
    auth
  })
}

export function sendRequest(auth: SessionAuth, input: RequestCreateInput): Promise<{
  requestId: string
  pushMessage: string
}> {
  return apiFetch('/api/requests', {
    method: 'POST',
    auth,
    body: input
  })
}

export function fetchInbox(groupId: string, auth: SessionAuth): Promise<InboxEvent[]> {
  return apiFetch(`/api/requests/inbox?groupId=${encodeURIComponent(groupId)}`, { auth })
}

export function ackRequest(requestId: string, auth: SessionAuth): Promise<{ requestId: string; status: string }> {
  return apiFetch(`/api/requests/${requestId}/ack`, { method: 'POST', auth })
}

export function completeRequest(
  requestId: string,
  auth: SessionAuth
): Promise<{ requestId: string; status: string }> {
  return apiFetch(`/api/requests/${requestId}/complete`, { method: 'POST', auth })
}

export function subscribePush(
  groupId: string,
  memberId: string,
  auth: SessionAuth,
  subscription: PushSubscription
): Promise<{ ok: boolean }> {
  return apiFetch('/api/push/subscribe', {
    method: 'POST',
    auth,
    body: {
      groupId,
      memberId,
      subscription
    }
  })
}

export function fetchQuotaStatus(): Promise<QuotaResponse> {
  return apiFetch('/api/quota/status')
}

export type { CatalogItem, CatalogTab, InboxEvent, LayoutResponse, StoreButton }
