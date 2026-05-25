import type { Context } from 'hono'
import httpStatus from 'http-status'
import type {
  InvoiceRow,
  KiraPayTransactionItem,
  KiraPayTransactionStatusResponse,
  KiraPayWebhookResponse
} from './payments.types'
import {
  firstBooleanValue,
  firstNumericValue,
  firstStringValue,
  getNestedValue,
  parseNumeric,
  toDate
} from './payments.utils'
import { config } from '@/config'
import { ApiError } from '@/utils/ApiError'
import { logger } from '@/utils/logger'

const log = logger()
const DEFAULT_KIRAPAY_API_BASE_URL = 'https://api.kira-pay.com/api'
const DEFAULT_KIRAPAY_CHECKOUT_BASE_URL = 'https://checkout.kira-pay.com'
const KIRAPAY_FETCH_TIMEOUT_MS = 10000

function getKiraPayFetchOptions(init?: RequestInit): RequestInit {
  return {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(KIRAPAY_FETCH_TIMEOUT_MS)
  }
}

export function extractKiraPayLinkIdFromUrl(url: string) {
  try {
    const parsedUrl = new URL(url)
    const segments = parsedUrl.pathname.split('/').filter((segment) => segment.length > 0)
    return segments.at(-1) ?? null
  } catch {
    return null
  }
}

export function parseWebhookPayload(rawBody: string) {
  const trimmed = rawBody.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {}

  const formData = new URLSearchParams(trimmed)
  const entries = [...formData.entries()]

  if (entries.length === 0) {
    return null
  }

  return Object.fromEntries(entries)
}

export function getRedirectUrl(sessionId: string, requestedRedirectUrl?: string) {
  const baseUrl =
    requestedRedirectUrl || config.appBaseUrl || config.frontendUrl || 'http://localhost:5173'
  const redirectUrl = new URL(baseUrl)
  redirectUrl.searchParams.set('sessionId', sessionId)
  return redirectUrl.toString()
}

function getBackendBaseUrl(c?: Context) {
  const configuredBaseUrl = config.appBaseUrl?.trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  const callbackOrigin = firstStringValue(
    {
      xCallbackUrl: config.xCallbackUrl
    },
    ['xCallbackUrl']
  )
  if (callbackOrigin) {
    try {
      return new URL(callbackOrigin).origin
    } catch {}
  }

  if (c) {
    return new URL(c.req.url).origin
  }

  throw new ApiError(
    httpStatus.INTERNAL_SERVER_ERROR,
    'Unable to determine backend base URL for KiraPay integration'
  )
}

export function getKiraPayApiBaseUrl() {
  return config.kirapayApiBaseUrl || DEFAULT_KIRAPAY_API_BASE_URL
}

export function getKiraPayCallbackUrl(
  c: Context,
  sessionId: string,
  requestedRedirectUrl?: string
) {
  const callbackUrl = new URL('/api/v1/payments/callbacks/kirapay', getBackendBaseUrl(c))
  callbackUrl.searchParams.set('sessionId', sessionId)
  callbackUrl.searchParams.set('redirectUrl', getRedirectUrl(sessionId, requestedRedirectUrl))
  return callbackUrl.toString()
}

export function getKiraPayWebhookUrl(c?: Context) {
  return new URL('/api/v1/payments/webhooks/kirapay', getBackendBaseUrl(c)).toString()
}

export function getKiraPayCheckoutUrl(identifierInUsd: string) {
  const baseUrl = config.kirapayCheckoutBaseUrl || DEFAULT_KIRAPAY_CHECKOUT_BASE_URL
  return `${baseUrl.replace(/\/$/, '')}/${identifierInUsd}`
}

export function getDefaultChainName() {
  return 'Base'
}

export function getRequiredKiraPayApiKey() {
  const apiKey = config.kirapayApiKey?.trim()
  if (!apiKey) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'KIRAPAY_API_KEY is missing')
  }
  return apiKey
}

