import {
  createCustomItemSchema,
  createCustomTabSchema,
  createGroupSchema,
  createRequestSchema,
  joinGroupSchema,
  pushSubscriptionSchema,
  type ApiError,
  type CatalogItem,
  type CatalogTab,
  type GroupCreateResponse,
  type GroupJoinResponse,
  type InboxEvent,
  type LayoutResponse,
  type QuotaResponse,
  type RequestStatus,
  type StoreButton
} from '@renrakun/shared'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { sendWebPush, type PushSubscriptionRecord } from './push'
import { QuotaGateDO } from './quota-do'
import { getJstDayKey, getNextJstMidnightIso, nowIso } from './time'
import type { AuthedMember, DbItem, DbRequestItemRow, DbRequestRow, DbStore, DbTab, Env } from './types'

const app = new Hono<{ Bindings: Env }>()
const PASSHASH_PREFIX = 'pbkdf2_sha256'
const PASSHASH_ITERATIONS = 120000
const PASSHASH_SALT_BYTES = 16
const PASSHASH_KEY_BYTES = 32
type CatalogLanguage = 'ja' | 'en'

const SYSTEM_TAB_LABELS: Record<string, Record<CatalogLanguage, string>> = {
  'sys-tab-detergent': { ja: '洗剤', en: 'Detergent' },
  'sys-tab-washroom': { ja: '洗面', en: 'Washroom' },
  'sys-tab-beauty': { ja: '美容', en: 'Beauty' },
  'sys-tab-kitchen': { ja: 'キッチン', en: 'Kitchen' },
  'sys-tab-store': { ja: '買い物メモ', en: 'Shopping Notes' }
}

const SYSTEM_ITEM_LABELS: Record<string, Record<CatalogLanguage, string>> = {
  'sys-item-detergent': { ja: '洗剤', en: 'Detergent' },
  'sys-item-refill': { ja: '詰替え', en: 'Refill' },
  'sys-item-tissue': { ja: 'ティッシュ', en: 'Tissue' },
  'sys-item-toilet-paper': { ja: 'トイレットペーパー', en: 'Toilet Paper' },
  'sys-item-hand-paper': { ja: 'ハンドペーパー', en: 'Hand Paper' },
  'sys-item-cotton': { ja: 'コットン', en: 'Cotton' },
  'sys-item-shampoo': { ja: 'シャンプー', en: 'Shampoo' },
  'sys-item-conditioner': { ja: 'リンス', en: 'Conditioner' },
  'sys-item-kitchen-paper': { ja: 'キッチンペーパー', en: 'Kitchen Paper' },
  'sys-item-carrot': { ja: 'にんじん', en: 'Carrot' }
}

const SYSTEM_STORE_LABELS: Record<string, Record<CatalogLanguage, string>> = {
  'sys-store-summit': { ja: 'サミット', en: 'Summit' },
  'sys-store-nitori': { ja: 'ニトリ', en: 'Nitori' },
  'sys-store-ikea': { ja: 'IKEA', en: 'IKEA' },
  'sys-store-aeon': { ja: 'イオン', en: 'AEON' },
  'sys-store-gyomu': { ja: '業務スーパー', en: 'Wholesale Market' }
}

app.use('*', async (c, next) => {
  await next()

  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  if (c.req.path.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store')
  }
})

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const configured = c.env.APP_ORIGIN
      if (!origin) return configured || '*'
      if (!configured || configured === '*') return origin
      return origin === configured ? origin : configured
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'x-device-id', 'x-member-id', 'x-app-lang'],
    maxAge: 86400
  })
)

app.get('/', (c) => c.json({ service: 'renrakun-api', status: 'ok' }))

app.get('/api/catalog', async (c) => {
  const language = readCatalogLanguage(c.req)
  const tabs = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, name, is_system AS isSystem, sort_order AS sortOrder
    FROM tabs
    WHERE group_id IS NULL
      AND archived_at IS NULL
    ORDER BY sort_order ASC
    `
  ).all<DbTab>()

  const items = await c.env.DB.prepare(
    `
    SELECT i.id, i.tab_id AS tabId, i.name, i.is_system AS isSystem, i.sort_order AS sortOrder
    FROM items i
    JOIN tabs t ON t.id = i.tab_id
    WHERE t.group_id IS NULL
      AND t.archived_at IS NULL
      AND i.is_system = 1
      AND i.archived_at IS NULL
    ORDER BY t.sort_order ASC, i.sort_order ASC
    `
  ).all<DbItem>()

  const stores = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, name, is_system AS isSystem, sort_order AS sortOrder
    FROM stores
    WHERE group_id IS NULL
    ORDER BY sort_order ASC
    `
  ).all<DbStore>()

  return c.json<LayoutResponse>({
    tabs: tabs.results.map((row) => mapTab(row, language)),
    items: items.results.map((row) => mapItem(row, language)),
    stores: stores.results.map((row) => mapStore(row, language))
  })
})

