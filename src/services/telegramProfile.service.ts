import { sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { config } from '@/config'
import db from '@/db'

type TelegramGetChatResult = {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo?: { small_file_id?: string }
  type: string
}

type TelegramFileResult = {
  file_path?: string
}

type MemberTelegramProfileRow = {
  tg_id: string
  tg_meta: Record<string, unknown> | null
  updated_at: string | Date | null
}

const TELEGRAM_PROFILE_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000

function parseTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  return null
}

function getBackendBaseUrl(c?: Context) {
  const configuredBaseUrl = config.appBaseUrl?.trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  const callbackUrl = config.xCallbackUrl?.trim()
  if (callbackUrl) {
    try {
      return new URL(callbackUrl).origin
    } catch {}
  }

  if (c) {
    return new URL(c.req.url).origin
  }

  return 'http://localhost:3001'
}

function getPhotoUrl(tgMeta: Record<string, unknown> | null) {
  return typeof tgMeta?.photo_url === 'string' ? tgMeta.photo_url.trim() : null
}

function isTelegramUserpicUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 't.me' && parsed.pathname.startsWith('/i/userpic/')
  } catch {
    return false
  }
}

function isTelegramBotFileUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'api.telegram.org' && parsed.pathname.includes('/file/bot')
  } catch {
    return false
  }
}

function getPhotoRefreshTimestamp(
  tgMeta: Record<string, unknown> | null,
  memberUpdatedAt?: string | Date | null
) {
  return (
    parseTimestamp(tgMeta?.photo_refreshed_at) ??
    parseTimestamp(tgMeta?.photoRefreshedAt) ??
    parseTimestamp(memberUpdatedAt ?? null)
  )
}

function shouldRefreshTelegramProfile(
  tgMeta: Record<string, unknown> | null,
  memberUpdatedAt?: string | Date | null,
  force = false
) {
  if (force) {
    return true
  }

  const missingName =
    typeof tgMeta?.first_name !== 'string' &&
    typeof tgMeta?.username !== 'string' &&
    typeof tgMeta?.tgUsername !== 'string'
  const photoUrl = getPhotoUrl(tgMeta)
  const hasPublicPhotoUrl = photoUrl ? isTelegramUserpicUrl(photoUrl) : false
  const hasPhotoFileId = typeof tgMeta?.photo_file_id === 'string'
  const lastRefreshAt = getPhotoRefreshTimestamp(tgMeta, memberUpdatedAt)

  if (missingName) {
    return true
  }

  if (hasPublicPhotoUrl) {
    return false
  }

  if (!hasPhotoFileId || lastRefreshAt === null) {
    return true
  }

  return Date.now() - lastRefreshAt >= TELEGRAM_PROFILE_REFRESH_INTERVAL_MS
}