export async function fetchKiraPayApi<T>(
  path: string,
  searchParams?: Record<string, string | number>
) {
  const url = new URL(`${getKiraPayApiBaseUrl().replace(/\/$/, '')}${path}`)

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    ...getKiraPayFetchOptions(),
    headers: {
      'x-api-key': getRequiredKiraPayApiKey()
    }
  })

  const payload = (await response.json().catch(() => null)) as T | null

  if (!response.ok || !payload) {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'Failed to fetch KiraPay resource')
  }

  return payload
}

async function fetchKiraPayTransactionStatusByHash(hash: string) {
  const url = new URL(
    `${getKiraPayApiBaseUrl().replace(/\/$/, '')}/wallet/transactions/status/${encodeURIComponent(hash)}`
  )
  const response = await fetch(url, getKiraPayFetchOptions())
  const payload = (await response
    .json()
    .catch(() => null)) as KiraPayTransactionStatusResponse | null

  if (!response.ok || !payload) {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'Failed to fetch KiraPay transaction status by hash')
  }

  return payload
}

async function updateKiraPayWebhook(url: string) {
  const response = await fetch(`${getKiraPayApiBaseUrl().replace(/\/$/, '')}/webhooks`, {
    ...getKiraPayFetchOptions(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getRequiredKiraPayApiKey()
    },
    body: JSON.stringify({
      secret: config.sessionSecret || config.jwt.secret,
      url
    })
  })

  const payload = (await response.json().catch(() => null)) as KiraPayWebhookResponse | null

  if (!response.ok || !payload) {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'Failed to update KiraPay webhook endpoint')
  }

  return payload
}

export async function ensureKiraPayWebhookConfigured(c?: Context) {
  const expectedUrl = getKiraPayWebhookUrl(c)
  const existingWebhook = await fetchKiraPayApi<KiraPayWebhookResponse>('/webhooks')
  const currentUrl = existingWebhook.data?.url || existingWebhook.data?.webhookEndpoint?.url || null

  if (currentUrl === expectedUrl) {
    return {
      updated: false,
      url: expectedUrl
    }
  }

  const updatedWebhook = await updateKiraPayWebhook(expectedUrl)

  log.info({
    currentUrl,
    expectedUrl,
    message: 'KiraPay webhook endpoint synchronized',
    updatedUrl: updatedWebhook.data?.url || updatedWebhook.data?.webhookEndpoint?.url || expectedUrl
  })

  return {
    updated: true,
    url: expectedUrl
  }
}

export function getNormalizedSuccessTimestamp(payload: unknown) {
  return toDate(
    firstStringValue(payload, [
      'updatedAt',
      'createdAt',
      'timestamp',
      'data.updatedAt',
      'data.createdAt'
    ]),
    new Date(0)
  ).getTime()
}

export function getKiraPayTransactionHash(payload: unknown) {
  return firstStringValue(payload, [
    'txHash',
    'tx_hash',
    'inputTransactionHash',
    'outTxHash',
    'transactionHash',
    'transaction_hash',
    'hash',
    'data.txHash',
    'data.tx_hash',
    'data.inputTransactionHash',
    'data.outTxHash',
    'data.transactionHash',
    'data.transaction_hash',
    'data.hash',
    'payment.txHash',
    'payment.transactionHash'
  ])
}

export function getKiraPayTransactionReferences(payload: unknown) {
  const values = [
    getKiraPayTransactionHash(payload),
    firstStringValue(payload, [
      '_id',
      'transactionId',
      'data._id',
      'data.transactionId',
      'payment.transactionId'
    ])
  ]

  return new Set(
    values
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase())
  )
}

export function getKiraPayTransactionReferencesFromItem(transaction: KiraPayTransactionItem) {
  const values = [
    transaction._id,
    transaction.transactionId,
    transaction.txHash,
    transaction.tx_hash,
    transaction.inputTransactionHash,
    transaction.outTxHash,
    transaction.transactionHash,
    transaction.transaction_hash,
    transaction.hash
  ]

  return new Set(
    values
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase())
  )
}

export function extractKiraPayTransactionFromStatusPayload(
  payload: KiraPayTransactionStatusResponse | null
) {
  if (!payload?.data || typeof payload.data !== 'object') {
    return null
  }

  const candidates = [
    payload.data,
    getNestedValue(payload, 'data.transaction'),
    getNestedValue(payload, 'data.details')
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }

    const transaction = candidate as KiraPayTransactionItem
    if (getKiraPayTransactionReferencesFromItem(transaction).size > 0) {
      return transaction
    }
  }

  return null
}

