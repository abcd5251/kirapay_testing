import type { Context } from 'hono'
import httpStatus from 'http-status'
import { config } from '@/config'
import {
  assertAuthorizedTopUpRequest,
  bindTelegramForApiCreditsResult,
  createTwitterApiKeyResult,
  parseBindTelegramBody,
  parseCreateApiKeyBody,
  parseTopUpBody,
  topUpApiCreditsResult
} from '@/middlewares/apiKeyRateLimiter'
import {
  createReferralPaymentResult,
  createTelegramReferralResult,
  findManagedAccountByApiKey,
  findManagedAccountByTwitterId,
  getApiCreditEventsPayload,
  getApiCreditIncreaseHistoryPayload,
  getApiKeyAccountProfilePayload,
  getApiKeyUsagePayload,
  getTelegramReferralProfilePayload,
  resolveTelegramReferralCodeResult
} from '@/services/apiCredit.service'
import type { ApiCreditAccessContext, ReferralWritableAccount } from '@/services/apiCredit.service'
import { getTelegramPhotoProxyResponse } from '@/services/telegramProfile.service'
import { assertAllowedFrontendOrigin, getXSession } from '@/services/xAuth.service'
import { ApiError } from '@/utils/ApiError'
import { extractApiKey } from '@/utils/requestAuth'
import * as apiCreditValidation from '@/validations/apiCredit.validation'

const resolveApiCreditAccessContext = async (c: Context): Promise<ApiCreditAccessContext> => {
  const apiKey = extractApiKey(c)
  const session = getXSession(c)

  if (!apiKey && !session) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'API key or signed-in X session is required')
  }

  if (apiKey) {
    const account = await findManagedAccountByApiKey(apiKey)

    if (account) {
      return {
        apiKeyType: 'managed',
        authSource: 'apiKey',
        account,
        sessionTwitterId: null
      }
    }
  }

  if (session) {
    assertAllowedFrontendOrigin(c)

    return {
      apiKeyType: 'managed',
      authSource: 'session',
      account: await findManagedAccountByTwitterId(session.twitterId),
      sessionTwitterId: session.twitterId
    }
  }

  throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid API key')
}

const resolveReferralWriterAccount = async (c: Context): Promise<ReferralWritableAccount> => {
  const access = await resolveApiCreditAccessContext(c)

  if (access.apiKeyType !== 'managed' || !access.account) {
    throw new ApiError(
      httpStatus.UNAUTHORIZED,
      'Managed API key or signed-in X session is required'
    )
  }

  if (!access.account.member_tg_id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Telegram must be bound before using referral write APIs'
    )
  }

  return access.account as ReferralWritableAccount
}

const resolveBindTelegramTargetTwitterId = async (
  c: Context,
  requestedTwitterId?: string
): Promise<string> => {
  const session = getXSession(c)

  if (session) {
    assertAllowedFrontendOrigin(c)

    if (requestedTwitterId && requestedTwitterId !== session.twitterId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'twitterId does not match the signed-in X account')
    }

    return session.twitterId
  }

  const apiKey = extractApiKey(c)
  if (apiKey) {
    const account = await findManagedAccountByApiKey(apiKey)

    if (!account) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid API key')
    }

    if (account.account_status !== 'active') {
      throw new ApiError(httpStatus.FORBIDDEN, 'API account is not active')
    }

    if (requestedTwitterId && requestedTwitterId !== account.twitter_id) {
      throw new ApiError(httpStatus.FORBIDDEN, 'twitterId does not match the API key account')
    }

    return account.twitter_id
  }

  if (config.env !== 'production' && requestedTwitterId) {
    return requestedTwitterId
  }

  throw new ApiError(
    httpStatus.UNAUTHORIZED,
    'Managed API key or signed-in X session is required before binding Telegram'
  )
}

const getFrontendBaseUrl = (c: Context) =>
  config.frontendUrl?.trim() || c.req.header('origin')?.trim() || null

