import httpStatus from 'http-status'
import { getKiraPayCheckoutUrl, getRedirectUrl } from './kirapay.helpers'
import type { InvoiceRow, ManagedPaymentAccountRow, PaymentRecordRow } from './payments.types'
import { parseNumeric, toDate, toIsoString } from './payments.utils'
import { ApiError } from '@/utils/ApiError'

const PAYMENT_PLANS = {
  Advanced: {
    amount: 40,
    credits: 60000,
    id: 'Advanced'
  },
  Standard: {
    amount: 20,
    credits: 25000,
    id: 'Standard'
  },
  Starter: {
    amount: 10,
    credits: 10000,
    id: 'Starter'
  }
} as const

type PaymentPlanId = keyof typeof PAYMENT_PLANS

export function getPaymentPlan(planId: string) {
  const plan = PAYMENT_PLANS[planId as PaymentPlanId]
  if (!plan) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported payment plan')
  }
  return plan
}

export function buildPaymentSession(invoice: InvoiceRow, account: ManagedPaymentAccountRow) {
  const plan = getPaymentPlan(invoice.plan_id)
  const expiresAt = toDate(invoice.expires_at)
  const paidAt = toIsoString(invoice.paid_at)
  const now = new Date()
  const status = invoice.paid
    ? 'success'
    : expiresAt.getTime() <= now.getTime()
      ? 'expired'
      : 'pending'

  return {
    amount: parseNumeric(invoice.amount),
    checkoutUrl: getKiraPayCheckoutUrl(invoice.identifier_in_usd),
    createdAt: toIsoString(invoice.created_at),
    creditsToAdd: plan.credits,
    customOrderId: invoice.id,
    expiresAt: expiresAt.toISOString(),
    id: invoice.id,
    identifierInUsd: invoice.identifier_in_usd,
    paid: invoice.paid,
    paidAt,
    plan: {
      amount: plan.amount,
      credits: plan.credits,
      id: plan.id
    },
    qrCodeValue: getKiraPayCheckoutUrl(invoice.identifier_in_usd),
    redirectUrl: getRedirectUrl(invoice.id),
    status,
    telegramId: account.member_tg_id,
    twitterId: account.twitter_id
  }
}

export function serializePaymentRecord(payment: PaymentRecordRow | null) {
  if (!payment) {
    return null
  }

  return {
    amount: payment.amount === null ? null : parseNumeric(payment.amount),
    chain: payment.chain,
    createdAt: toIsoString(payment.created_at),
    fromAddress: payment.from_address,
    id: payment.id,
    toAddress: payment.to_address,
    token: payment.token,
    txHash: payment.tx_hash
  }
}
