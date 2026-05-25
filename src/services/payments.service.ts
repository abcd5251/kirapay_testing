import crypto from 'crypto'
import { sql } from 'drizzle-orm'
import type { Context } from 'hono'
import httpStatus from 'http-status'
import { config } from '@/config'
import db from '@/db'
import {
  buildKiraPayCallbackPayload,
  buildKiraPayCallbackRedirectUrl,
  enrichKiraPayPaymentPayload,
  ensureKiraPayWebhookConfigured,
  extractKiraPayLinkIdFromUrl,
  fetchKiraPayApi,
  getDefaultChainName,
  getKiraPayApiBaseUrl,
  getKiraPayCallbackUrl,
  getKiraPayTransactionReferencesFromItem,
  getNormalizedSuccessTimestamp,
  getRedirectUrl,
  getRequiredKiraPayApiKey,
  getWebhookEventName,
  getWebhookPaidAt,
  getWebhookPaymentDetails,
  normalizeWebhookStatus,
  parseWebhookPayload
} from '@/services/payments/kirapay.helpers'
import {
  buildPaymentSession,
  getPaymentPlan,
  serializePaymentRecord
} from '@/services/payments/payments.session'
import type {
  ApiCreditAccountRow,
  DbExecutor,
  InvoiceRow,
  KiraPayCreateLinkResponse,
  KiraPayLinkItem,
  KiraPayLinksResponse,
  ManagedPaymentAccessInput,
  KiraPayTransactionItem,
  KiraPayTransactionsResponse,
  ManagedPaymentAccountRow,
  PaymentRecordRow,
  PaymentUpsertRow
} from '@/services/payments/payments.types'
import {
  firstNumericValue,
  firstStringValue,
  formatNumeric,
  getArrayValues,
  parseNumeric
} from '@/services/payments/payments.utils'
import { ensureXApiCreditAccount } from '@/services/xAuth.service'
import { ApiError } from '@/utils/ApiError'
import { logger } from '@/utils/logger'
import type { CreatePaymentSessionBody } from '@/validations/payments.validation'

const log = logger()
const REFERRAL_SCOPE_API_SERVICE = 'api_service'

function hashApiKey(plainApiKey: string) {
  return crypto.createHash('sha256').update(plainApiKey).digest('hex')
}

async function findAccountByApiKey(apiKey: string) {
  const apiKeyHash = hashApiKey(apiKey)
  const result = await db('primary').execute(sql`
    SELECT
      a.id AS account_id,
      a.member_tg_id,
      a.twitter_id,
      a.status AS account_status,
      a.available_credits,
      a.invited_by_tg_id
    FROM api_keys k
    JOIN api_credit_accounts a ON a.id = k.api_credit_account_id
    WHERE k.key_hash = ${apiKeyHash}
      AND k.status = 'active'
    LIMIT 1
  `)

  return (result[0] as ManagedPaymentAccountRow | undefined) || null
}

async function resolveManagedPaymentAccount({
  apiKey,
  sessionTwitterId
}: ManagedPaymentAccessInput) {
  if (!apiKey && !sessionTwitterId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'API key or signed-in X session is required')
  }

  const account = apiKey ? await findAccountByApiKey(apiKey) : null

  if (account) {
    if (account.account_status !== 'active') {
      throw new ApiError(httpStatus.FORBIDDEN, 'API account is not active')
    }

    return account
  }

  if (!sessionTwitterId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid API key')
  }

  const ensured = await ensureXApiCreditAccount(sessionTwitterId)

  return {
    account_id: ensured.account.id,
    account_status: ensured.account.status,
    available_credits: ensured.account.available_credits,
    invited_by_tg_id: ensured.account.invited_by_tg_id,
    member_tg_id: ensured.account.member_tg_id,
    twitter_id: ensured.account.twitter_id
  } satisfies ManagedPaymentAccountRow
}

async function findInvoiceById(executor: DbExecutor, invoiceId: string) {
  const result = await executor.execute(sql`
    SELECT
      id,
      user_id,
      plan_id,
      amount,
      paid,
      paid_at,
      created_at,
      expires_at,
      duration_days,
      plan_limit,
      identifier_in_usd
    FROM invoices
    WHERE id = ${invoiceId}
    LIMIT 1
  `)

  return (result[0] as InvoiceRow | undefined) || null
}