app.post('/api/groups/create', async (c) => {
  const actorBlocked = await checkJoinCreateActorLimit(c)
  if (actorBlocked) return actorBlocked

  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const parsed = createGroupSchema.safeParse(await readJson(c.req.raw))
  if (!parsed.success) {
    return badRequest(c, 'INVALID_PAYLOAD', parsed.error.flatten())
  }

  const { deviceId, displayName, passphrase } = parsed.data

  const groupId = crypto.randomUUID()
  const memberId = crypto.randomUUID()
  const inviteToken = randomToken(24)
  const inviteTokenHash = await sha256Hex(inviteToken)
  const passphraseHash = await hashPassphrase(passphrase)

  await c.env.DB.batch([
    c.env.DB.prepare(
      `
      INSERT INTO groups (id, invite_token_hash, passphrase_hash)
      VALUES (?, ?, ?)
      `
    ).bind(groupId, inviteTokenHash, passphraseHash),
    c.env.DB.prepare(
      `
      INSERT INTO members (id, group_id, device_id, display_name, role)
      VALUES (?, ?, ?, ?, 'admin')
      `
    ).bind(memberId, groupId, deviceId, displayName)
  ])

  const response: GroupCreateResponse = {
    groupId,
    memberId,
    role: 'admin',
    inviteToken
  }

  return c.json(response, 201)
})

app.post('/api/groups/join', async (c) => {
  const actorBlocked = await checkJoinCreateActorLimit(c)
  if (actorBlocked) return actorBlocked

  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const parsed = joinGroupSchema.safeParse(await readJson(c.req.raw))
  if (!parsed.success) {
    return badRequest(c, 'INVALID_PAYLOAD', parsed.error.flatten())
  }

  const { inviteToken, deviceId, displayName, passphrase } = parsed.data
  const inviteTokenHash = await sha256Hex(inviteToken)
  const group = await c.env.DB.prepare(
    `
    SELECT id, passphrase_hash AS passphraseHash
    FROM groups
    WHERE invite_token_hash = ?
    `
  )
    .bind(inviteTokenHash)
    .first<{ id: string; passphraseHash: string }>()

  if (!group) {
    throw new HTTPException(404, { message: 'GROUP_NOT_FOUND' })
  }

  const passphraseMatched = await verifyPassphrase(passphrase, group.passphraseHash)
  if (!passphraseMatched) {
    throw new HTTPException(403, { message: 'INVALID_PASSPHRASE' })
  }

  const existing = await c.env.DB.prepare(
    `
    SELECT id, role
    FROM members
    WHERE group_id = ? AND device_id = ?
    `
  )
    .bind(group.id, deviceId)
    .first<{ id: string; role: 'admin' | 'member' }>()

  if (existing) {
    const response: GroupJoinResponse = {
      groupId: group.id,
      memberId: existing.id,
      role: existing.role
    }
    return c.json(response, 200)
  }

  const memberId = crypto.randomUUID()
  await c.env.DB.prepare(
    `
    INSERT INTO members (id, group_id, device_id, display_name, role)
    VALUES (?, ?, ?, ?, 'member')
    `
  )
    .bind(memberId, group.id, deviceId, displayName)
    .run()

  const response: GroupJoinResponse = {
    groupId: group.id,
    memberId,
    role: 'member'
  }
  return c.json(response, 201)
})

app.get('/api/groups/:groupId/layout', async (c) => {
  const groupId = c.req.param('groupId')
  const language = readCatalogLanguage(c.req)
  const member = await requireMember(c, groupId)
  if (!member) return unauthorized(c)

  const tabs = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, name, is_system AS isSystem, sort_order AS sortOrder
    FROM tabs
    WHERE (group_id IS NULL OR group_id = ?)
      AND archived_at IS NULL
    ORDER BY sort_order ASC
    `
  )
    .bind(groupId)
    .all<DbTab>()

  const items = await c.env.DB.prepare(
    `
    SELECT i.id, i.tab_id AS tabId, i.name, i.is_system AS isSystem, i.sort_order AS sortOrder
    FROM items i
    JOIN tabs t ON t.id = i.tab_id
    WHERE (t.group_id IS NULL OR t.group_id = ?)
      AND t.archived_at IS NULL
      AND i.archived_at IS NULL
      AND (
        i.is_system = 1
        OR i.group_id = ?
        OR (i.group_id IS NULL AND t.group_id = ?)
      )
    ORDER BY t.sort_order ASC, i.sort_order ASC
    `
  )
    .bind(groupId, groupId, groupId)
    .all<DbItem>()

  const stores = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, name, is_system AS isSystem, sort_order AS sortOrder
    FROM stores
    WHERE group_id IS NULL OR group_id = ?
    ORDER BY sort_order ASC
    `
  )
    .bind(groupId)
    .all<DbStore>()

  return c.json<LayoutResponse>({
    tabs: tabs.results.map((row) => mapTab(row, language)),
    items: items.results.map((row) => mapItem(row, language)),
    stores: stores.results.map((row) => mapStore(row, language))
  })
})

