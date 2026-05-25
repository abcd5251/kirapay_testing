import crypto from 'crypto'
import { sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import httpStatus from 'http-status'
import { config } from '@/config'
import db from '@/db'
import { ApiError } from '@/utils/ApiError'
import { logger } from '@/utils/logger'

const X_SESSION_COOKIE_NAME = 'pawx_x_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const OAUTH_STATE_DURATION_MS = 10 * 60 * 1000

type CookieSameSite = 'Lax' | 'Strict' | 'None'

type OAuthStatePayload = {
  codeVerifier: string
  frontendRedirectUrl: string | null
  issuedAt: number
  nonce: string
}

export type XSessionPayload = {
  twitterId: string
  username: string
  name: string
  avatarUrl: string | null
  profileUrl: string
  createdAt: number
  expiresAt: number
}

type XTokenResponse = {
  access_token: string
  token_type: string
  expires_in?: number
  scope?: string
  refresh_token?: string
}

type XMeResponse = {
  data?: {
    id: string
    username: string
    name: string
    profile_image_url?: string
  }
  errors?: Array<{
    message?: string
  }>
}

type ApiCreditAccountRow = {
  id: string
  member_tg_id: string | null
  twitter_id: string
  status: 'active' | 'inactive' | 'suspended'
  available_credits: number
  invited_by_tg_id: string | null
}

const TWITTER_SIGNUP_CREDITS = 2500

function encodeBase64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, 'base64').toString('utf8')
}

function signValue(value: string, secret: string) {
  return encodeBase64Url(crypto.createHmac('sha256', secret).update(value).digest())
}

function serializeSignedPayload(payload: Record<string, unknown>, secret: string) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  return `${encodedPayload}.${signValue(encodedPayload, secret)}`
}

function parseSignedPayload<T>(cookieValue: string | undefined, secret: string) {
  if (!cookieValue) {
    return null
  }

  const [encodedPayload, signature] = cookieValue.split('.')
  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = signValue(encodedPayload, secret)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null
  }

  try {
    return JSON.parse(decodeBase64Url(encodedPayload)) as T
  } catch {
    return null
  }
}

function getCookieSameSite() {
  switch (config.cookieSameSite) {
    case 'none':
      return 'None' satisfies CookieSameSite
    case 'strict':
      return 'Strict' satisfies CookieSameSite
    default:
      return 'Lax' satisfies CookieSameSite
  }
}

function assertXAuthConfig() {
  if (!config.xClientId || !config.xClientSecret || !config.xCallbackUrl || !config.sessionSecret) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'X OAuth environment variables are missing'
    )
  }

  if (!config.frontendUrl) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'FRONTEND_URL is missing')
  }
}

function setSignedCookieValue(
  c: Context,
  name: string,
  payload: Record<string, unknown>,
  maxAgeMs: number
) {
  if (!config.sessionSecret) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'SESSION_SECRET is missing')
  }

  setCookie(c, name, serializeSignedPayload(payload, config.sessionSecret), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: getCookieSameSite(),
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000)
  })
}

export function clearXAuthCookies(c: Context) {
  deleteCookie(c, X_SESSION_COOKIE_NAME, {
    path: '/'
  })
}

export function getAllowedFrontendOrigins() {
  const origins = new Set<string>()

  if (config.frontendUrl) {
    try {
      origins.add(new URL(config.frontendUrl).origin)
    } catch {
      origins.add(config.frontendUrl)
    }
  }

  if (config.corsOrigin) {
    for (const origin of config.corsOrigin.split(',')) {
      const trimmedOrigin = origin.trim()
      if (trimmedOrigin) {
        origins.add(trimmedOrigin)
      }
    }
  }

  return Array.from(origins)
}

export function getValidatedFrontendRedirectUrl(urlValue?: string | null) {
  if (!urlValue) {
    return null
  }

  try {
    const parsedUrl = new URL(urlValue)
    if (!getAllowedFrontendOrigins().includes(parsedUrl.origin)) {
      return null
    }
    return parsedUrl.toString()
  } catch {
    return null
  }
}

export function assertAllowedFrontendOrigin(c: Context) {
  const origin = c.req.header('Origin')
  const allowedOrigins = getAllowedFrontendOrigins()

  if (!origin || !allowedOrigins.includes(origin)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Request origin is not allowed')
  }
}

export function createXOAuthStartUrl(frontendRedirectUrl?: string | null) {
  assertXAuthConfig()

  if (!config.sessionSecret) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'SESSION_SECRET is missing')
  }

  const codeVerifier = encodeBase64Url(crypto.randomBytes(48))
  const codeChallenge = encodeBase64Url(crypto.createHash('sha256').update(codeVerifier).digest())

  const statePayload: OAuthStatePayload = {
    codeVerifier,
    frontendRedirectUrl: frontendRedirectUrl ?? null,
    issuedAt: Date.now(),
    nonce: encodeBase64Url(crypto.randomBytes(16))
  }
  const state = serializeSignedPayload(
    statePayload as unknown as Record<string, unknown>,
    config.sessionSecret
  )

  const searchParams = new URLSearchParams({
    response_type: 'code',
    client_id: config.xClientId!,
    redirect_uri: config.xCallbackUrl!,
    scope: ['tweet.read', 'users.read', 'offline.access'].join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  })

  logger().info(
    { frontendRedirectUrl: frontendRedirectUrl ?? null, stateLength: state.length },
    'X OAuth start URL created'
  )

  return {
    url: `https://twitter.com/i/oauth2/authorize?${searchParams.toString()}`
  }
}