async function findInvoiceByIdentifier(executor: DbExecutor, identifierInUsd: string) {
  const result = await executor.execute(sql`
    SELECT
      id,
      user_id,
      plan_id,
      amount,
      paid,
      paid_at,
      created_at,
      expires_at,
      duration_days,
      plan_limit,
      identifier_in_usd
    FROM invoices
    WHERE identifier_in_usd = ${identifierInUsd}
    ORDER BY created_at DESC
    LIMIT 1
  `)

  return (result[0] as InvoiceRow | undefined) || null
}

async function findLatestPaymentByInvoiceId(executor: DbExecutor, invoiceId: string) {
  const result = await executor.execute(sql`
    SELECT
      id,
      tx_hash,
      chain,
      amount,
      token,
      from_address,
      to_address,
      created_at
    FROM payments
    WHERE matched_invoice_id = ${invoiceId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `)

  return (result[0] as PaymentRecordRow | undefined) || null
}

async function findKiraPayLinkForInvoice(invoice: InvoiceRow) {
  let page = 1
  let totalPages = 1

  while (page <= totalPages && page <= 10) {
    const payload = await fetchKiraPayApi<KiraPayLinksResponse>('/link', {
      limit: 100,
      page
    })
    const links = [
      ...(payload.data?.links || []),
      ...getArrayValues<KiraPayLinkItem>(payload, ['data.items', 'items', 'links', 'data'])
    ]
    const matchedLink =
      links.find((link) => link.customOrderId === invoice.id) ||
      links.find((link) => link.code === invoice.identifier_in_usd) ||
      links.find(
        (link) => extractKiraPayLinkIdFromUrl(link.url || '') === invoice.identifier_in_usd
      )

    if (matchedLink) {
      return matchedLink
    }

    totalPages = Math.max(1, payload.data?.totalPages ?? 1)
    page += 1
  }

  return null
}

async function findKiraPayTransactionByReferences(references: Set<string>) {
  if (references.size === 0) {
    return null
  }

  let page = 1
  let totalPages = 1

  while (page <= totalPages && page <= 20) {
    const payload = await fetchKiraPayApi<KiraPayTransactionsResponse>('/wallet/transactions', {
      limit: 100,
      page
    })
    const transactions = [
      ...(payload.data?.transactions || []),
      ...getArrayValues<KiraPayTransactionItem>(payload, [
        'data.items',
        'data.results',
        'transactions',
        'items',
        'results',
        'data'
      ])
    ]

    for (const transaction of transactions) {
      const transactionReferences = getKiraPayTransactionReferencesFromItem(transaction)
      for (const reference of references) {
        if (transactionReferences.has(reference)) {
          return transaction
        }
      }
    }

    totalPages = Math.max(1, payload.data?.totalPages ?? 1)
    page += 1
  }

  return null
}

async function findKiraPayPaidTransactionForLink(paymentLinkId: string) {
  let page = 1
  let totalPages = 1
  let matchedTransaction: KiraPayTransactionItem | null = null

  while (page <= totalPages && page <= 10) {
    const payload = await fetchKiraPayApi<KiraPayTransactionsResponse>('/wallet/transactions', {
      limit: 100,
      page
    })
    const transactions = [
      ...(payload.data?.transactions || []),
      ...getArrayValues<KiraPayTransactionItem>(payload, [
        'data.items',
        'data.results',
        'transactions',
        'items',
        'results',
        'data'
      ])
    ]

    for (const transaction of transactions) {
      const transactionLinkId =
        firstStringValue(transaction, [
          'paymentLinkId',
          'linkId',
          '_id',
          'paymentLink.id',
          'paymentLink._id',
          'data.paymentLinkId'
        ]) || null

      if (transactionLinkId !== paymentLinkId) {
        continue
      }

      if (normalizeWebhookStatus(transaction).status !== 'success') {
        continue
      }

      if (
        !matchedTransaction ||
        getNormalizedSuccessTimestamp(transaction) >
          getNormalizedSuccessTimestamp(matchedTransaction)
      ) {
        matchedTransaction = transaction
      }
    }

    totalPages = Math.max(1, payload.data?.totalPages ?? 1)
    page += 1
  }

  return matchedTransaction
}