app.post('/api/groups/:groupId/custom-tabs', async (c) => {
  const groupId = c.req.param('groupId')
  const member = await requireMember(c, groupId)
  if (!member) return unauthorized(c)
  if (member.role !== 'admin') throw new HTTPException(403, { message: 'ADMIN_ONLY' })

  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const parsed = createCustomTabSchema.safeParse(await readJson(c.req.raw))
  if (!parsed.success) {
    return badRequest(c, 'INVALID_PAYLOAD', parsed.error.flatten())
  }

  const sortRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS nextSort FROM tabs WHERE group_id = ? AND archived_at IS NULL`
  )
    .bind(groupId)
    .first<{ nextSort: number }>()
  const nextSort = sortRow?.nextSort ?? 100

  const tabId = crypto.randomUUID()
  await c.env.DB.prepare(
    `
    INSERT INTO tabs (id, group_id, name, is_system, sort_order)
    VALUES (?, ?, ?, 0, ?)
    `
  )
    .bind(tabId, groupId, parsed.data.name, nextSort)
    .run()

  return c.json<CatalogTab>(
    {
      id: tabId,
      groupId,
      name: parsed.data.name,
      isSystem: false,
      sortOrder: nextSort
    },
    201
  )
})

app.post('/api/groups/:groupId/custom-items', async (c) => {
  const groupId = c.req.param('groupId')
  const member = await requireMember(c, groupId)
  if (!member) return unauthorized(c)
  if (member.role !== 'admin') throw new HTTPException(403, { message: 'ADMIN_ONLY' })

  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const parsed = createCustomItemSchema.safeParse(await readJson(c.req.raw))
  if (!parsed.success) {
    return badRequest(c, 'INVALID_PAYLOAD', parsed.error.flatten())
  }

  const tabRow = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, archived_at AS archivedAt
    FROM tabs
    WHERE id = ?
    `
  )
    .bind(parsed.data.tabId)
    .first<{ id: string; groupId: string | null; archivedAt: string | null }>()

  if (!tabRow) {
    throw new HTTPException(404, { message: 'TAB_NOT_FOUND' })
  }

  if (tabRow.groupId && tabRow.groupId !== groupId) {
    throw new HTTPException(403, { message: 'TAB_NOT_ACCESSIBLE' })
  }
  if (tabRow.archivedAt) {
    throw new HTTPException(409, { message: 'TAB_ARCHIVED' })
  }

  const sortRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS nextSort FROM items WHERE tab_id = ? AND archived_at IS NULL`
  )
    .bind(parsed.data.tabId)
    .first<{ nextSort: number }>()

  const itemId = crypto.randomUUID()
  const nextSort = sortRow?.nextSort ?? 100
  await c.env.DB.prepare(
    `
    INSERT INTO items (id, tab_id, group_id, name, is_system, sort_order)
    VALUES (?, ?, ?, ?, 0, ?)
    `
  )
    .bind(itemId, parsed.data.tabId, groupId, parsed.data.name, nextSort)
    .run()

  return c.json<CatalogItem>(
    {
      id: itemId,
      tabId: parsed.data.tabId,
      name: parsed.data.name,
      isSystem: false,
      sortOrder: nextSort
    },
    201
  )
})

app.post('/api/groups/:groupId/custom-tabs/:tabId/delete', async (c) => {
  const groupId = c.req.param('groupId')
  const tabId = c.req.param('tabId')
  const member = await requireMember(c, groupId)
  if (!member) return unauthorized(c)
  if (member.role !== 'admin') throw new HTTPException(403, { message: 'ADMIN_ONLY' })

  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const tabRow = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, is_system AS isSystem, archived_at AS archivedAt
    FROM tabs
    WHERE id = ?
    `
  )
    .bind(tabId)
    .first<{ id: string; groupId: string | null; isSystem: number; archivedAt: string | null }>()

  if (!tabRow) throw new HTTPException(404, { message: 'TAB_NOT_FOUND' })
  if (tabRow.groupId !== groupId || tabRow.isSystem) {
    throw new HTTPException(403, { message: 'TAB_NOT_DELETABLE' })
  }

  if (tabRow.archivedAt) {
    return c.json({ ok: true })
  }

  await archiveTab(c, tabId)
  return c.json({ ok: true })
})

