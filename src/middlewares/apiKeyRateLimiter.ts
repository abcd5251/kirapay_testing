import crypto from 'crypto'
import { sql } from 'drizzle-orm'
import { type Context, type Next } from 'hono'
import httpStatus from 'http-status'
import { LRUCache as LRU } from 'lru-cache'
import { z } from 'zod'
import { ApiError } from '../utils/ApiError'
import { logger as loggerCreator } from '../utils/logger'
import { config } from '@/config'
import db from '@/db'
import {
  findMemberTelegramProfileById,
  refreshMemberTelegramProfile
} from '@/services/telegramProfile.service'
import { ensureXApiCreditAccount } from '@/services/xAuth.service'
import { extractApiKey } from '@/utils/requestAuth'

const logger = loggerCreator()

interface RateLimitEntry {
  count: number
  resetTime: number
}

type DbRow = Record<string, unknown>
type DbExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<DbRow[]>
}

type ApiCreditTopUpParams = {
  accountId?: string
  credits: number
  eventType?: string
  telegramId?: string
  twitterId?: string
}

type ApiCreditTopUpResult = {
  accountId: string
  balanceAfter: number
  invitedByTgId: string | null
  memberTgId: string | null
  toppedUpCredits: number
  twitterId: string
}

type ApiCreditAccountRow = {
  id: string
  member_tg_id: string | null
  twitter_id: string
  status: 'active' | 'inactive' | 'suspended'
  available_credits: number
  invited_by_tg_id: string | null
}

type ApiKeyLookupRow = {
  account_id: string
  member_tg_id: string | null
  twitter_id: string
  account_status: 'active' | 'inactive' | 'suspended'
  available_credits: number
  invited_by_tg_id: string | null
  api_key_id: string
  key_status: 'active' | 'inactive' | 'revoked'
}

type ActiveApiKeyRow = {
  id: string
  key_last4: string
}

type MemberProfileRow = {
  tg_id: string
  tg_meta: Record<string, unknown> | null
  sub_limit: number | string | null
  referral_code: string | null
}

type MemberCodeLookupRow = {
  tg_id: string
}

const rateLimitStore = new LRU<string, RateLimitEntry>({
  max: 100,
  ttl: 15 * 60 * 1000,
  updateAgeOnGet: false,
  allowStale: false
})

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 1000
const TWITTER_SIGNUP_CREDITS = 2500
const TELEGRAM_BIND_CREDITS = 1500
const TELEGRAM_LOGIN_MAX_AGE_SECONDS = 5 * 60
const TELEGRAM_BIND_LEDGER_EVENT_TYPE = 'telegram_bind_bonus'
const TOP_UP_LEDGER_EVENT_TYPES = [
  'topup',
  'starter_topup',
  'standard_topup',
  'advanced_topup'
] as const
const CREDIT_INCREASE_LEDGER_EVENT_TYPES = [
  ...TOP_UP_LEDGER_EVENT_TYPES,
  'signup_bonus',
  TELEGRAM_BIND_LEDGER_EVENT_TYPE,
  'referral_bonus'
] as const
const REFERRAL_BONUS_CREDITS = 500
const REFERRAL_SCOPE_API_SERVICE = 'api_service'
const DEFAULT_MEMBER_SUB_LIMIT = 1
const TOP_UP_SECRET_HEADER = 'X-Api-Credit-Top-Up-Secret'
const managementPathPrefix = '/api/v1/twitterUsers/api-keys'
let ensureApiCreditLedgerEventTypesPromise: Promise<void> | null = null

const createApiKeyBodySchema = z.object({
  twitterId: z.string().trim().min(1).optional(),
  rotateExisting: z.coerce.boolean().optional().default(false)
})

const telegramLoginSchema = z.object({
  id: z.coerce.string().trim().min(1),
  first_name: z.string().trim().min(1).optional(),
  last_name: z.string().trim().min(1).optional(),
  username: z.string().trim().min(1).optional(),
  photo_url: z.string().trim().url().optional(),
  auth_date: z.coerce.string().trim().min(1),
  hash: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/)
})

