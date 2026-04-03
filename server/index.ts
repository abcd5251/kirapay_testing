import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { randomUUID } from 'node:crypto'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 8787)
const apiBaseUrl = 'https://api.kira-pay.com/api'
const merchantApiKey = process.env.KIRAPAY_API_KEY ?? ''
const webhookSecret = process.env.KIRAPAY_WEBHOOK_SECRET ?? ''
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:5173'
const tokenOutChainId = process.env.KIRAPAY_TOKEN_OUT_CHAIN_ID ?? '8453'
const tokenOutAddress = process.env.KIRAPAY_TOKEN_OUT_ADDRESS ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const receiverAddress = process.env.KIRAPAY_RECEIVER_ADDRESS ?? '0x8356D265646a397b2Dacf0e05A4973E7676597f4'

type PaymentStatus = 'pending' | 'success' | 'failed'

type Plan = {
  id: string
  name: string
  priceLabel: string
  amount: number
  creditsLabel: string
  accent: string
  description: string
  features: string[]
  fixedCheckoutUrl?: string
}

type Session = {
  id: string
  plan: Plan
  checkoutUrl: string
  qrCodeValue: string
  redirectUrl: string
  status: PaymentStatus
  providerReady: boolean
  clientReference: string
  customOrderId: string
  twitterId: string
  providerPrice: number | null
  lastWebhookEvent: string | null
  lastWebhookStatus: string | null
  lastWebhookAt: string | null
  createdAt: string
  updatedAt: string
}

const plans: Plan[] = [
  {
    id: 'builder',
    name: 'Builder Pack',
    priceLabel: '1 USDC',
    amount: 1,
    creditsLabel: '800 Credits',
    accent: 'Starter',
    description: 'Best for trying the API with a practical starter balance.',
    features: ['Top up once', 'Manual activation support', 'Good for testing and small workloads'],
  },
  {
    id: 'growth',
    name: 'Growth Pack',
    priceLabel: '30 USDC',
    amount: 30,
    creditsLabel: '3,000 Credits',
    accent: 'Popular',
    description: 'Higher volume credits for active builders and internal tools.',
    features: ['Better effective rate', 'Ideal for production usage', 'Priority manual confirmation'],
    fixedCheckoutUrl: 'https://checkout.kira-pay.com/9l3kk2slre',
  },
  {
    id: 'scale',
    name: 'Scale Pack',
    priceLabel: '100 USDC',
    amount: 100,
    creditsLabel: '12,000 Credits',
    accent: 'Team',
    description: 'For larger monthly usage and multi-seat internal operations.',
    features: ['Best value bundle', 'Faster reconciliation', 'Dedicated merchant follow-up'],
  },
]

const sessions = new Map<string, Session>()

app.use(cors())
app.use(express.json())

const createHeaders = () => ({
  'Content-Type': 'application/json',
  'x-api-key': merchantApiKey,
})

const logKiraPay = (label: string, payload: unknown) => {
  console.log(`[KiraPay] ${label}`, payload)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNestedValue = (value: unknown, path: string[]): unknown => {
  let current: unknown = value

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined
    }

    current = current[key]
  }

  return current
}