app.post('/api/groups/:groupId/custom-items/:itemId/delete', async (c) => {
  const groupId = c.req.param('groupId')
  const itemId = c.req.param('itemId')
  const member = await requireMember(c, groupId)
  if (!member) return unauthorized(c)
  if (member.role !== 'admin') throw new HTTPException(403, { message: 'ADMIN_ONLY' })

  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const itemRow = await c.env.DB.prepare(
    `
    SELECT i.id, i.is_system AS isSystem, i.group_id AS itemGroupId, t.group_id AS tabGroupId, i.archived_at AS archivedAt
    FROM items i
    JOIN tabs t ON t.id = i.tab_id
    WHERE i.id = ?
    `
  )
    .bind(itemId)
    .first<{ id: string; isSystem: number; itemGroupId: string | null; tabGroupId: string | null; archivedAt: string | null }>()

  if (!itemRow) throw new HTTPException(404, { message: 'ITEM_NOT_FOUND' })
  const belongsToGroup =
    itemRow.itemGroupId === groupId ||
    (itemRow.itemGroupId === null && itemRow.tabGroupId === groupId)
  if (!belongsToGroup || itemRow.isSystem) {
    throw new HTTPException(403, { message: 'ITEM_NOT_DELETABLE' })
  }

  if (itemRow.archivedAt) {
    return c.json({ ok: true })
  }

  await archiveItem(c, itemId)
  return c.json({ ok: true })
})

app.post('/api/push/subscribe', async (c) => {
  const payload = pushSubscriptionSchema.safeParse(await readJson(c.req.raw))
  if (!payload.success) {
    return badRequest(c, 'INVALID_PAYLOAD', payload.error.flatten())
  }

  const member = await requireMember(c, payload.data.groupId)
  if (!member) return unauthorized(c)
  if (member.id !== payload.data.memberId) {
    throw new HTTPException(403, { message: 'MEMBER_MISMATCH' })
  }

  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `
    INSERT INTO push_subscriptions (id, member_id, endpoint, p256dh, auth, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      member_id = excluded.member_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updated_at = excluded.updated_at
    `
  )
    .bind(
      id,
      payload.data.memberId,
      payload.data.subscription.endpoint,
      payload.data.subscription.keys.p256dh,
      payload.data.subscription.keys.auth,
      nowIso()
    )
    .run()

  return c.json({ ok: true })
})

app.post('/api/requests', async (c) => {
  const language = readCatalogLanguage(c.req)
  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const payload = createRequestSchema.safeParse(await readJson(c.req.raw))
  if (!payload.success) {
    return badRequest(c, 'INVALID_PAYLOAD', payload.error.flatten())
  }

  const data = payload.data
  const member = await requireMember(c, data.groupId)
  if (!member) return unauthorized(c)
  if (member.id !== data.senderMemberId) {
    throw new HTTPException(403, { message: 'SENDER_MISMATCH' })
  }

  let storeName: string | null = null
  if (data.storeId) {
    const store = await c.env.DB.prepare(
      `
      SELECT id, name
      FROM stores
      WHERE id = ?
        AND (group_id IS NULL OR group_id = ?)
      `
    )
      .bind(data.storeId, data.groupId)
      .first<{ id: string; name: string }>()
    if (!store) {
      throw new HTTPException(400, { message: 'INVALID_STORE_ID' })
    }
    storeName = localizeSystemStoreName(store.id, store.name, language)
  }

  const qtyByItem = new Map<string, number>()
  for (const itemId of data.itemIds) {
    qtyByItem.set(itemId, (qtyByItem.get(itemId) ?? 0) + 1)
  }
  const uniqueItemIds = [...qtyByItem.keys()]
  const availableItems = await fetchAccessibleItems(c, data.groupId, uniqueItemIds)
  if (availableItems.length !== uniqueItemIds.length) {
    throw new HTTPException(400, { message: 'INVALID_ITEM_ID' })
  }

  const requestId = crypto.randomUUID()
  const members = await c.env.DB.prepare(
    `
    SELECT id
    FROM members
    WHERE group_id = ?
    `
  )
    .bind(data.groupId)
    .all<{ id: string }>()

  const batchStatements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `
      INSERT INTO requests (id, group_id, sender_member_id, store_id, status)
      VALUES (?, ?, ?, ?, 'requested')
      `
    ).bind(requestId, data.groupId, data.senderMemberId, data.storeId ?? null)
  ]

  for (const [itemId, qty] of qtyByItem) {
    batchStatements.push(
      c.env.DB.prepare(
        `
        INSERT INTO request_items (request_id, item_id, qty)
        VALUES (?, ?, ?)
        `
      ).bind(requestId, itemId, qty)
    )
  }

  for (const memberRow of members.results) {
    batchStatements.push(
      c.env.DB.prepare(
        `
        INSERT INTO inbox_events (id, request_id, recipient_member_id)
        VALUES (?, ?, ?)
        `
      ).bind(crypto.randomUUID(), requestId, memberRow.id)
    )
  }

  await c.env.DB.batch(batchStatements)

  const itemNameMap = new Map(
    availableItems.map((item) => [item.id, localizeSystemItemName(item.id, item.name, language)])
  )
  const readableItems = [...qtyByItem.entries()].map(([itemId, qty]) => {
    const itemName = itemNameMap.get(itemId) ?? (language === 'ja' ? '不明' : 'Unknown')
    return qty > 1 ? `${itemName} x${qty}` : itemName
  })
  const pushMessage =
    language === 'ja'
      ? `${member.displayName}さんが${storeName ? `${storeName}で` : ''}${readableItems.join('、')}を買ってほしいと言っています`
      : `${member.displayName} is asking to buy ${readableItems.join(', ')}${storeName ? ` at ${storeName}` : ''}.`

  const pushRecipients = members.results.filter((row) => row.id !== data.senderMemberId).map((row) => row.id)
  await fanoutPushNotifications(c, data.groupId, pushRecipients, pushMessage)

  return c.json(
    {
      requestId,
      pushMessage
    },
    201
  )
})

