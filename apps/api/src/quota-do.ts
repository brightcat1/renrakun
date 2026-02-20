import type { QuotaState } from '@renrakun/shared'

interface QuotaRecord {
  dayKey: string
  count: number
  limit: number
  state: QuotaState
  resumeAt: string
}

interface ConsumeInput {
  dayKey: string
  limit: number
  resumeAt: string
}

const STORAGE_KEY = 'quota-state'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

export class QuotaGateDO {
  constructor(private readonly state: DurableObjectState) {}

  private async readRecord(): Promise<QuotaRecord | null> {
    return (await this.state.storage.get<QuotaRecord>(STORAGE_KEY)) ?? null
  }

  private async writeRecord(record: QuotaRecord): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, record)
  }

  private ensureWindow(record: QuotaRecord | null, input: ConsumeInput): QuotaRecord {
    if (!record || record.dayKey !== input.dayKey) {
      return {
        dayKey: input.dayKey,
        count: 0,
        limit: input.limit,
        state: 'open',
        resumeAt: input.resumeAt
      }
    }

    record.limit = input.limit
    record.resumeAt = input.resumeAt
    return record
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/consume') {
      const body = (await request.json()) as Partial<ConsumeInput>
      if (!body.dayKey || !body.resumeAt || !body.limit || body.limit <= 0) {
        return json({ code: 'INVALID_CONSUME_PAYLOAD' }, 400)
      }

      const current = await this.readRecord()
      const record = this.ensureWindow(current, {
        dayKey: body.dayKey,
        limit: body.limit,
        resumeAt: body.resumeAt
      })

      if (record.state === 'paused') {
        await this.writeRecord(record)
        return json(record, 200)
      }

      if (record.count + 1 > record.limit) {
        record.state = 'paused'
        await this.writeRecord(record)
        return json(record, 200)
      }

      record.count += 1
      await this.writeRecord(record)
      return json(record, 200)
    }

    if (request.method === 'POST' && url.pathname === '/force-reset') {
      const body = (await request.json()) as Partial<ConsumeInput>
      if (!body.dayKey || !body.resumeAt || !body.limit || body.limit <= 0) {
        return json({ code: 'INVALID_RESET_PAYLOAD' }, 400)
      }

      const record: QuotaRecord = {
        dayKey: body.dayKey,
        count: 0,
        limit: body.limit,
        state: 'open',
        resumeAt: body.resumeAt
      }
      await this.writeRecord(record)
      return json(record, 200)
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      const record = await this.readRecord()
      if (!record) {
        return json(
          {
            dayKey: null,
            count: 0,
            limit: 0,
            state: 'open',
            resumeAt: null
          },
          200
        )
      }
      return json(record, 200)
    }

    return json({ code: 'NOT_FOUND' }, 404)
  }
}