const bindTelegramBodySchema = z.object({
  twitterId: z.string().trim().min(1).optional(),
  telegramAuth: telegramLoginSchema,
  referralCode: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional()
})

const topUpBodySchema = z
  .object({
    twitterId: z.string().trim().min(1).optional(),
    apiKey: z.string().trim().min(16).optional(),
    credits: z.coerce.number().int().min(1),
    eventType: z.string().trim().min(1).max(64).optional()
  })
  .refine((value) => Boolean(value.twitterId || value.apiKey), {
    message: 'twitterId or apiKey is required'
  })

const generateApiKey = () => `pawx_${crypto.randomBytes(24).toString('base64url')}`

const hashApiKey = (plainApiKey: string) =>
  crypto.createHash('sha256').update(plainApiKey).digest('hex')

const generateReferralCode = () =>
  crypto
    .randomBytes(6)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 10)
    .toUpperCase()

const verifyTelegramLoginHash = (
  telegramAuth: z.infer<typeof telegramLoginSchema>,
  botToken: string
) => {
  const { hash, ...rest } = telegramAuth
  const dataCheckString = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = crypto.createHash('sha256').update(botToken).digest()
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const providedHashBuffer = Buffer.from(hash, 'hex')
  const expectedHashBuffer = Buffer.from(expectedHash, 'hex')

  if (providedHashBuffer.length !== expectedHashBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(providedHashBuffer, expectedHashBuffer)
}

const isTelegramLoginFresh = (authDate: string) => {
  const authTimestamp = Number(authDate)
  if (!Number.isFinite(authTimestamp)) {
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  const age = now - authTimestamp

  return age >= 0 && age <= TELEGRAM_LOGIN_MAX_AGE_SECONDS
}

const ensureApiCreditLedgerEventTypes = async () => {
  if (!ensureApiCreditLedgerEventTypesPromise) {
    ensureApiCreditLedgerEventTypesPromise = (async () => {
      const existingRows = await db('primary').execute(sql`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'api_credit_event_type'
          AND e.enumlabel IN (${sql.join(
            CREDIT_INCREASE_LEDGER_EVENT_TYPES.map((eventType) => sql`${eventType}`),
            sql`, `
          )})
      `)

      const existingEventTypes = new Set(
        existingRows
          .map((row) => row.enumlabel)
          .filter((enumlabel): enumlabel is string => typeof enumlabel === 'string')
      )

      for (const eventType of CREDIT_INCREASE_LEDGER_EVENT_TYPES) {
        if (existingEventTypes.has(eventType)) {
          continue
        }

        await db('primary').execute(
          sql.raw(`ALTER TYPE api_credit_event_type ADD VALUE IF NOT EXISTS '${eventType}'`)
        )
      }
    })().catch((error) => {
      ensureApiCreditLedgerEventTypesPromise = null
      throw error
    })
  }

  await ensureApiCreditLedgerEventTypesPromise
}

const findAccountByTwitterId = async (
  executor: DbExecutor,
  twitterId: string
): Promise<ApiCreditAccountRow | null> => {
  const result = await executor.execute(sql`
    SELECT id, member_tg_id, twitter_id, status, available_credits, invited_by_tg_id
    FROM api_credit_accounts
    WHERE twitter_id = ${twitterId}
    LIMIT 1
  `)
  return (result[0] as ApiCreditAccountRow | undefined) || null
}

const findAccountByApiKey = async (apiKey: string): Promise<ApiKeyLookupRow | null> => {
  const apiKeyHash = hashApiKey(apiKey)
  const result = await db('primary').execute(sql`
    SELECT
      a.id AS account_id,
      a.member_tg_id,
      a.twitter_id,
      a.status AS account_status,
      a.available_credits,
      a.invited_by_tg_id,
      k.id AS api_key_id,
      k.status AS key_status
    FROM api_keys k
    JOIN api_credit_accounts a ON a.id = k.api_credit_account_id
    WHERE k.key_hash = ${apiKeyHash}
      AND k.status = 'active'
    LIMIT 1
  `)
  return (result[0] as ApiKeyLookupRow | undefined) || null
}

const findActiveApiKeyByAccountId = async (
  executor: DbExecutor,
  accountId: string
): Promise<ActiveApiKeyRow | null> => {
  const result = await executor.execute(sql`
    SELECT id, key_last4
    FROM api_keys
    WHERE api_credit_account_id = ${accountId}
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `)
  return (result[0] as ActiveApiKeyRow | undefined) || null
}

const findAccountByTelegramId = async (
  executor: DbExecutor,
  telegramId: string
): Promise<ApiCreditAccountRow | null> => {
  const result = await executor.execute(sql`
    SELECT id, member_tg_id, twitter_id, status, available_credits, invited_by_tg_id
    FROM api_credit_accounts
    WHERE member_tg_id = ${telegramId}
    LIMIT 1
  `)
  return (result[0] as ApiCreditAccountRow | undefined) || null
}

const findAccountById = async (
  executor: DbExecutor,
  accountId: string
): Promise<ApiCreditAccountRow | null> => {
  const result = await executor.execute(sql`
    SELECT id, member_tg_id, twitter_id, status, available_credits, invited_by_tg_id
    FROM api_credit_accounts
    WHERE id = ${accountId}
    LIMIT 1
  `)
  return (result[0] as ApiCreditAccountRow | undefined) || null
}

export const applyApiCreditTopUp = async (
  executor: DbExecutor,
  params: ApiCreditTopUpParams
): Promise<ApiCreditTopUpResult> => {
  await ensureApiCreditLedgerEventTypes()
  const eventType = params.eventType?.trim() || 'topup'

  const account =
    (params.accountId ? await findAccountById(executor, params.accountId) : null) ||
    (params.twitterId ? await findAccountByTwitterId(executor, params.twitterId) : null) ||
    (params.telegramId ? await findAccountByTelegramId(executor, params.telegramId) : null)

  if (!account) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Account not found')
  }

  const updatedRows = await executor.execute(sql`
    UPDATE api_credit_accounts
    SET available_credits = available_credits + ${params.credits}, updated_at = NOW()
    WHERE id = ${account.id}
    RETURNING available_credits
  `)

  const updatedCredits = Number(updatedRows[0]?.available_credits ?? account.available_credits)

  await executor.execute(sql`
    INSERT INTO api_credit_ledger (
      api_credit_account_id,
      event_type,
      delta,
      balance_after,
      created_at,
      updated_at
    )
    VALUES (${account.id}, ${eventType}, ${params.credits}, ${updatedCredits}, NOW(), NOW())
  `)

  return {
    accountId: account.id,
    balanceAfter: updatedCredits,
    invitedByTgId: account.invited_by_tg_id,
    memberTgId: account.member_tg_id,
    toppedUpCredits: params.credits,
    twitterId: account.twitter_id
  }
}

const findMemberProfileByTelegramId = async (
  executor: DbExecutor,
  telegramId: string
): Promise<MemberProfileRow | null> => {
  const result = await executor.execute(sql`
    SELECT tg_id, tg_meta, sub_limit, referral_code
    FROM members
    WHERE tg_id = ${telegramId}
    LIMIT 1
  `)
  return (result[0] as MemberProfileRow | undefined) || null
}

const findMemberByReferralCode = async (
  executor: DbExecutor,
  referralCode: string
): Promise<MemberCodeLookupRow | null> => {
  const normalizedReferralCode = referralCode.trim().toLowerCase()
  const result = await executor.execute(sql`
    SELECT tg_id
    FROM members
    WHERE LOWER(referral_code) = ${normalizedReferralCode}
    LIMIT 1
  `)
  return (result[0] as MemberCodeLookupRow | undefined) || null
}

export const assertAuthorizedTopUpRequest = (c: Context) => {
  const configuredSecret = config.apiCreditTopUpSecret?.trim()
  if (!configuredSecret) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'API_CREDIT_TOP_UP_SECRET is missing')
  }

  const providedSecret = c.req.header(TOP_UP_SECRET_HEADER)?.trim()
  if (!providedSecret) {
    throw new ApiError(httpStatus.UNAUTHORIZED, `${TOP_UP_SECRET_HEADER} header is required`)
  }

  const configuredSecretBuffer = Buffer.from(configuredSecret)
  const providedSecretBuffer = Buffer.from(providedSecret)
  if (
    configuredSecretBuffer.length !== providedSecretBuffer.length ||
    !crypto.timingSafeEqual(configuredSecretBuffer, providedSecretBuffer)
  ) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Unauthorized top-up request')
  }
}