export function buildKiraPayTransactionDetailOverlay(transaction: KiraPayTransactionItem) {
  const txHash =
    transaction.txHash ||
    transaction.tx_hash ||
    transaction.inputTransactionHash ||
    transaction.outTxHash ||
    transaction.transactionHash ||
    transaction.transaction_hash ||
    transaction.hash ||
    null

  return {
    amount:
      transaction.amount ??
      transaction.paidAmount ??
      transaction.price ??
      transaction.settlementAmount ??
      undefined,
    chain: transaction.chain ?? transaction.chainName ?? transaction.network ?? undefined,
    createdAt: transaction.createdAt,
    from:
      transaction.from ??
      transaction.sender ??
      transaction.payer ??
      transaction.walletAddress ??
      undefined,
    fromAddress:
      transaction.fromAddress ??
      transaction.from ??
      transaction.sender ??
      transaction.payer ??
      transaction.walletAddress ??
      undefined,
    from_address:
      transaction.fromAddress ??
      transaction.from ??
      transaction.sender ??
      transaction.payer ??
      transaction.walletAddress ??
      undefined,
    hash: txHash,
    token:
      transaction.token ??
      transaction.tokenSymbol ??
      transaction.currency ??
      transaction.asset ??
      undefined,
    tokenSymbol:
      transaction.tokenSymbol ??
      transaction.token ??
      transaction.currency ??
      transaction.asset ??
      undefined,
    to:
      transaction.to ??
      transaction.receiver ??
      transaction.recipient ??
      transaction.merchantAddress ??
      undefined,
    toAddress:
      transaction.toAddress ??
      transaction.to ??
      transaction.receiver ??
      transaction.recipient ??
      transaction.merchantAddress ??
      undefined,
    to_address:
      transaction.toAddress ??
      transaction.to ??
      transaction.receiver ??
      transaction.recipient ??
      transaction.merchantAddress ??
      undefined,
    transactionHash: txHash,
    transactionId: transaction.transactionId ?? transaction._id ?? undefined,
    transaction_hash: txHash,
    txHash,
    tx_hash: txHash,
    updatedAt: transaction.updatedAt
  }
}

export async function enrichKiraPayPaymentPayload(
  payload: unknown,
  findTransactionByReferences: (references: Set<string>) => Promise<KiraPayTransactionItem | null>
) {
  const references = getKiraPayTransactionReferences(payload)
  if (references.size === 0) {
    return payload
  }

  const txHash = getKiraPayTransactionHash(payload)
  let statusPayload: KiraPayTransactionStatusResponse | null = null

  if (txHash) {
    try {
      statusPayload = await fetchKiraPayTransactionStatusByHash(txHash)
    } catch (error) {
      log.warn({
        error,
        message: 'Failed to fetch KiraPay transaction status by hash',
        txHash
      })
    }
  }

  let transactionDetail = extractKiraPayTransactionFromStatusPayload(statusPayload)

  if (!transactionDetail) {
    try {
      transactionDetail = await findTransactionByReferences(references)
    } catch (error) {
      log.warn({
        error,
        message: 'Failed to fetch KiraPay transaction detail from KiraPay API',
        references: [...references]
      })
    }
  }

  if (!payload || typeof payload !== 'object') {
    return transactionDetail ? buildKiraPayTransactionDetailOverlay(transactionDetail) : payload
  }

  const basePayload = payload as Record<string, unknown>
  const dataPayload =
    basePayload.data && typeof basePayload.data === 'object'
      ? (basePayload.data as Record<string, unknown>)
      : null

  if (!transactionDetail) {
    if (!statusPayload?.data || !dataPayload) {
      return payload
    }

    return {
      ...basePayload,
      data: {
        ...dataPayload,
        status:
          firstStringValue(dataPayload, ['status']) ||
          firstStringValue(statusPayload, ['data.status']) ||
          undefined
      }
    }
  }

  const overlay = buildKiraPayTransactionDetailOverlay(transactionDetail)

  return {
    ...basePayload,
    ...overlay,
    data: {
      ...dataPayload,
      ...overlay,
      status:
        firstStringValue(dataPayload, ['status']) ||
        firstStringValue(statusPayload, ['data.status']) ||
        firstStringValue(basePayload, ['status']) ||
        undefined
    }
  }
}