async function fetchTelegramUserInfo(tgId: string): Promise<TelegramGetChatResult | null> {
  const token = config.telegramBotToken
  if (!token) return null

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(tgId)}`
    )
    const json = (await res.json()) as { ok: boolean; result?: TelegramGetChatResult }
    return json.ok && json.result ? json.result : null
  } catch {
    return null
  }
}

async function fetchTelegramFilePath(fileId: string): Promise<string | null> {
  const token = config.telegramBotToken
  if (!token) return null

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
    )
    const json = (await res.json()) as { ok: boolean; result?: TelegramFileResult }
    return json.ok && json.result?.file_path ? json.result.file_path : null
  } catch {
    return null
  }
}

function buildTelegramFileUrl(filePath: string) {
  return `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`
}

async function updateMemberTelegramMeta(
  telegramId: string,
  tgMeta: Record<string, unknown>
): Promise<Record<string, unknown>> {
  await db('primary').execute(sql`
    UPDATE members
    SET tg_meta = ${JSON.stringify(tgMeta)}::json, updated_at = NOW()
    WHERE tg_id = ${telegramId}
  `)

  return tgMeta
}

export async function findMemberTelegramProfileById(telegramId: string) {
  const result = await db('primary').execute(sql`
    SELECT tg_id, tg_meta, updated_at
    FROM members
    WHERE tg_id = ${telegramId}
    LIMIT 1
  `)

  return (result[0] as MemberTelegramProfileRow | undefined) || null
}

export async function refreshMemberTelegramProfile(
  telegramId: string,
  tgMeta: Record<string, unknown> | null,
  options?: { force?: boolean; memberUpdatedAt?: string | Date | null }
) {
  const { force = false, memberUpdatedAt = null } = options ?? {}
  if (!shouldRefreshTelegramProfile(tgMeta, memberUpdatedAt, force)) {
    return tgMeta
  }

  const userInfo = await fetchTelegramUserInfo(telegramId)
  if (!userInfo || userInfo.type !== 'private') {
    return tgMeta
  }

  const photoFileId = userInfo.photo?.small_file_id ?? null
  const nowIso = new Date().toISOString()
  const existingPublicPhotoUrl = getPhotoUrl(tgMeta)
  const publicPhotoUrl =
    existingPublicPhotoUrl && isTelegramUserpicUrl(existingPublicPhotoUrl)
      ? existingPublicPhotoUrl
      : null

  const enriched: Record<string, unknown> = {
    ...tgMeta,
    id: String(userInfo.id),
    chatType: userInfo.type,
    photo_file_id: photoFileId,
    photo_refreshed_at: nowIso,
    photo_url: publicPhotoUrl
  }

  if (userInfo.first_name) {
    enriched.first_name = userInfo.first_name
  }
  if (userInfo.last_name) {
    enriched.last_name = userInfo.last_name
  }
  if (userInfo.username) {
    enriched.username = userInfo.username
  }

  return updateMemberTelegramMeta(telegramId, enriched)
}

export function buildTelegramPhotoProxyUrl(
  telegramId: string,
  options?: {
    baseUrl?: string | null
    tgMeta?: Record<string, unknown> | null
    memberUpdatedAt?: string | Date | null
    c?: Context
  }
) {
  const { baseUrl = null, tgMeta = null, memberUpdatedAt = null, c } = options ?? {}
  const photoUrl = getPhotoUrl(tgMeta)
  if (photoUrl && isTelegramUserpicUrl(photoUrl)) {
    return photoUrl
  }

  const hasProxyablePhotoSource =
    typeof tgMeta?.photo_file_id === 'string' || (photoUrl ? isTelegramBotFileUrl(photoUrl) : false)

  if (!hasProxyablePhotoSource) {
    return null
  }

  const url = new URL(
    `/api/v1/twitterUsers/api-keys/telegram-photo/${encodeURIComponent(telegramId)}`,
    baseUrl || getBackendBaseUrl(c)
  )
  const refreshedAt = getPhotoRefreshTimestamp(tgMeta, memberUpdatedAt)
  if (refreshedAt !== null) {
    url.searchParams.set('v', String(refreshedAt))
  }
  return url.toString()
}

export async function getTelegramPhotoProxyResponse(telegramId: string) {
  const memberProfile = await findMemberTelegramProfileById(telegramId)
  if (!memberProfile) {
    return new Response('Not Found', { status: 404 })
  }

  let tgMeta = await refreshMemberTelegramProfile(telegramId, memberProfile.tg_meta, {
    memberUpdatedAt: memberProfile.updated_at
  })
  const publicPhotoUrl = getPhotoUrl(tgMeta)
  if (publicPhotoUrl && isTelegramUserpicUrl(publicPhotoUrl)) {
    const publicResponse = await fetch(publicPhotoUrl)
    if (publicResponse.ok && publicResponse.body) {
      const headers = new Headers()
      const contentType = publicResponse.headers.get('content-type')
      if (contentType) {
        headers.set('Content-Type', contentType)
      }
      headers.set('Cache-Control', 'public, max-age=3600')

      return new Response(publicResponse.body, {
        status: 200,
        headers
      })
    }
  }

  let photoFileId = typeof tgMeta?.photo_file_id === 'string' ? tgMeta.photo_file_id : null
  let legacyPhotoUrl = getPhotoUrl(tgMeta)

  if (!photoFileId) {
    tgMeta = await refreshMemberTelegramProfile(telegramId, tgMeta, { force: true })
    photoFileId = typeof tgMeta?.photo_file_id === 'string' ? tgMeta.photo_file_id : null
    legacyPhotoUrl = getPhotoUrl(tgMeta)
  }

  if (!photoFileId && !(legacyPhotoUrl && isTelegramBotFileUrl(legacyPhotoUrl))) {
    return new Response('Not Found', { status: 404 })
  }

  let filePath = photoFileId ? await fetchTelegramFilePath(photoFileId) : null
  if (!filePath) {
    tgMeta = await refreshMemberTelegramProfile(telegramId, tgMeta, { force: true })
    photoFileId = typeof tgMeta?.photo_file_id === 'string' ? tgMeta.photo_file_id : null
    filePath = photoFileId ? await fetchTelegramFilePath(photoFileId) : null
    legacyPhotoUrl = getPhotoUrl(tgMeta)
  }

  if (!filePath && legacyPhotoUrl && isTelegramBotFileUrl(legacyPhotoUrl)) {
    const legacyResponse = await fetch(legacyPhotoUrl)
    if (legacyResponse.ok && legacyResponse.body) {
      const headers = new Headers()
      const contentType = legacyResponse.headers.get('content-type')
      if (contentType) {
        headers.set('Content-Type', contentType)
      }
      headers.set('Cache-Control', 'private, max-age=900')

      return new Response(legacyResponse.body, {
        status: 200,
        headers
      })
    }
  }

  if (!filePath) {
    return new Response('Not Found', { status: 404 })
  }

  const fileResponse = await fetch(buildTelegramFileUrl(filePath))
  if (!fileResponse.ok || !fileResponse.body) {
    return new Response('Not Found', { status: 404 })
  }

  const headers = new Headers()
  const contentType = fileResponse.headers.get('content-type')
  if (contentType) {
    headers.set('Content-Type', contentType)
  }
  headers.set('Cache-Control', 'private, max-age=3600')

  return new Response(fileResponse.body, {
    status: 200,
    headers
  })
}