const applyStandardRateLimit = (apiKey: string, windowMs: number, maxRequests: number) => {
  const now = Date.now()
  const entry = rateLimitStore.get(apiKey)

  if (!entry || entry.resetTime <= now) {
    rateLimitStore.set(apiKey, {
      count: 1,
      resetTime: now + windowMs
    })
  } else {
    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000)
      throw new ApiError(
        httpStatus.TOO_MANY_REQUESTS,
        `Rate limit exceeded. Try again in ${retryAfter} seconds.`
      )
    }
    entry.count++
    rateLimitStore.set(apiKey, entry)
  }

  return rateLimitStore.get(apiKey)!
}

export const getRateLimitInfo = (apiKey: string): RateLimitEntry | null => {
  const entry = rateLimitStore.get(apiKey)
  if (!entry || entry.resetTime <= Date.now()) {
    return null
  }
  return entry
}

export const resetRateLimit = (apiKey: string): void => {
  rateLimitStore.delete(apiKey)
}

export const getRateLimitStats = () => {
  const now = Date.now()
  const keys = Array.from(rateLimitStore.keys())
  const activeKeys = keys.filter((apiKey) => {
    const entry = rateLimitStore.get(apiKey)
    return entry && entry.resetTime > now
  })

  return {
    totalActiveKeys: activeKeys.length,
    totalStoredKeys: rateLimitStore.size
  }
}