app.get('/api/requests/inbox', async (c) => {
  const language = readCatalogLanguage(c.req)
  const groupId = c.req.query('groupId')
  if (!groupId) {
    return badRequest(c, 'GROUP_ID_REQUIRED')
  }
  const member = await requireMember(c, groupId)
  if (!member) return unauthorized(c)

  const rows = await c.env.DB.prepare(
    `
    SELECT
      ie.id AS eventId,
      ie.request_id AS requestId,
      r.status AS status,
      r.sender_member_id AS senderMemberId,
      m.display_name AS senderName,
      r.store_id AS storeId,
      s.name AS storeName,
      r.created_at AS createdAt,
      ie.read_at AS readAt
    FROM inbox_events ie
    JOIN requests r ON r.id = ie.request_id
    JOIN members m ON m.id = r.sender_member_id
    LEFT JOIN stores s ON s.id = r.store_id
    WHERE ie.recipient_member_id = ?
      AND r.group_id = ?
    ORDER BY r.created_at DESC
    LIMIT 100
    `
  )
    .bind(member.id, groupId)
    .all<DbRequestRow>()

  if (rows.results.length === 0) {
    return c.json<InboxEvent[]>([])
  }

  const requestIds = rows.results.map((row) => row.requestId)
  const placeholders = createInClause(requestIds.length)
  const itemRows = await c.env.DB.prepare(
    `
    SELECT ri.request_id AS requestId, ri.item_id AS itemId, i.name AS name, ri.qty AS qty
    FROM request_items ri
    JOIN items i ON i.id = ri.item_id
    WHERE ri.request_id IN (${placeholders})
    ORDER BY i.sort_order ASC
    `
  )
    .bind(...requestIds)
    .all<DbRequestItemRow>()

  const itemsByRequest = new Map<string, Array<{ name: string; qty: number }>>()
  for (const row of itemRows.results) {
    const list = itemsByRequest.get(row.requestId) ?? []
    list.push({ name: localizeSystemItemName(row.itemId, row.name, language), qty: Number(row.qty) })
    itemsByRequest.set(row.requestId, list)
  }

  const response: InboxEvent[] = rows.results.map((row) => ({
    eventId: row.eventId,
    requestId: row.requestId,
    status: row.status,
    senderMemberId: row.senderMemberId,
    senderName: row.senderName,
    storeName: row.storeId ? localizeSystemStoreName(row.storeId, row.storeName ?? '', language) : row.storeName,
    items: itemsByRequest.get(row.requestId) ?? [],
    createdAt: row.createdAt,
    readAt: row.readAt
  }))

  return c.json(response)
})

app.post('/api/requests/:requestId/ack', async (c) => {
  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const member = await requireMemberWithoutGroup(c)
  if (!member) return unauthorized(c)

  const requestId = c.req.param('requestId')
  const ownsInboxEvent = await c.env.DB.prepare(
    `
    SELECT r.id, r.group_id AS groupId
    FROM requests r
    JOIN inbox_events ie ON ie.request_id = r.id
    WHERE r.id = ? AND ie.recipient_member_id = ? AND r.sender_member_id <> ?
    `
  )
    .bind(requestId, member.id, member.id)
    .first<{ id: string; groupId: string }>()

  if (!ownsInboxEvent) {
    throw new HTTPException(404, { message: 'REQUEST_NOT_FOUND' })
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `
      UPDATE requests
      SET status = CASE
        WHEN status = 'requested' THEN 'acknowledged'
        ELSE status
      END
      WHERE id = ?
      `
    ).bind(requestId),
    c.env.DB.prepare(
      `
      UPDATE inbox_events
      SET read_at = COALESCE(read_at, ?)
      WHERE request_id = ? AND recipient_member_id = ?
      `
    ).bind(nowIso(), requestId, member.id)
  ])

  const status = await readRequestStatus(c, requestId)
  return c.json({ requestId, status })
})