function transactionMatchesInvoice(
  transaction: KiraPayTransactionItem,
  invoice: InvoiceRow,
  knownLinkIdentifiers: Set<string>
) {
  const transactionInvoiceId = firstStringValue(transaction, [
    'customOrderId',
    'payment.customOrderId',
    'paymentLink.customOrderId',
    'metadata.customOrderId'
  ])
  if (transactionInvoiceId && transactionInvoiceId === invoice.id) {
    return true
  }

  const transactionIdentifiers = new Set<string>()
  const stringValues = [
    firstStringValue(transaction, ['paymentLinkId', 'linkId', 'paymentLink.id', 'paymentLink._id']),
    firstStringValue(transaction, ['linkCode', 'code', 'paymentLink.code']),
    firstStringValue(transaction, ['paymentLink.url', 'url'])
  ]

  for (const value of stringValues) {
    if (!value) {
      continue
    }
    transactionIdentifiers.add(value)
    const extracted = extractKiraPayLinkIdFromUrl(value)
    if (extracted) {
      transactionIdentifiers.add(extracted)
    }
  }

  for (const identifier of transactionIdentifiers) {
    if (knownLinkIdentifiers.has(identifier)) {
      return true
    }
  }

  const receiverAddress = firstStringValue(transaction, [
    'toAddress',
    'to',
    'receiver',
    'recipient',
    'merchantAddress',
    'payment.toAddress'
  ])
  const amount = firstNumericValue(transaction, [
    'amount',
    'paidAmount',
    'price',
    'settlementAmount',
    'payment.amount'
  ])
  const invoiceAmount = parseNumeric(invoice.amount)
  const amountsClose =
    typeof amount === 'number' &&
    Math.abs(amount - invoiceAmount) <= Math.max(0.01, invoiceAmount * 0.05)
  const receiversMatch =
    !!receiverAddress &&
    !!config.kirapayReceiverAddress &&
    receiverAddress.toLowerCase() === config.kirapayReceiverAddress.toLowerCase()

  return receiversMatch && amountsClose
}

async function findKiraPayPaidTransactionForInvoice(
  invoice: InvoiceRow,
  link: KiraPayLinkItem | null
) {
  const knownLinkIdentifiers = new Set<string>([invoice.id, invoice.identifier_in_usd])

  if (link) {
    knownLinkIdentifiers.add(link._id)
    if (link.code) {
      knownLinkIdentifiers.add(link.code)
    }
    if (link.url) {
      knownLinkIdentifiers.add(link.url)
      const extracted = extractKiraPayLinkIdFromUrl(link.url)
      if (extracted) {
        knownLinkIdentifiers.add(extracted)
      }
    }
  }

  let page = 1
  let totalPages = 1
  let matchedTransaction: KiraPayTransactionItem | null = null

  while (page <= totalPages && page <= 10) {
    const payload = await fetchKiraPayApi<KiraPayTransactionsResponse>('/wallet/transactions', {
      limit: 100,
      page
    })
    const transactions = [
      ...(payload.data?.transactions || []),
      ...getArrayValues<KiraPayTransactionItem>(payload, [
        'data.items',
        'data.results',
        'transactions',
        'items',
        'results',
        'data'
      ])
    ]

    for (const transaction of transactions) {
      if (normalizeWebhookStatus(transaction).status !== 'success') {
        continue
      }

      if (!transactionMatchesInvoice(transaction, invoice, knownLinkIdentifiers)) {
        continue
      }

      if (
        !matchedTransaction ||
        getNormalizedSuccessTimestamp(transaction) >
          getNormalizedSuccessTimestamp(matchedTransaction)
      ) {
        matchedTransaction = transaction
      }
    }

    totalPages = Math.max(1, payload.data?.totalPages ?? 1)
    page += 1
  }

  return matchedTransaction
}

