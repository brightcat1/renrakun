const jstDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function extractParts(date: Date): { year: number; month: number; day: number } {
  const parts = jstDayFormatter.formatToParts(date)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)

  return { year, month, day }
}

export function getJstDayKey(date: Date = new Date()): string {
  const { year, month, day } = extractParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function getNextJstMidnightIso(date: Date = new Date()): string {
  const { year, month, day } = extractParts(date)
  const utcMillis = Date.UTC(year, month - 1, day + 1, -9, 0, 0, 0)
  return new Date(utcMillis).toISOString()
}

export function nowIso(): string {
  return new Date().toISOString()
}