app.post('/api/requests/:requestId/complete', async (c) => {
  const quotaBlocked = await checkDailyWriteQuota(c)
  if (quotaBlocked) return quotaBlocked

  const member = await requireMemberWithoutGroup(c)
  if (!member) return unauthorized(c)

  const requestId = c.req.param('requestId')
  const ownsInboxEvent = await c.env.DB.prepare(
    `
    SELECT r.id
    FROM requests r
    JOIN inbox_events ie ON ie.request_id = r.id
    WHERE r.id = ? AND ie.recipient_member_id = ? AND r.sender_member_id <> ?
    `
  )
    .bind(requestId, member.id, member.id)
    .first<{ id: string }>()

  if (!ownsInboxEvent) {
    throw new HTTPException(404, { message: 'REQUEST_NOT_FOUND' })
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `
      UPDATE requests
      SET status = 'completed'
      WHERE id = ?
      `
    ).bind(requestId),
    c.env.DB.prepare(
      `
      UPDATE inbox_events
      SET read_at = COALESCE(read_at, ?)
      WHERE request_id = ? AND recipient_member_id = ?
      `
    ).bind(nowIso(), requestId, member.id)
  ])

  const status = await readRequestStatus(c, requestId)
  return c.json({ requestId, status })
})

app.get('/api/quota/status', async (c) => {
  const record = await getQuotaStatus(c)
  return c.json<QuotaResponse>({
    state: record.state,
    resumeAt: record.resumeAt,
    count: record.count,
    limit: record.limit
  })
})

app.onError((error, c) => {
  console.error('--- API Error ---');
  console.error(error);
  if (error instanceof HTTPException) {
    const body: ApiError = {
      code: error.message || 'HTTP_ERROR',
      message: error.message || 'Request failed'
    }
    return c.json(body, error.status)
  }
  const body: ApiError = {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error'
  }
  return c.json(body, 500)
})

function mapTab(row: DbTab, language: CatalogLanguage): CatalogTab {
  return {
    id: row.id,
    groupId: row.groupId ?? null,
    name: row.isSystem ? localizeSystemTabName(row.id, row.name, language) : row.name,
    isSystem: !!row.isSystem,
    sortOrder: Number(row.sortOrder)
  }
}

function mapItem(row: DbItem, language: CatalogLanguage): CatalogItem {
  return {
    id: row.id,
    tabId: row.tabId,
    name: row.isSystem ? localizeSystemItemName(row.id, row.name, language) : row.name,
    isSystem: !!row.isSystem,
    sortOrder: Number(row.sortOrder)
  }
}

function mapStore(row: DbStore, language: CatalogLanguage): StoreButton {
  return {
    id: row.id,
    groupId: row.groupId ?? null,
    name: row.isSystem ? localizeSystemStoreName(row.id, row.name, language) : row.name,
    isSystem: !!row.isSystem,
    sortOrder: Number(row.sortOrder)
  }
}

function readCatalogLanguage(req: { header: (name: string) => string | undefined }): CatalogLanguage {
  const explicit = req.header('x-app-lang')
  if (explicit === 'ja' || explicit === 'en') return explicit
  const accept = req.header('accept-language')?.toLowerCase() ?? ''
  return accept.startsWith('ja') ? 'ja' : 'en'
}

function localizeSystemTabName(id: string, fallback: string, language: CatalogLanguage): string {
  return SYSTEM_TAB_LABELS[id]?.[language] ?? fallback
}

function localizeSystemItemName(id: string, fallback: string, language: CatalogLanguage): string {
  return SYSTEM_ITEM_LABELS[id]?.[language] ?? fallback
}

function localizeSystemStoreName(id: string, fallback: string, language: CatalogLanguage): string {
  return SYSTEM_STORE_LABELS[id]?.[language] ?? fallback
}

function createInClause(length: number): string {
  if (length <= 0) {
    throw new Error('IN clause requires at least one value')
  }
  return new Array(length).fill('?').join(',')
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return toBase64Url(bytes)
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
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function derivePassphraseHash(passphrase: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const normalizedSalt = Uint8Array.from(salt)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: normalizedSalt as unknown as BufferSource,
      iterations
    },
    keyMaterial,
    PASSHASH_KEY_BYTES * 8
  )
  return new Uint8Array(bits)
}

