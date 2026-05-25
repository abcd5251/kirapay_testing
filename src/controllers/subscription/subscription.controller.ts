import { Context } from 'hono'
import { checkSubscriptionLimit } from '@/services/twitterSubscription'
import { logger } from '@/utils/logger'
import * as subscriptionValidation from '@/validations/subscription.validation'

export async function checkSubscriptionLimitController(c: Context) {
  try {
    const bodyParse = await c.req.json()
    const { clientId, twitterUsername } =
      subscriptionValidation.checkSubscriptionLimit.parse(bodyParse)

    // Create subscriber info object
    const subscriber = {
      subscriberId: clientId,
      subscriberType: 'webapp' as const,
      subscriberMeta: {}
    }

    // Use the service function to check subscription limit
    const result = await checkSubscriptionLimit(subscriber, twitterUsername)

    return c.json({
      success: true,
      data: {
        ...result
      }
    })
  } catch (error) {
    logger().error(error, 'Failed to check subscription limit')
    return c.json({ error: 'Internal server error' }, 500)
  }
}