async function persistSuccessfulPayment(
  executor: DbExecutor,
  invoice: InvoiceRow,
  payload: unknown,
  matchedBy: string | null,
  eventName: string | null
) {
  const enrichedPayload = await enrichKiraPayPaymentPayload(
    payload,
    findKiraPayTransactionByReferences
  )
  const paymentDetails = getWebhookPaymentDetails(enrichedPayload, invoice)
  const paidAt = getWebhookPaidAt(enrichedPayload)
  const paidAtIso = paidAt.toISOString()
  const { status } = normalizeWebhookStatus(enrichedPayload)
  const paymentRows = await executor.execute(sql`
    INSERT INTO payments (
      tx_hash,
      chain,
      amount,
      token,
      from_address,
      to_address,
      matched,
      matched_invoice_id,
      created_at
    )
    VALUES (
      ${paymentDetails.txHash},
      ${paymentDetails.chain},
      ${paymentDetails.amount},
      ${paymentDetails.token},
      ${paymentDetails.fromAddress},
      ${paymentDetails.toAddress},
      true,
      ${invoice.id},
      ${paidAtIso}
    )
    ON CONFLICT (tx_hash) DO UPDATE
    SET
      chain = EXCLUDED.chain,
      amount = EXCLUDED.amount,
      token = EXCLUDED.token,
      from_address = EXCLUDED.from_address,
      to_address = EXCLUDED.to_address,
      matched = EXCLUDED.matched,
      matched_invoice_id = EXCLUDED.matched_invoice_id
    RETURNING id
  `)
  const payment = paymentRows[0] as PaymentUpsertRow | undefined

  if (!payment?.id) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to persist payment record')
  }

  log.info({
    amount: paymentDetails.amount,
    chain: paymentDetails.chain,
    invoiceId: invoice.id,
    matchedBy,
    message: 'Payment persisted for KiraPay invoice',
    paymentId: payment.id,
    resolvedFromAddress: paymentDetails.fromAddress,
    resolvedToAddress: paymentDetails.toAddress,
    txHash: paymentDetails.txHash
  })

  const updatedInvoiceRows = await executor.execute(sql`
    UPDATE invoices
    SET paid = true, paid_at = COALESCE(paid_at, ${paidAtIso})
    WHERE id = ${invoice.id}
      AND paid = false
    RETURNING id
  `)

  const newlyPaid = updatedInvoiceRows.length > 0

  log.info({
    invoiceId: invoice.id,
    message: 'Invoice payment status updated',
    newlyPaid,
    paidAt: paidAtIso,
    paymentId: payment.id
  })

  if (newlyPaid) {
    const plan = getPaymentPlan(invoice.plan_id)
    const accountRows = await executor.execute(sql`
      UPDATE api_credit_accounts
      SET available_credits = available_credits + ${plan.credits}, updated_at = NOW()
      WHERE member_tg_id = ${invoice.user_id}
      RETURNING id, member_tg_id, invited_by_tg_id, available_credits
    `)
    const account = (accountRows[0] as ApiCreditAccountRow | undefined) || null

    if (!account) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update API credits')
    }

    await executor.execute(sql`
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
        'topup',
        ${plan.credits},
        ${account.available_credits},
        NOW(),
        NOW()
      )
    `)

    if (account.invited_by_tg_id && account.member_tg_id) {
      await executor.execute(sql`
        INSERT INTO referral_payment (
          referrer_id,
          referree_id,
          payment_id,
          claimable_amount_in_usd,
          claim_status,
          claimed_chain,
          referral_scope,
          created_at,
          updated_at
        )
        SELECT
          ${account.invited_by_tg_id},
          ${account.member_tg_id},
          ${payment.id},
          ${paymentDetails.amount},
          'unclaimable',
          ${getDefaultChainName()},
          ${REFERRAL_SCOPE_API_SERVICE},
          NOW(),
          NOW()
        WHERE EXISTS (
          SELECT 1
          FROM referrals
          WHERE referrer_id = ${account.invited_by_tg_id}
            AND referree_id = ${account.member_tg_id}
            AND referral_scope = ${REFERRAL_SCOPE_API_SERVICE}
        )
        ON CONFLICT (referrer_id, referree_id, payment_id) DO NOTHING
      `)

      log.info({
        invoiceId: invoice.id,
        message: 'Referral payment processed for paid invoice',
        paymentId: payment.id,
        referreeId: account.member_tg_id,
        referrerId: account.invited_by_tg_id
      })
    }
  }

  return {
    acknowledged: true,
    invoiceId: invoice.id,
    matched: true,
    matchedBy,
    newlyPaid,
    paymentId: payment.id,
    status: status || 'success',
    webhookEvent: eventName
  }
}