async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSHASH_SALT_BYTES))
  const hash = await derivePassphraseHash(passphrase, salt, PASSHASH_ITERATIONS)
  return `${PASSHASH_PREFIX}$${PASSHASH_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i]
  }
  return diff === 0
}

async function verifyPassphrase(passphrase: string, storedHash: string): Promise<boolean> {
  const [scheme, iterationText, saltText, hashText] = storedHash.split('$')
  if (scheme === PASSHASH_PREFIX && iterationText && saltText && hashText) {
    const iterations = Number(iterationText)
    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false
    }
    const salt = fromBase64Url(saltText)
    const expectedHash = fromBase64Url(hashText)
    const derived = await derivePassphraseHash(passphrase, salt, iterations)
    return timingSafeEqual(derived, expectedHash)
  }

  // Backward compatibility for groups created before PBKDF2 migration.
  const legacyHash = await sha256Hex(passphrase)
  return legacyHash === storedHash
}

async function requireMember(c: { env: Env; req: { header: (name: string) => string | undefined } }, groupId: string) {
  const memberId = c.req.header('x-member-id')
  const deviceId = c.req.header('x-device-id')

  if (!memberId || !deviceId) return null

  const row = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, display_name AS displayName, role
    FROM members
    WHERE id = ? AND group_id = ? AND device_id = ?
    `
  )
    .bind(memberId, groupId, deviceId)
    .first<AuthedMember>()

  return row ?? null
}

async function requireMemberWithoutGroup(
  c: { env: Env; req: { header: (name: string) => string | undefined } }
) {
  const memberId = c.req.header('x-member-id')
  const deviceId = c.req.header('x-device-id')

  if (!memberId || !deviceId) return null

  const row = await c.env.DB.prepare(
    `
    SELECT id, group_id AS groupId, display_name AS displayName, role
    FROM members
    WHERE id = ? AND device_id = ?
    `
  )
    .bind(memberId, deviceId)
    .first<AuthedMember>()

  return row ?? null
}

function unauthorized(c: { json: (data: unknown, status?: number) => Response }): Response {
  const body: ApiError = {
    code: 'UNAUTHORIZED',
    message: 'Missing or invalid member headers'
  }
  return c.json(body, 401)
}

function badRequest(
  c: { json: (data: unknown, status?: number) => Response },
  code: string,
  detail?: unknown
): Response {
  return c.json(
    {
      code,
      message: 'Bad request',
      detail
    },
    400
  )
}

async function fetchAccessibleItems(
  c: { env: Env },
  groupId: string,
  itemIds: string[]
): Promise<Array<{ id: string; name: string }>> {
  const placeholders = createInClause(itemIds.length)
  const result = await c.env.DB.prepare(
    `
    SELECT i.id, i.name
    FROM items i
    JOIN tabs t ON t.id = i.tab_id
    WHERE i.id IN (${placeholders})
      AND (t.group_id IS NULL OR t.group_id = ?)
      AND t.archived_at IS NULL
      AND i.archived_at IS NULL
      AND (
        i.is_system = 1
        OR i.group_id = ?
        OR (i.group_id IS NULL AND t.group_id = ?)
      )
    `
  )
    .bind(...itemIds, groupId, groupId, groupId)
    .all<{ id: string; name: string }>()
  return result.results
}

async function archiveTab(c: { env: Env }, tabId: string): Promise<void> {
  await c.env.DB.prepare(`UPDATE tabs SET archived_at = ? WHERE id = ?`).bind(nowIso(), tabId).run()
}

async function archiveItem(c: { env: Env }, itemId: string): Promise<void> {
  await c.env.DB.prepare(`UPDATE items SET archived_at = ? WHERE id = ?`).bind(nowIso(), itemId).run()
}

async function readRequestStatus(c: { env: Env }, requestId: string): Promise<RequestStatus> {
  const row = await c.env.DB.prepare(`SELECT status FROM requests WHERE id = ?`)
    .bind(requestId)
    .first<{ status: RequestStatus }>()

  if (!row) throw new HTTPException(404, { message: 'REQUEST_NOT_FOUND' })
  return row.status
}

