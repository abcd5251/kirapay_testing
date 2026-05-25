import { Hono } from 'hono'
import * as subscriptionController from '../controllers/subscription/subscription.controller'
// import { rateLimit } from '../middlewares/rateLimiter'

export const route = new Hono()

route.post('/check-limit', subscriptionController.checkSubscriptionLimitController)