async function syncInvoicePaymentWithKiraPay(invoice: InvoiceRow) {
  const link = await findKiraPayLinkForInvoice(invoice)
  const paidTransaction = link
    ? (await findKiraPayPaidTransactionForLink(link._id)) ||
      (await findKiraPayPaidTransactionForInvoice(invoice, link))
    : await findKiraPayPaidTransactionForInvoice(invoice, null)

  if (!paidTransaction) {
    log.info({
      identifierInUsd: invoice.identifier_in_usd,
      invoiceId: invoice.id,
      linkId: link?._id || null,
      message: 'No successful KiraPay transaction matched invoice yet'
    })
    return null
  }

  log.info({
    invoiceId: invoice.id,
    linkId: link?._id || null,
    message: 'Successful KiraPay transaction matched invoice',
    transactionId:
      firstStringValue(paidTransaction, ['_id', 'transactionId', 'txHash', 'transactionHash']) ||
      null
  })

  return db('primary').transaction(async (tx) => {
    const latestInvoice = await findInvoiceById(tx, invoice.id)
    if (!latestInvoice) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Session not found')
    }

    return persistSuccessfulPayment(tx, latestInvoice, paidTransaction, 'kirapayApiPolling', null)
  })
}

async function findMatchedInvoiceFromWebhook(executor: DbExecutor, payload: unknown) {
  const customOrderId = firstStringValue(payload, [
    'customOrderId',
    'custom_order_id',
    'sessionId',
    'session_id',
    'invoiceId',
    'invoice_id',
    'orderId',
    'order_id',
    'data.customOrderId',
    'data.custom_order_id',
    'data.sessionId',
    'data.invoiceId',
    'data.metadata.customOrderId',
    'data.payment.customOrderId',
    'data.paymentLink.customOrderId',
    'metadata.customOrderId',
    'payment.customOrderId',
    'payload.customOrderId'
  ])

  if (customOrderId) {
    const invoice = await findInvoiceById(executor, customOrderId)
    if (invoice) {
      return {
        invoice,
        matchedBy: 'customOrderId'
      }
    }
  }

  const identifiers = new Set<string>()
  const linkId = firstStringValue(payload, [
    'id',
    'code',
    'linkCode',
    'link_code',
    'linkId',
    'link_id',
    'paymentLinkId',
    'data.id',
    'data.code',
    'data.linkCode',
    'data.linkId',
    'data.link_id',
    'data.paymentLinkId',
    'data.paymentLink.id',
    'data.paymentLink._id',
    'data.paymentLink.code',
    'payment.id',
    'payment.linkId',
    'payload.id'
  ])
  const directUrl = firstStringValue(payload, [
    'url',
    'data.url',
    'data.paymentLink.url',
    'payment.url',
    'payload.url',
    'checkoutUrl'
  ])

  if (linkId) {
    identifiers.add(linkId)
  }

  if (directUrl) {
    const extractedId = extractKiraPayLinkIdFromUrl(directUrl)
    if (extractedId) {
      identifiers.add(extractedId)
    }
  }

  for (const identifier of identifiers) {
    const invoice = await findInvoiceByIdentifier(executor, identifier)
    if (invoice) {
      return {
        invoice,
        matchedBy: 'identifierInUsd'
      }
    }
  }

  return {
    invoice: null,
    matchedBy: null
  }
}

