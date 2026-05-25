export function parseNumeric(value: unknown, fallback: number = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

export function formatNumeric(value: number, scale: number) {
  return value.toFixed(scale)
}

export function toIsoString(value: string | Date | null) {
  if (!value) {
    return null
  }

  return typeof value === 'string' ? value : value.toISOString()
}

export function toDate(value: string | Date | null, fallback: Date = new Date()) {
  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return fallback
}

export function getNestedValue(input: unknown, path: string) {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  const parts = path.split('.')
  let current: unknown = input

  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

export function firstStringValue(input: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getNestedValue(input, path)
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

export function firstNumericValue(input: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getNestedValue(input, path)
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

export function firstBooleanValue(input: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getNestedValue(input, path)
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true
      }
      if (value === 0) {
        return false
      }
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['1', 'true', 'yes', 'y'].includes(normalized)) {
        return true
      }
      if (['0', 'false', 'no', 'n'].includes(normalized)) {
        return false
      }
    }
  }

  return null
}

export function getArrayValues<T>(input: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getNestedValue(input, path)
    if (Array.isArray(value)) {
      return value as T[]
    }
  }

  return [] as T[]
}