interface RateLimitConfig {
  windowMs?: number
  maxRequests?: number
  headerName?: string
  queryParamName?: string
}

export const parseCreateApiKeyBody = (body: unknown) => createApiKeyBodySchema.parse(body)

export const createTwitterApiKeyResult = async ({
  createdFromSession,
  rotateExisting,
  twitterId
}: {
  createdFromSession: boolean
  rotateExisting: boolean
  twitterId: string
}) => {
  const generatedApiKey = generateApiKey()
  const generatedApiKeyHash = hashApiKey(generatedApiKey)
  const keyLast4 = generatedApiKey.slice(-4)
  const ensuredAccount = await ensureXApiCreditAccount(twitterId)

  const result = await db('primary').transaction(async (tx) => {
    const account = ensuredAccount.account

    if (!account) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create account')
    }

    const activeApiKey = await findActiveApiKeyByAccountId(tx, account.id)
    if (activeApiKey && !rotateExisting) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Active API key already exists (ending with ${activeApiKey.key_last4})`
      )
    }

    if (activeApiKey && rotateExisting) {
      await tx.execute(sql`
        UPDATE api_keys
        SET status = 'inactive', updated_at = NOW()
        WHERE api_credit_account_id = ${account.id}
          AND status = 'active'
      `)
    }

    await tx.execute(sql`
      INSERT INTO api_keys (
        api_credit_account_id,
        key_hash,
        key_last4,
        status,
        created_at,
        updated_at
      )
      VALUES (${account.id}, ${generatedApiKeyHash}, ${keyLast4}, 'active', NOW(), NOW())
    `)

    return account
  })

  return {
    apiKey: generatedApiKey,
    twitterId: result.twitter_id,
    accountId: result.id,
    credits: Number(result.available_credits),
    signupCredits: TWITTER_SIGNUP_CREDITS,
    createdFromSession
  }
}

export const parseBindTelegramBody = (body: unknown) => bindTelegramBodySchema.parse(body)

export const bindTelegramForApiCreditsResult = async ({
  referralCode,
  telegramAuth,
  twitterId
}: {
  referralCode?: string
  telegramAuth: z.infer<typeof telegramLoginSchema>
  twitterId: string
}) => {
  const telegramId = telegramAuth.id

  if (!config.telegramBotToken) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'TELEGRAM_BOT_TOKEN is missing')
  }

  if (!isTelegramLoginFresh(telegramAuth.auth_date)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Telegram login has expired')
  }

  if (!verifyTelegramLoginHash(telegramAuth, config.telegramBotToken)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Telegram login payload')
  }

  await ensureApiCreditLedgerEventTypes()

  const bindResult = await db('primary').transaction(async (tx) => {
    const account = await findAccountByTwitterId(tx, twitterId)
    if (!account) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Account not found. Please login with Twitter first.'
      )
    }

    if (account.member_tg_id && account.member_tg_id !== telegramId) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This X account is already bound to another Telegram account'
      )
    }

    const existingTelegramAccount = await findAccountByTelegramId(tx, telegramId)
    if (existingTelegramAccount && existingTelegramAccount.twitter_id !== twitterId) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This Telegram account is already bound to another X account'
      )
    }

    const isEligibleForReferralBonus = !account.invited_by_tg_id

    await tx.execute(sql`
      INSERT INTO members (tg_id, tg_meta, sub_limit, created_at, updated_at)
      VALUES (
        ${telegramId},
        ${JSON.stringify(telegramAuth)}::json,
        ${DEFAULT_MEMBER_SUB_LIMIT},
        NOW(),
        NOW()
      )
      ON CONFLICT (tg_id) DO UPDATE
      SET
        tg_meta = EXCLUDED.tg_meta,
        sub_limit = GREATEST(members.sub_limit, EXCLUDED.sub_limit),
        updated_at = NOW()
    `)

    const currentMemberRows = await tx.execute(sql`
      SELECT referral_code
      FROM members
      WHERE tg_id = ${telegramId}
      LIMIT 1
    `)
    const currentCode = currentMemberRows[0]?.referral_code
    let finalReferralCode = typeof currentCode === 'string' ? currentCode : ''

    if (!finalReferralCode) {
      finalReferralCode = generateReferralCode()
      await tx.execute(sql`
        UPDATE members
        SET referral_code = ${finalReferralCode}, updated_at = NOW()
        WHERE tg_id = ${telegramId}
      `)
    }

    let updatedCredits = Number(account.available_credits)
    let awardedBindCredits = 0
    if (!account.member_tg_id) {
      const updatedRows = await tx.execute(sql`
        UPDATE api_credit_accounts
        SET member_tg_id = ${telegramId}, available_credits = available_credits + ${TELEGRAM_BIND_CREDITS}, updated_at = NOW()
        WHERE id = ${account.id}
        RETURNING available_credits
      `)
      updatedCredits = Number(updatedRows[0]?.available_credits ?? updatedCredits)
      awardedBindCredits = TELEGRAM_BIND_CREDITS
      await tx.execute(sql`
        INSERT INTO api_credit_ledger (
          api_credit_account_id,
          event_type,
          delta,
          balance_after,
          created_at,
          updated_at
        )
        VALUES (
          ${account.id},
          ${TELEGRAM_BIND_LEDGER_EVENT_TYPE},
          ${TELEGRAM_BIND_CREDITS},
          ${updatedCredits},
          NOW(),
          NOW()
        )
      `)
    }

    let inviterTgId: string | null = account.invited_by_tg_id
    let awardedReferralCredits = 0
    if (referralCode && referralCode.trim().length > 0 && isEligibleForReferralBonus) {
      const inviter = await findMemberByReferralCode(tx, referralCode)
      if (inviter && inviter.tg_id !== telegramId) {
        inviterTgId = inviter.tg_id

        const insertedReferralRows = await tx.execute(sql`
          INSERT INTO referrals (referrer_id, referree_id, referral_scope, created_at, updated_at)
          VALUES (
            ${inviter.tg_id},
            ${telegramId},
            ${REFERRAL_SCOPE_API_SERVICE},
            NOW(),
            NOW()
          )
          ON CONFLICT (referrer_id, referree_id, referral_scope) DO NOTHING
          RETURNING referrer_id
        `)
        const insertedReferral = insertedReferralRows[0]

        if (insertedReferral) {
          const claimedRows = await tx.execute(sql`
            UPDATE api_credit_accounts
            SET invited_by_tg_id = ${inviter.tg_id}, updated_at = NOW()
            WHERE id = ${account.id} AND invited_by_tg_id IS NULL
            RETURNING id
          `)

          if (claimedRows[0]?.id) {
            const inviterUpdatedRows = await tx.execute(sql`
              UPDATE api_credit_accounts
              SET available_credits = available_credits + ${REFERRAL_BONUS_CREDITS}, updated_at = NOW()
              WHERE member_tg_id = ${inviter.tg_id}
              RETURNING id, available_credits
            `)
            const inviterUpdated = inviterUpdatedRows[0]
            if (inviterUpdated?.id) {
              awardedReferralCredits = REFERRAL_BONUS_CREDITS
              await tx.execute(sql`
                INSERT INTO api_credit_ledger (
                  api_credit_account_id,
                  event_type,
                  delta,
                  balance_after,
                  created_at,
                  updated_at
                )
                VALUES (
                  ${inviterUpdated.id},
                  'referral_bonus',
                  ${REFERRAL_BONUS_CREDITS},
                  ${inviterUpdated.available_credits},
                  NOW(),
                  NOW()
                )
              `)
            }
          } else {
            inviterTgId = account.invited_by_tg_id
          }
        }
      }
    }

    const memberProfile = await findMemberProfileByTelegramId(tx, telegramId)

    return {
      twitterId,
      telegramId,
      telegramUsername:
        typeof memberProfile?.tg_meta?.username === 'string'
          ? memberProfile.tg_meta.username
          : (telegramAuth.username ?? null),
      telegramPhotoUrl:
        typeof memberProfile?.tg_meta?.photo_url === 'string'
          ? memberProfile.tg_meta.photo_url
          : (telegramAuth.photo_url ?? null),
      referralCode:
        typeof memberProfile?.referral_code === 'string'
          ? memberProfile.referral_code
          : finalReferralCode,
      subLimit:
        memberProfile?.sub_limit === null || memberProfile?.sub_limit === undefined
          ? DEFAULT_MEMBER_SUB_LIMIT
          : Number(memberProfile.sub_limit),
      invitedByTgId: inviterTgId,
      credits: updatedCredits,
      awardedBindCredits,
      awardedReferralCredits,
      verifiedBy: 'telegram_login'
    }
  })

  const refreshedMemberProfile = await findMemberTelegramProfileById(telegramId)
  const refreshedTgMeta = refreshedMemberProfile
    ? await refreshMemberTelegramProfile(telegramId, refreshedMemberProfile.tg_meta, {
        force: true,
        memberUpdatedAt: refreshedMemberProfile.updated_at
      })
    : null

  return {
    ...bindResult,
    telegramUsername:
      typeof refreshedTgMeta?.username === 'string'
        ? refreshedTgMeta.username
        : bindResult.telegramUsername,
    telegramPhotoUrl:
      typeof refreshedTgMeta?.photo_url === 'string'
        ? refreshedTgMeta.photo_url
        : bindResult.telegramPhotoUrl
  }
}

export const parseTopUpBody = (body: unknown) => topUpBodySchema.parse(body)

export const topUpApiCreditsResult = async (body: z.infer<typeof topUpBodySchema>) => {
  const accountByApiKey = body.apiKey ? await findAccountByApiKey(body.apiKey) : null
  const twitterId = body.twitterId || accountByApiKey?.twitter_id
  if (!twitterId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot resolve target account')
  }

  const result = await db('primary').transaction(async (tx) => {
    const topUpResult = await applyApiCreditTopUp(tx, {
      credits: body.credits,
      eventType: body.eventType,
      twitterId
    })

    return {
      twitterId: topUpResult.twitterId,
      credits: topUpResult.balanceAfter,
      toppedUpCredits: topUpResult.toppedUpCredits
    }
  })

  return result
}

export const apiKeyRateLimiter = (config: RateLimitConfig = {}) => {
  const {
    windowMs = RATE_LIMIT_WINDOW_MS,
    maxRequests = RATE_LIMIT_MAX_REQUESTS,
    headerName = 'X-API-Key',
    queryParamName = 'apiKey'
  } = config

  return async (c: Context, next: Next) => {
    const method = c.req.method
    const path = c.req.path
    const queryParams = c.req.query()
    const userAgent = c.req.header('User-Agent') || 'Unknown'
    const ip = c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP') || 'Unknown'

    if (path.startsWith(managementPathPrefix)) {
      await next()
      return
    }

    const apiKey = extractApiKey(c, headerName, queryParamName)
    if (!apiKey) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'API key is required')
    }

    const currentEntry = applyStandardRateLimit(apiKey, windowMs, maxRequests)

    const managedAccount = await findAccountByApiKey(apiKey)
    if (!managedAccount) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid API key')
    }
    if (managedAccount.account_status !== 'active') {
      throw new ApiError(httpStatus.FORBIDDEN, 'API account is not active')
    }
    if (Number(managedAccount.available_credits) <= 0) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, 'Insufficient credits. Please top up.')
    }

    await next()

    if (c.res.status >= 200 && c.res.status < 300) {
      const deductResult = await db('primary').execute(sql`
        UPDATE api_credit_accounts
        SET available_credits = available_credits - 1, updated_at = NOW()
        WHERE id = ${managedAccount.account_id}
          AND available_credits > 0
        RETURNING available_credits
      `)
      const updatedAccount = deductResult[0]
      if (!updatedAccount) {
        throw new ApiError(httpStatus.PAYMENT_REQUIRED, 'Insufficient credits. Please top up.')
      }
      await db('primary').execute(sql`
        INSERT INTO api_credit_ledger (
          api_credit_account_id,
          api_key_id,
          event_type,
          delta,
          balance_after,
          created_at,
          updated_at
        )
        VALUES (
          ${managedAccount.account_id},
          ${managedAccount.api_key_id},
          'api_call',
          -1,
          ${updatedAccount.available_credits},
          NOW(),
          NOW()
        )
      `)
      await db('primary').execute(sql`
        UPDATE api_keys
        SET last_used_at = NOW(), updated_at = NOW()
        WHERE id = ${managedAccount.api_key_id}
      `)
      c.header('X-Credits-Remaining', Number(updatedAccount.available_credits).toString())
    }

    const remaining = maxRequests - currentEntry.count
    const resetTime = new Date(currentEntry.resetTime).toISOString()
    c.header('X-RateLimit-Limit', maxRequests.toString())
    c.header('X-RateLimit-Remaining', remaining.toString())
    c.header('X-RateLimit-Reset', resetTime)

    logger.info({
      message: 'API request processed',
      method,
      path,
      queryParams,
      apiKey: apiKey.substring(0, 8) + '...',
      rateLimit: {
        current: currentEntry.count,
        limit: maxRequests,
        remaining,
        resetTime
      },
      userAgent,
      ip
    })
  }
}