const pickFirstString = (value: unknown, paths: string[][]) => {
  for (const path of paths) {
    const candidate = readNestedValue(value, path)

    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

const normalizeTwitterId = (value: string) => {
  const trimmed = value.trim()
  const withoutAt = trimmed.replace(/^@+/, '')

  return withoutAt ? `@${withoutAt}` : ''
}

const createRedirectUrl = (sessionId: string) => {
  const url = new URL(appBaseUrl)

  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('source', 'kirapay')

  return url.toString()
}

const pickFirstBoolean = (value: unknown, paths: string[][]) => {
  for (const path of paths) {
    const candidate = readNestedValue(value, path)

    if (typeof candidate === 'boolean') {
      return candidate
    }
  }

  return null
}

const normalizeWebhookStatus = (payload: unknown) => {
  const rawStatus =
    pickFirstString(payload, [
      ['status'],
      ['paymentStatus'],
      ['payment_status'],
      ['transactionStatus'],
      ['transaction_status'],
      ['state'],
      ['event'],
      ['eventName'],
      ['eventType'],
      ['type'],
      ['data', 'status'],
      ['data', 'paymentStatus'],
      ['data', 'payment_status'],
      ['data', 'transactionStatus'],
      ['data', 'transaction_status'],
      ['data', 'state'],
      ['data', 'event'],
      ['data', 'eventType'],
      ['payload', 'status'],
      ['payload', 'paymentStatus'],
      ['payload', 'payment_status'],
      ['payload', 'transactionStatus'],
      ['payload', 'transaction_status'],
      ['payload', 'state'],
      ['transaction', 'status'],
      ['payment', 'status'],
    ]) ?? ''

  const successFlag = pickFirstBoolean(payload, [
    ['success'],
    ['paid'],
    ['data', 'success'],
    ['data', 'paid'],
    ['payload', 'success'],
    ['payload', 'paid'],
  ])

  const normalized = rawStatus.toLowerCase()

  if (
    successFlag === true ||
    normalized.includes('success') ||
    normalized.includes('succeeded') ||
    normalized.includes('paid') ||
    normalized.includes('complete') ||
    normalized.includes('confirm') ||
    normalized.includes('settled')
  ) {
    return {
      status: 'success' as const,
      rawStatus: rawStatus || 'success',
    }
  }

  if (
    successFlag === false ||
    normalized.includes('fail') ||
    normalized.includes('cancel') ||
    normalized.includes('expire') ||
    normalized.includes('reject') ||
    normalized.includes('void') ||
    normalized.includes('error')
  ) {
    return {
      status: 'failed' as const,
      rawStatus: rawStatus || 'failed',
    }
  }

  if (
    normalized.includes('pending') ||
    normalized.includes('process') ||
    normalized.includes('await') ||
    normalized.includes('created') ||
    normalized.includes('init')
  ) {
    return {
      status: 'pending' as const,
      rawStatus: rawStatus || 'pending',
    }
  }

  return {
    status: null,
    rawStatus: rawStatus || null,
  }
}

const getWebhookEventName = (payload: unknown) =>
  pickFirstString(payload, [
    ['event'],
    ['eventName'],
    ['eventType'],
    ['type'],
    ['data', 'event'],
    ['data', 'eventType'],
    ['payload', 'event'],
    ['payload', 'eventType'],
  ]) ?? 'unknown'

const findSessionFromWebhook = (payload: unknown) => {
  const explicitReference = pickFirstString(payload, [
    ['sessionId'],
    ['reference'],
    ['clientReference'],
    ['customOrderId'],
    ['merchantReference'],
    ['orderId'],
    ['data', 'sessionId'],
    ['data', 'reference'],
    ['data', 'clientReference'],
    ['data', 'customOrderId'],
    ['data', 'merchantReference'],
    ['data', 'orderId'],
    ['payload', 'sessionId'],
    ['payload', 'reference'],
    ['payload', 'clientReference'],
    ['payload', 'customOrderId'],
    ['payload', 'merchantReference'],
    ['payload', 'orderId'],
    ['metadata', 'sessionId'],
    ['metadata', 'reference'],
    ['metadata', 'clientReference'],
    ['metadata', 'customOrderId'],
    ['data', 'metadata', 'sessionId'],
    ['data', 'metadata', 'reference'],
    ['data', 'metadata', 'clientReference'],
    ['data', 'metadata', 'customOrderId'],
    ['payload', 'metadata', 'sessionId'],
    ['payload', 'metadata', 'reference'],
    ['payload', 'metadata', 'clientReference'],
    ['payload', 'metadata', 'customOrderId'],
  ])

  if (explicitReference) {
    for (const session of sessions.values()) {
      if (
        session.id === explicitReference ||
        session.clientReference === explicitReference ||
        session.customOrderId === explicitReference
      ) {
        return {
          session,
          matchedBy: 'reference' as const,
        }
      }
    }
  }

  const latestPendingSession = [...sessions.values()]
    .filter((session) => session.status === 'pending')
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]

  if (latestPendingSession) {
    return {
      session: latestPendingSession,
      matchedBy: 'latest_pending' as const,
    }
  }

  return {
    session: null,
    matchedBy: null,
  }
}

const validateWebhookSecret = (request: express.Request) => {
  if (!webhookSecret) {
    return true
  }

  const bearerToken = request.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  const headerCandidates = [
    request.header('x-kirapay-webhook-secret'),
    request.header('x-webhook-secret'),
    request.header('x-api-key'),
    bearerToken,
  ]

  return headerCandidates.some((candidate) => candidate === webhookSecret)
}

const checkKiraPayReachable = async () => {
  if (!merchantApiKey) {
    return false
  }

  try {
    const response = await fetch(apiBaseUrl, {
      headers: createHeaders(),
      method: 'GET',
    })

    return response.ok
  } catch {
    return false
  }
}

app.get('/api/health', async (_request, response) => {
  const providerReady = await checkKiraPayReachable()

  response.json({
    message: 'success',
    code: 200,
    data: {
      provider: 'KiraPay',
      apiBaseUrl,
      providerReady,
      merchantApiConfigured: Boolean(merchantApiKey),
      appBaseUrl,
      tokenOutChainId,
      tokenOutAddress,
      receiverAddress,
      webhookEndpoint: `http://localhost:${port}/api/webhooks/kirapay`,
    },
  })
})

app.get('/api/plans', (_request, response) => {
  response.json({
    message: 'success',
    code: 200,
    data: plans,
  })
})

app.post('/api/payments/session', async (request, response) => {
  const { planId, twitterId } = request.body as { planId?: string; twitterId?: string }
  const plan = plans.find((item) => item.id === planId)
  const normalizedTwitterId = normalizeTwitterId(twitterId ?? '')

  if (!plan) {
    response.status(400).json({
      message: 'Invalid plan',
      code: 400,
    })
    return
  }

  if (!normalizedTwitterId) {
    response.status(400).json({
      message: 'Twitter ID is required',
      code: 400,
    })
    return
  }

  const providerReady = await checkKiraPayReachable()
  const sessionId = randomUUID()
  const clientReference = `kp-session-${sessionId}`
  const customOrderId = `${plan.id}-${sessionId}`
  const redirectUrl = createRedirectUrl(sessionId)
  const now = new Date().toISOString()

  if (plan.fixedCheckoutUrl) {
    const session: Session = {
      id: sessionId,
      plan,
      checkoutUrl: plan.fixedCheckoutUrl,
      qrCodeValue: plan.fixedCheckoutUrl,
      redirectUrl,
      status: 'pending',
      providerReady: true,
      clientReference,
      customOrderId,
      twitterId: normalizedTwitterId,
      providerPrice: null,
      lastWebhookEvent: null,
      lastWebhookStatus: null,
      lastWebhookAt: null,
      createdAt: now,
      updatedAt: now,
    }

    sessions.set(sessionId, session)
    logKiraPay('Using fixed checkout URL session', session)

    response.json({
      message: 'success',
      code: 200,
      data: session,
    })
    return
  }

  if (!merchantApiKey) {
    response.status(500).json({
      message: 'KiraPay API key is not configured',
      code: 500,
    })
    return
  }

  const providerResponse = await fetch(`${apiBaseUrl}/link/generate`, {
    method: 'POST',
    headers: createHeaders(),
    body: JSON.stringify({
      tokenOut: {
        chainId: tokenOutChainId,
        address: tokenOutAddress,
      },
      receiver: receiverAddress,
      originalPrice: plan.amount,
      name: normalizedTwitterId,
      customOrderId,
      redirectUrl,
      type: 'single_use',
      isViewAsCrypto: true,
    }),
  })

  const providerJson = (await providerResponse.json().catch(() => null)) as
    | {
        message?: string
        code?: number
        data?: {
          url?: string
          price?: number
          originalPrice?: number
        }
      }
    | {
        message?: string
        statusCode?: number
      }
    | null

  logKiraPay('Create payment link response', {
    ok: providerResponse.ok,
    status: providerResponse.status,
    planId: plan.id,
    twitterId: normalizedTwitterId,
    customOrderId,
    redirectUrl,
    providerJson,
  })

  if (!providerResponse.ok || !providerJson || !('data' in providerJson) || !providerJson.data?.url) {
    response.status(providerResponse.status || 502).json({
      message:
        ('message' in (providerJson ?? {}) && typeof providerJson?.message === 'string' && providerJson.message) ||
        'Failed to create KiraPay payment link',
      code: providerResponse.status || 502,
      data: providerJson,
    })
    return
  }

  const session: Session = {
    id: sessionId,
    plan,
    checkoutUrl: providerJson.data.url,
    qrCodeValue: providerJson.data.url,
    redirectUrl,
    status: 'pending',
    providerReady,
    clientReference,
    customOrderId,
    twitterId: normalizedTwitterId,
    providerPrice: typeof providerJson.data.price === 'number' ? providerJson.data.price : null,
    lastWebhookEvent: null,
    lastWebhookStatus: null,
    lastWebhookAt: null,
    createdAt: now,
    updatedAt: now,
  }

  sessions.set(sessionId, session)
  logKiraPay('Created dynamic checkout session', session)

  response.json({
    message: 'success',
    code: 200,
    data: session,
  })
})

app.get('/api/payments/session/:sessionId', (request, response) => {
  const session = sessions.get(request.params.sessionId)

  if (!session) {
    response.status(404).json({
      message: 'Session not found',
      code: 404,
    })
    return
  }

  response.json({
    message: 'success',
    code: 200,
    data: session,
  })
})

app.post('/api/payments/session/:sessionId/status', (request, response) => {
  const session = sessions.get(request.params.sessionId)
  const { status } = request.body as { status?: PaymentStatus }

  if (!session) {
    response.status(404).json({
      message: 'Session not found',
      code: 404,
    })
    return
  }

  if (status !== 'success' && status !== 'failed' && status !== 'pending') {
    response.status(400).json({
      message: 'Invalid status',
      code: 400,
    })
    return
  }

  const updatedSession: Session = {
    ...session,
    status,
    updatedAt: new Date().toISOString(),
  }

  sessions.set(session.id, updatedSession)

  response.json({
    message: 'success',
    code: 200,
    data: updatedSession,
  })
})

app.post('/api/webhooks/kirapay', (request, response) => {
  if (!validateWebhookSecret(request)) {
    response.status(401).json({
      message: 'Invalid webhook secret',
      code: 401,
    })
    return
  }

  const payload = request.body as unknown
  logKiraPay('Webhook payload received', payload)
  const { status, rawStatus } = normalizeWebhookStatus(payload)
  const eventName = getWebhookEventName(payload)
  const { session, matchedBy } = findSessionFromWebhook(payload)

  if (!session) {
    response.status(202).json({
      message: 'Webhook received but no session matched',
      code: 202,
      data: {
        acknowledged: true,
        matched: false,
        eventName,
        rawStatus,
      },
    })
    return
  }

  const updatedSession: Session = {
    ...session,
    status: status ?? session.status,
    lastWebhookEvent: eventName,
    lastWebhookStatus: rawStatus,
    lastWebhookAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  sessions.set(updatedSession.id, updatedSession)
  logKiraPay('Webhook updated session', {
    sessionId: updatedSession.id,
    status: updatedSession.status,
    eventName,
    rawStatus,
    matchedBy,
    session: updatedSession,
  })

  response.json({
    message: 'success',
    code: 200,
    data: {
      acknowledged: true,
      matched: true,
      matchedBy,
      sessionId: updatedSession.id,
      status: updatedSession.status,
      clientReference: updatedSession.clientReference,
    },
  })
})

app.listen(port, () => {
  console.log(`KiraPay backend ready on http://localhost:${port}`)
})