async function fanoutPushNotifications(
  c: { env: Env },
  groupId: string,
  recipientMemberIds: string[],
  message: string
): Promise<void> {
  if (recipientMemberIds.length === 0) return
  if (!c.env.VAPID_PUBLIC_KEY || !c.env.VAPID_PRIVATE_KEY || !c.env.VAPID_SUBJECT) {
    return
  }

  const placeholders = createInClause(recipientMemberIds.length)
  const subscriptions = await c.env.DB.prepare(
    `
    SELECT member_id AS memberId, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE member_id IN (${placeholders})
    `
  )
    .bind(...recipientMemberIds)
    .all<PushSubscriptionRecord>()

  const staleEndpoints: string[] = []
  await Promise.all(
    subscriptions.results.map(async (subscription) => {
      try {
        const result = await sendWebPush(subscription, {
          publicKey: c.env.VAPID_PUBLIC_KEY as string,
          privateKey: c.env.VAPID_PRIVATE_KEY as string,
          subject: c.env.VAPID_SUBJECT as string
        })
        if (result.expired) {
          staleEndpoints.push(subscription.endpoint)
        }
      } catch {
        // Ignore push network/signing failures to keep request creation reliable.
      }
    })
  )

  if (staleEndpoints.length > 0) {
    const cleanupPlaceholders = createInClause(staleEndpoints.length)
    await c.env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE endpoint IN (${cleanupPlaceholders})`
    )
      .bind(...staleEndpoints)
      .run()
  }

  // Persisting this string keeps parity with user-facing text generation requirements.
  void message
  void groupId
}

interface QuotaDoState {
  dayKey: string | null
  state: 'open' | 'paused'
  count: number
  limit: number
  resumeAt: string
}

async function getQuotaStatus(c: { env: Env }): Promise<QuotaDoState> {
  const id = c.env.QUOTA_GATE.idFromName('global')
  const stub = c.env.QUOTA_GATE.get(id)
  const response = await stub.fetch('https://quota/status')
  const payload = (await response.json()) as Partial<QuotaDoState>

  if (!payload.dayKey || !payload.resumeAt || !payload.limit) {
    return {
      dayKey: getJstDayKey(),
      state: 'open',
      count: 0,
      limit: Number(c.env.DAILY_WRITE_LIMIT ?? 300),
      resumeAt: getNextJstMidnightIso()
    }
  }

  return {
    dayKey: payload.dayKey,
    state: payload.state ?? 'open',
    count: payload.count ?? 0,
    limit: payload.limit ?? Number(c.env.DAILY_WRITE_LIMIT ?? 300),
    resumeAt: payload.resumeAt
  }
}

function readActorIp(header: (name: string) => string | undefined): string {
  const forwarded = header('cf-connecting-ip') ?? header('x-forwarded-for') ?? header('x-real-ip')
  if (!forwarded) return 'unknown'
  return forwarded.split(',')[0]?.trim() || 'unknown'
}

async function checkJoinCreateActorLimit(
  c: { env: Env; req: { header: (name: string) => string | undefined }; json: (data: unknown, status?: number) => Response }
) {
  const limit = Number(c.env.DAILY_JOIN_CREATE_LIMIT_PER_ACTOR ?? 40)
  if (!Number.isFinite(limit) || limit <= 0) return null

  const dayKey = getJstDayKey()
  const actorKey = `join-create:${readActorIp((name) => c.req.header(name))}`

  await c.env.DB.prepare(
    `
    INSERT INTO daily_actor_limits (actor_key, day_key, count, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(actor_key) DO UPDATE SET
      day_key = CASE
        WHEN daily_actor_limits.day_key = excluded.day_key THEN daily_actor_limits.day_key
        ELSE excluded.day_key
      END,
      count = CASE
        WHEN daily_actor_limits.day_key = excluded.day_key THEN daily_actor_limits.count + 1
        ELSE 1
      END,
      updated_at = excluded.updated_at
    `
  )
    .bind(actorKey, dayKey, nowIso())
    .run()

  const current = await c.env.DB.prepare(
    `
    SELECT day_key AS dayKey, count
    FROM daily_actor_limits
    WHERE actor_key = ?
    `
  )
    .bind(actorKey)
    .first<{ dayKey: string; count: number }>()

  if (!current || current.dayKey !== dayKey) return null
  if (Number(current.count) <= limit) return null

  const error: ApiError = {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many create/join requests for today'
  }
  return c.json(error, 429)
}

async function checkDailyWriteQuota(c: { env: Env; json: (data: unknown, status?: number) => Response }) {
  const limit = Number(c.env.DAILY_WRITE_LIMIT ?? 300)
  const dayKey = getJstDayKey()
  const resumeAt = getNextJstMidnightIso()
  const id = c.env.QUOTA_GATE.idFromName('global')
  const stub = c.env.QUOTA_GATE.get(id)
  const response = await stub.fetch('https://quota/consume', {
    method: 'POST',
    body: JSON.stringify({
      dayKey,
      limit,
      resumeAt
    })
  })

  const payload = (await response.json()) as Partial<QuotaDoState>
  if (payload.state === 'paused') {
    const error: ApiError = {
      code: 'SERVICE_PAUSED_DAILY_QUOTA',
      message: 'Daily write quota reached',
      resumeAt: payload.resumeAt ?? resumeAt
    }
    return c.json(error, 503)
  }
  return null
}

async function resetDailyQuota(env: Env): Promise<void> {
  const limit = Number(env.DAILY_WRITE_LIMIT ?? 300)
  const dayKey = getJstDayKey()
  const resumeAt = getNextJstMidnightIso()
  const id = env.QUOTA_GATE.idFromName('global')
  const stub = env.QUOTA_GATE.get(id)
  await stub.fetch('https://quota/force-reset', {
    method: 'POST',
    body: JSON.stringify({ dayKey, limit, resumeAt })
  })
}

const worker = {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(resetDailyQuota(env))
  }
}

export default worker
export { QuotaGateDO }