export function verifyXOAuthState(state: string): OAuthStatePayload | null {
  if (!config.sessionSecret) {
    logger().error('SESSION_SECRET missing while verifying X OAuth state')
    return null
  }

  const payload = parseSignedPayload<OAuthStatePayload>(state, config.sessionSecret)
  if (!payload) {
    logger().warn({ statePreview: state.slice(0, 16) }, 'X OAuth state signature invalid')
    return null
  }

  const age = Date.now() - payload.issuedAt
  if (age > OAUTH_STATE_DURATION_MS || age < 0) {
    logger().warn({ ageMs: age }, 'X OAuth state expired or issued in future')
    return null
  }

  return payload
}

export async function exchangeXOAuthCode(input: { code: string; codeVerifier: string }) {
  assertXAuthConfig()

  const basicAuth = Buffer.from(`${config.xClientId!}:${config.xClientSecret!}`).toString('base64')
  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code: input.code,
      grant_type: 'authorization_code',
      client_id: config.xClientId!,
      redirect_uri: config.xCallbackUrl!,
      code_verifier: input.codeVerifier
    }).toString()
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new ApiError(httpStatus.BAD_GATEWAY, `Failed to exchange X OAuth token: ${errorBody}`)
  }

  return (await response.json()) as XTokenResponse
}

export async function fetchXUserProfile(accessToken: string) {
  const response = await fetch(
    'https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  )

  const payload = (await response.json()) as XMeResponse

  if (!response.ok || !payload.data) {
    const errorMessage = payload.errors?.[0]?.message || 'Failed to load X user profile'
    throw new ApiError(httpStatus.BAD_GATEWAY, errorMessage)
  }

  return payload.data
}

export async function ensureXApiCreditAccount(twitterId: string) {
  return db('primary').transaction(async (tx) => {
    const existingRows = await tx.execute(sql`
      SELECT id, member_tg_id, twitter_id, status, available_credits, invited_by_tg_id
      FROM api_credit_accounts
      WHERE twitter_id = ${twitterId}
      LIMIT 1
    `)
    const existingAccount = (existingRows[0] as ApiCreditAccountRow | undefined) || null

    if (existingAccount) {
      return {
        account: existingAccount,
        created: false
      }
    }

    const insertedRows = await tx.execute(sql`
      INSERT INTO api_credit_accounts (
        twitter_id,
        status,
        available_credits,
        created_at,
        updated_at
      )
      VALUES (${twitterId}, 'active', ${TWITTER_SIGNUP_CREDITS}, NOW(), NOW())
      ON CONFLICT (twitter_id) DO NOTHING
      RETURNING id, member_tg_id, twitter_id, status, available_credits, invited_by_tg_id
    `)
    const insertedAccount = (insertedRows[0] as ApiCreditAccountRow | undefined) || null
    let account = insertedAccount

    if (!account) {
      const fallbackRows = await tx.execute(sql`
        SELECT id, member_tg_id, twitter_id, status, available_credits, invited_by_tg_id
        FROM api_credit_accounts
        WHERE twitter_id = ${twitterId}
        LIMIT 1
      `)
      account = (fallbackRows[0] as ApiCreditAccountRow | undefined) || null
    }

    if (!account) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create account')
    }

    if (insertedAccount) {
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
          'signup_bonus',
          ${TWITTER_SIGNUP_CREDITS},
          ${account.available_credits},
          NOW(),
          NOW()
        )
      `)
    }

    return {
      account,
      created: Boolean(insertedAccount)
    }
  })
}

export function setXSession(c: Context, session: Omit<XSessionPayload, 'createdAt' | 'expiresAt'>) {
  const now = Date.now()
  setSignedCookieValue(
    c,
    X_SESSION_COOKIE_NAME,
    {
      ...session,
      createdAt: now,
      expiresAt: now + SESSION_DURATION_MS
    },
    SESSION_DURATION_MS
  )
}

export function getXSession(c: Context) {
  if (!config.sessionSecret) {
    return null
  }

  const payload = parseSignedPayload<XSessionPayload>(
    getCookie(c, X_SESSION_COOKIE_NAME),
    config.sessionSecret
  )

  if (!payload || payload.expiresAt <= Date.now()) {
    return null
  }

  return payload
}

export function getFrontendRedirectUrlFromRequest(c: Context) {
  return getValidatedFrontendRedirectUrl(c.req.query('redirectUrl') || c.req.header('referer'))
}

export function getFrontendAuthSuccessUrl(redirectUrl?: string | null) {
  assertXAuthConfig()
  const url = new URL(getValidatedFrontendRedirectUrl(redirectUrl) || config.frontendUrl!)
  url.searchParams.set('auth', 'success')
  return url.toString()
}

export function getFrontendAuthErrorUrl(reason: string, redirectUrl?: string | null) {
  assertXAuthConfig()
  const url = new URL(getValidatedFrontendRedirectUrl(redirectUrl) || config.frontendUrl!)
  url.searchParams.set('auth', 'error')
  url.searchParams.set('reason', reason)
  return url.toString()
}
