import { importJWK, SignJWT } from 'jose'

interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export interface PushSubscriptionRecord {
  memberId: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushSendResult {
  ok: boolean
  status: number
  expired: boolean
}

function toBase64Url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) {
    text += String.fromCharCode(byte)
  }
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(normalized + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function parsePublicKey(publicKey: string): { x: string; y: string } {
  const raw = fromBase64Url(publicKey)
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error('VAPID public key must be uncompressed 65-byte EC point')
  }
  const x = toBase64Url(raw.slice(1, 33))
  const y = toBase64Url(raw.slice(33, 65))
  return { x, y }
}

async function createVapidJwt(endpoint: string, config: VapidConfig): Promise<string> {
  const { x, y } = parsePublicKey(config.publicKey)
  const d = toBase64Url(fromBase64Url(config.privateKey))

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x,
    y,
    d
  }

  const key = await importJWK(jwk, 'ES256')
  const audience = new URL(endpoint).origin
  return new SignJWT({
    aud: audience,
    sub: config.subject
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key)
}

export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  config: VapidConfig
): Promise<PushSendResult> {
  const jwt = await createVapidJwt(subscription.endpoint, config)
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
      'Crypto-Key': `p256ecdsa=${config.publicKey}`,
      TTL: '60',
      Urgency: 'normal'
    }
  })

  return {
    ok: response.ok,
    status: response.status,
    expired: response.status === 404 || response.status === 410
  }
}