const getBackendBaseUrl = (c: Context) => config.appBaseUrl?.trim() || new URL(c.req.url).origin

export const getApiKeyAccountProfile = async (c: Context) => {
  const access = await resolveApiCreditAccessContext(c)
  return c.json(await getApiKeyAccountProfilePayload(access))
}

export const getApiKeyUsage = async (c: Context) => {
  const access = await resolveApiCreditAccessContext(c)
  const query = apiCreditValidation.usageQuery.parse(c.req.query())
  return c.json(await getApiKeyUsagePayload(access, query))
}

export const getApiCreditIncreaseHistory = async (c: Context) => {
  const access = await resolveApiCreditAccessContext(c)
  const query = apiCreditValidation.creditIncreaseHistoryQuery.parse(c.req.query())
  return c.json(await getApiCreditIncreaseHistoryPayload(access, query))
}

export const getApiCreditEvents = async (c: Context) => {
  const access = await resolveApiCreditAccessContext(c)
  const query = apiCreditValidation.creditEventsQuery.parse(c.req.query())
  return c.json(await getApiCreditEventsPayload(access, query))
}

export const getTelegramReferralProfile = async (c: Context) => {
  const access = await resolveApiCreditAccessContext(c)
  return c.json(
    await getTelegramReferralProfilePayload(access, getFrontendBaseUrl(c), getBackendBaseUrl(c))
  )
}

export const getTelegramPhotoProxy = async (c: Context) => {
  const telegramId = c.req.param('telegramId')
  if (!telegramId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'telegramId is required')
  }

  return getTelegramPhotoProxyResponse(telegramId)
}

export const resolveTelegramReferralCode = async (c: Context) => {
  const query = apiCreditValidation.referralResolveQuery.parse(c.req.query())
  const result = await resolveTelegramReferralCodeResult(query)
  return c.json(result.body, result.status)
}

export const createTelegramReferral = async (c: Context) => {
  const account = await resolveReferralWriterAccount(c)
  const body = apiCreditValidation.createReferralBody.parse(await c.req.json())
  return c.json(await createTelegramReferralResult(account, body))
}

export const createReferralPayment = async (c: Context) => {
  const account = await resolveReferralWriterAccount(c)
  const body = apiCreditValidation.createReferralPaymentBody.parse(await c.req.json())
  return c.json(await createReferralPaymentResult(account, body))
}

export const createTwitterApiKey = async (c: Context) => {
  const session = getXSession(c)
  const bodyParse =
    c.req.header('content-length') && c.req.header('content-length') !== '0'
      ? await c.req.json()
      : {}
  const body = parseCreateApiKeyBody(bodyParse)
  const allowDirectCreate = config.env !== 'production'
  const twitterId = session?.twitterId ?? body.twitterId

  if (!session && !allowDirectCreate) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in with X before creating an API key')
  }

  if (!twitterId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'twitterId is required')
  }

  if (session && body.twitterId && body.twitterId !== session.twitterId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'twitterId does not match the signed-in X account')
  }

  if (session) {
    assertAllowedFrontendOrigin(c)
  }

  return c.json(
    await createTwitterApiKeyResult({
      createdFromSession: Boolean(session),
      rotateExisting: body.rotateExisting,
      twitterId
    }),
    httpStatus.CREATED
  )
}

export const bindTelegramForApiCredits = async (c: Context) => {
  const body = parseBindTelegramBody(await c.req.json())
  const resolvedTwitterId = await resolveBindTelegramTargetTwitterId(c, body.twitterId)

  return c.json(
    await bindTelegramForApiCreditsResult({
      referralCode: body.referralCode,
      telegramAuth: body.telegramAuth,
      twitterId: resolvedTwitterId
    }),
    httpStatus.OK
  )
}

export const topUpApiCredits = async (c: Context) => {
  assertAuthorizedTopUpRequest(c)
  const body = parseTopUpBody(await c.req.json())
  return c.json(await topUpApiCreditsResult(body), httpStatus.OK)
}
