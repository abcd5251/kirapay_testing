import { z } from 'zod'

export const paymentPlanIdSchema = z.enum(['Starter', 'Standard', 'Advanced'])

export const paymentTokenOutSchema = z.object({
  address: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.string().trim().min(1)
})

export const createPaymentSessionBodySchema = z.object({
  planId: paymentPlanIdSchema,
  redirectUrl: z.string().url().optional(),
  tokenOut: paymentTokenOutSchema
})

export const paymentSessionParamsSchema = z.object({
  sessionId: z.string().uuid()
})

export type CreatePaymentSessionBody = z.infer<typeof createPaymentSessionBodySchema>
export type PaymentSessionParams = z.infer<typeof paymentSessionParamsSchema>