export async function createPaymentSession(
  c: Context,
  access: ManagedPaymentAccessInput,
  body: CreatePaymentSessionBody
) {
  const account = await resolveManagedPaymentAccount(access)

  if (!account.member_tg_id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Telegram must be bound before creating a payment session'
    )
  }

  const plan = getPaymentPlan(body.planId)

  const kirapayApiKey = getRequiredKiraPayApiKey()

  if (!config.kirapayReceiverAddress) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'KIRAPAY_RECEIVER_ADDRESS is missing')
  }

  await ensureKiraPayWebhookConfigured(c).catch((error) => {
    log.warn({
      error,
      message: 'Failed to synchronize KiraPay webhook before creating payment session'
    })
  })

  const sessionId = crypto.randomUUID()
  const redirectUrl = getRedirectUrl(sessionId, body.redirectUrl)
  const providerRedirectUrl = getKiraPayCallbackUrl(c, sessionId, body.redirectUrl)
  const providerResponse = await fetch(`${getKiraPayApiBaseUrl()}/link/generate`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': kirapayApiKey
    },
    body: JSON.stringify({
      customOrderId: sessionId,
      fiatCurrency: 'USD',
      isViewAsCrypto: false,
      name: `Payment for ${plan.id}`,
      originalPrice: plan.amount,
      receiver: config.kirapayReceiverAddress,
      redirectUrl: providerRedirectUrl,
      tokenOut: body.tokenOut,
      type: 'single_use'
    })
  })

  const providerJson = (await providerResponse
    .json()
    .catch(() => null)) as KiraPayCreateLinkResponse

  log.info({
    message: 'Create KiraPay payment link response',
    planId: plan.id,
    providerJson,
    providerRedirectUrl,
    redirectUrl,
    sessionId,
    status: providerResponse.status,
    telegramId: account.member_tg_id,
    twitterId: account.twitter_id
  })

  if (
    !providerResponse.ok ||
    !providerJson ||
    !('data' in providerJson) ||
    !providerJson.data?.url
  ) {
    throw new ApiError(
      providerResponse.status || httpStatus.BAD_GATEWAY,
      providerJson?.message || 'Failed to create KiraPay payment link'
    )
  }

  const identifierInUsd = extractKiraPayLinkIdFromUrl(providerJson.data.url)
  if (!identifierInUsd) {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'Failed to extract KiraPay payment link identifier')
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const createdAt = now.toISOString()
  const expiresAtIso = expiresAt.toISOString()

  await db('primary').execute(sql`
    INSERT INTO invoices (
      id,
      user_id,
      plan_id,
      amount,
      paid,
      paid_at,
      created_at,
      expires_at,
      duration_days,
      plan_limit,
      identifier_in_usd
    )
    VALUES (
      ${sessionId},
      ${account.member_tg_id},
      ${plan.id},
      ${formatNumeric(plan.amount, 5)},
      false,
      NULL,
      ${createdAt},
      ${expiresAtIso},
      0,
      0,
      ${identifierInUsd}
    )
  `)

  log.info({
    amount: formatNumeric(plan.amount, 5),
    identifierInUsd,
    invoiceId: sessionId,
    message: 'Invoice created for KiraPay payment session',
    planId: plan.id,
    telegramId: account.member_tg_id
  })

  const invoice = await findInvoiceById(db('primary'), sessionId)
  if (!invoice) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to persist invoice')
  }

  return {
    ...buildPaymentSession(invoice, account),
    checkoutUrl: providerJson.data.url,
    providerOriginalPrice:
      typeof providerJson.data.originalPrice === 'number' ? providerJson.data.originalPrice : null,
    providerPrice: typeof providerJson.data.price === 'number' ? providerJson.data.price : null,
    redirectUrl
  }
}

export async function getPaymentSession(
  c: Context,
  access: ManagedPaymentAccessInput,
  sessionId: string
) {
  const account = await resolveManagedPaymentAccount(access)

  if (!account.member_tg_id) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Telegram is not bound on this account')
  }

  let invoice = await findInvoiceById(db('primary'), sessionId)
  if (!invoice || invoice.user_id !== account.member_tg_id) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Session not found')
  }

  await ensureKiraPayWebhookConfigured(c).catch((error) => {
    log.warn({
      error,
      invoiceId: sessionId,
      message: 'Failed to synchronize KiraPay webhook before fetching payment session'
    })
  })

  if (!invoice.paid) {
    const syncResult = await syncInvoicePaymentWithKiraPay(invoice).catch((error) => {
      log.error({
        error,
        invoiceId: invoice?.id,
        message: 'Failed to sync KiraPay payment status from API'
      })
      return null
    })

    if (syncResult?.invoiceId) {
      invoice = await findInvoiceById(db('primary'), syncResult.invoiceId)
    }
  }

  if (!invoice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Session not found')
  }

  return buildPaymentSession(invoice, account)
}

