import { z } from 'zod'

const DEFAULT_REFERRAL_SCOPE = 'api_service'

export const usageQuery = z
  .object({
    range: z.enum(['7d', '30d', '7', '30']).optional().default('7d')
  })
  .transform(({ range }) => ({
    range: range === '30' ? '30d' : range === '7' ? '7d' : range,
    rangeDays: range === '30d' || range === '30' ? 30 : 7
  }))

export type UsageQuery = z.infer<typeof usageQuery>

export const creditIncreaseHistoryQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
    range: z.enum(['7d', '30d', 'all', '7', '30']).optional().default('30d'),
    source: z.enum(['all', 'topup', 'signup', 'referral']).optional().default('all')
  })
  .transform(({ page, pageSize, range, source }) => ({
    offset: (page - 1) * pageSize,
    page,
    pageSize,
    range: range === '30' ? '30d' : range === '7' ? '7d' : range,
    rangeDays: range === 'all' ? null : range === '30d' || range === '30' ? 30 : 7,
    source
  }))

export type CreditIncreaseHistoryQuery = z.infer<typeof creditIncreaseHistoryQuery>

export const creditEventsQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
    range: z.enum(['7d', '30d', 'all', '7', '30']).optional().default('30d'),
    source: z
      .enum(['all', 'topup', 'signup', 'telegram', 'referral', 'other'])
      .optional()
      .default('all'),
    direction: z.enum(['all', 'added', 'deducted']).optional().default('all')
  })
  .transform(({ direction, page, pageSize, range, source }) => ({
    direction,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
    range: range === '30' ? '30d' : range === '7' ? '7d' : range,
    rangeDays: range === 'all' ? null : range === '30d' || range === '30' ? 30 : 7,
    source
  }))

export type CreditEventsQuery = z.infer<typeof creditEventsQuery>

export const referralResolveQuery = z.object({
  ref: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
})

export type ReferralResolveQuery = z.infer<typeof referralResolveQuery>

export const createReferralBody = z.object({
  referreeTelegramId: z.string().trim().min(1).max(36),
  referralScope: z.string().trim().min(1).max(32).optional().default(DEFAULT_REFERRAL_SCOPE)
})

export type CreateReferralBody = z.infer<typeof createReferralBody>

export const createReferralPaymentBody = z.object({
  referreeTelegramId: z.string().trim().min(1).max(36),
  paymentId: z.string().trim().min(1).max(64),
  referralScope: z.string().trim().min(1).max(32).optional().default(DEFAULT_REFERRAL_SCOPE)
})

export type CreateReferralPaymentBody = z.infer<typeof createReferralPaymentBody>