export function normalizeWebhookStatus(payload: unknown) {
  const successFlag = firstBooleanValue(payload, [
    'success',
    'paid',
    'completed',
    'data.success',
    'data.paid',
    'data.completed',
    'payment.success',
    'payment.paid'
  ])

  if (successFlag === true) {
    return {
      rawStatus: 'success',
      status: 'success' as const
    }
  }

  const rawStatus = firstStringValue(payload, [
    'status',
    'result',
    'state',
    'event',
    'eventName',
    'paymentStatus',
    'type',
    'data.status',
    'data.result',
    'data.state',
    'data.event',
    'data.eventName',
    'data.paymentStatus',
    'payment.status',
    'payment.paymentStatus'
  ])

  const normalized = rawStatus?.trim().toLowerCase() ?? null

  if (
    normalized &&
    ['paid', 'completed', 'confirmed', 'success', 'succeeded'].some((status) =>
      normalized.includes(status)
    )
  ) {
    return {
      rawStatus,
      status: 'success' as const
    }
  }

  if (
    normalized &&
    ['failed', 'cancelled', 'expired', 'voided'].some((status) => normalized.includes(status))
  ) {
    return {
      rawStatus,
      status: 'failed' as const
    }
  }

  if (
    normalized &&
    ['pending', 'processing', 'created'].some((status) => normalized.includes(status))
  ) {
    return {
      rawStatus,
      status: 'pending' as const
    }
  }

  const transactionReference = firstStringValue(payload, [
    'txHash',
    'tx_hash',
    'transactionId',
    'inputTransactionHash',
    'outTxHash',
    'transactionHash',
    'transaction_hash',
    'hash',
    'data.txHash',
    'data.tx_hash',
    'data.transactionId',
    'data.transactionHash',
    'payment.txHash',
    'payment.transactionHash'
  ])

  if (transactionReference) {
    return {
      rawStatus: rawStatus || 'txHash',
      status: 'success' as const
    }
  }

  return {
    rawStatus,
    status: null
  }
}

export function getWebhookEventName(payload: unknown) {
  return firstStringValue(payload, [
    'event',
    'eventName',
    'type',
    'data.event',
    'data.eventName',
    'payment.event'
  ])
}

export function getWebhookPaidAt(payload: unknown) {
  const paidAt = firstStringValue(payload, [
    'paidAt',
    'paid_at',
    'completedAt',
    'confirmedAt',
    'updatedAt',
    'createdAt',
    'timestamp',
    'data.paidAt',
    'data.completedAt',
    'data.updatedAt',
    'data.timestamp',
    'payment.paidAt',
    'payment.completedAt'
  ])

  return paidAt ? toDate(paidAt) : new Date()
}

