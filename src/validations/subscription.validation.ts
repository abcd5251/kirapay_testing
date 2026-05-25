import { z } from 'zod'

export const checkSubscriptionLimit = z.object({
  clientId: z.string().min(1, 'clientId is required'),
  twitterUsername: z
    .string()
    .min(1, 'twitterUsername is required')
    .max(15, 'Twitter username cannot exceed 15 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Twitter username can only contain letters, numbers, and underscores')
})

export type CheckSubscriptionLimit = z.infer<typeof checkSubscriptionLimit>
