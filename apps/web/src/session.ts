import type { Role } from '@renrakun/shared'

const DEVICE_ID_KEY = 'renrakun_device_id'
const SESSION_KEY = 'renrakun_session'

export interface AppSession {
  groupId: string
  memberId: string
  role: Role
  displayName: string
  inviteToken?: string
}

export function getOrCreateDeviceId(): string {
  const current = localStorage.getItem(DEVICE_ID_KEY)
  if (current) return current

  const generated = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, generated)
  return generated
}

export function readSession(): AppSession | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AppSession
  } catch {
    return null
  }
}

export function writeSession(session: AppSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}