export async function getPaymentSessionStatus(
  access: ManagedPaymentAccessInput,
  sessionId: string
) {
  const account = await resolveManagedPaymentAccount(access)

  if (!account.member_tg_id) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Telegram is not bound on this account')
  }

  let invoice = await findInvoiceById(db('primary'), sessionId)
  if (!invoice || invoice.user_id !== account.member_tg_id) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Session not found')
  }

  let syncResult: Awaited<ReturnType<typeof syncInvoicePaymentWithKiraPay>> = null
  if (!invoice.paid) {
    syncResult = await syncInvoicePaymentWithKiraPay(invoice).catch((error) => {
      log.error({
        error,
        invoiceId: invoice?.id,
        message: 'Failed to sync KiraPay payment status endpoint'
      })
      return null
    })

    if (syncResult?.invoiceId) {
      invoice = await findInvoiceById(db('primary'), syncResult.invoiceId)
    }
  }

  if (!invoice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Session not found')
  }

  const payment = await findLatestPaymentByInvoiceId(db('primary'), invoice.id)

  return {
    ...buildPaymentSession(invoice, account),
    payment: serializePaymentRecord(payment),
    reconciliation: syncResult
      ? {
          matched: syncResult.matched,
          matchedBy: syncResult.matchedBy,
          newlyPaid: syncResult.newlyPaid,
          paymentId: syncResult.paymentId,
          status: syncResult.status
        }
      : null
  }
}

export async function handleKiraPayRedirectCallback(c: Context) {
  const rawBody = c.req.method === 'POST' ? await c.req.text() : ''
  const payload = buildKiraPayCallbackPayload(c, rawBody)
  let result = await handleKiraPayWebhook(c, payload)

  const sessionId = payload.customOrderId || payload.sessionId || payload.invoiceId
  if (sessionId && !result.paymentId) {
    const invoice = await findInvoiceById(db('primary'), sessionId)
    if (invoice && !invoice.paid) {
      const syncedResult = await syncInvoicePaymentWithKiraPay(invoice).catch((error) => {
        log.error({
          error,
          invoiceId: invoice.id,
          message: 'Failed to sync KiraPay payment during redirect callback'
        })
        return null
      })

      if (syncedResult) {
        result = syncedResult
      }
    }
  }

  const redirectUrl = buildKiraPayCallbackRedirectUrl(payload, result)

  log.info({
    message: 'KiraPay redirect callback processed',
    payload,
    redirectUrl,
    result
  })

  return {
    redirectUrl,
    result
  }
}

export async function handleKiraPayWebhook(_c: Context, rawPayload: unknown) {
  const payload =
    typeof rawPayload === 'string' ? parseWebhookPayload(rawPayload) : (rawPayload as unknown)

  if (!payload) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid KiraPay payload')
  }

  const eventName = getWebhookEventName(payload)
  const { rawStatus, status } = normalizeWebhookStatus(payload)
  log.info({
    eventName,
    message: 'KiraPay webhook received',
    payload,
    rawStatus,
    status
  })

  const result = await db('primary').transaction(async (tx) => {
    const { invoice, matchedBy } = await findMatchedInvoiceFromWebhook(tx, payload)

    if (!invoice) {
      return {
        acknowledged: true,
        matched: false,
        matchedBy: null,
        paymentId: null,
        status,
        webhookEvent: eventName
      }
    }

    if (status !== 'success') {
      return {
        acknowledged: true,
        invoiceId: invoice.id,
        matched: true,
        matchedBy,
        paymentId: null,
        status: status || 'pending',
        webhookEvent: eventName
      }
    }
    return persistSuccessfulPayment(tx, invoice, payload, matchedBy, eventName)
  })

  log.info({
    eventName,
    message: 'KiraPay webhook processed',
    rawStatus,
    result,
    status
  })

  return result
}