export function getWebhookPaymentDetails(payload: unknown, invoice: InvoiceRow) {
  const fallbackIdentifier = invoice.identifier_in_usd || invoice.id
  const txHash =
    firstStringValue(payload, [
      'txHash',
      'tx_hash',
      'hash',
      'transactionId',
      'inputTransactionHash',
      'outTxHash',
      'transactionHash',
      'transaction_hash',
      'transaction.hash',
      'transaction.txHash',
      'transaction.tx_hash',
      'data.txHash',
      'data.tx_hash',
      'data.hash',
      'data.transactionId',
      'data.transactionHash',
      'data.transaction.hash',
      'data.transaction.txHash',
      'data.transaction.tx_hash',
      'payment.txHash',
      'payment.transactionHash'
    ]) || `kirapay:${invoice.id}:${fallbackIdentifier}`

  const chain =
    firstStringValue(payload, [
      'chain',
      'chainName',
      'network',
      'transaction.chain',
      'transaction.chainName',
      'transaction.network',
      'data.chain',
      'data.chainName',
      'data.network',
      'data.transaction.chain',
      'data.transaction.chainName',
      'payment.chain'
    ]) || getDefaultChainName()

  const amount =
    firstNumericValue(payload, [
      'amount',
      'paidAmount',
      'price',
      'settlementAmount',
      'transaction.amount',
      'transaction.paidAmount',
      'transaction.price',
      'transaction.settlementAmount',
      'data.amount',
      'data.paidAmount',
      'data.price',
      'data.settlementAmount',
      'data.transaction.amount',
      'data.transaction.paidAmount',
      'payment.amount',
      'payment.price'
    ]) ?? parseNumeric(invoice.amount)

  const token =
    firstStringValue(payload, [
      'tokenOut.symbol',
      'token',
      'tokenSymbol',
      'currency',
      'asset',
      'transaction.token',
      'transaction.tokenSymbol',
      'transaction.currency',
      'transaction.asset',
      'data.token',
      'data.tokenSymbol',
      'data.currency',
      'data.asset',
      'data.transaction.token',
      'data.transaction.tokenSymbol',
      'payment.token'
    ]) || 'USDC'

  const fromAddress =
    firstStringValue(payload, [
      'fromAddress',
      'from_address',
      'from',
      'sender',
      'payer',
      'walletAddress',
      'transaction.fromAddress',
      'transaction.from_address',
      'transaction.from',
      'transaction.sender',
      'transaction.payer',
      'transaction.walletAddress',
      'data.fromAddress',
      'data.from_address',
      'data.sender',
      'data.transaction.fromAddress',
      'data.transaction.from_address',
      'data.transaction.from',
      'payment.fromAddress'
    ]) || 'unknown'

  const toAddress =
    firstStringValue(payload, [
      'toAddress',
      'to_address',
      'to',
      'receiver',
      'recipient',
      'merchantAddress',
      'transaction.toAddress',
      'transaction.to_address',
      'transaction.to',
      'transaction.receiver',
      'transaction.recipient',
      'transaction.merchantAddress',
      'data.toAddress',
      'data.to_address',
      'data.receiver',
      'data.transaction.toAddress',
      'data.transaction.to_address',
      'data.transaction.to',
      'payment.toAddress'
    ]) ||
    config.kirapayReceiverAddress ||
    'unknown'

  return {
    amount: parseNumeric(amount).toFixed(8),
    chain,
    fromAddress,
    toAddress,
    token,
    txHash
  }
}

export function buildKiraPayCallbackPayload(c: Context, rawBody?: string) {
  const queryPayload = c.req.query()
  const parsedBody = rawBody ? parseWebhookPayload(rawBody) : null
  const payload =
    parsedBody && typeof parsedBody === 'object'
      ? {
          ...queryPayload,
          ...parsedBody
        }
      : { ...queryPayload }

  if (!payload.customOrderId && payload.sessionId) {
    payload.customOrderId = payload.sessionId
  }

  return payload
}

export function buildKiraPayCallbackRedirectUrl(
  payload: Record<string, string>,
  result: {
    invoiceId?: string
    matched: boolean
    paymentId: string | null
    status: string | null
  }
) {
  const redirectUrl = payload.redirectUrl
  if (!redirectUrl) {
    return null
  }

  try {
    const targetUrl = new URL(redirectUrl)
    const sessionId = result.invoiceId || payload.sessionId || payload.customOrderId

    if (sessionId) {
      targetUrl.searchParams.set('sessionId', sessionId)
    }

    if (result.status) {
      targetUrl.searchParams.set('paymentStatus', result.status)
    }

    targetUrl.searchParams.set('paymentMatched', String(result.matched))

    if (result.paymentId) {
      targetUrl.searchParams.set('paymentId', result.paymentId)
    }

    const txHash = firstStringValue(payload, [
      'txHash',
      'tx_hash',
      'transactionId',
      'inputTransactionHash',
      'outTxHash',
      'transactionHash',
      'transaction_hash',
      'hash'
    ])

    if (txHash) {
      targetUrl.searchParams.set('txHash', txHash)
    }

    return targetUrl.toString()
  } catch {
    return null
  }
}
