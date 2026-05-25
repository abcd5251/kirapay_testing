import { Hono } from 'hono'
import * as twitterUserController from '../controllers/twitterUser'
import { turnstileVerify } from '../middlewares/turnstile.middleware'

export const route = new Hono()

// Apply turnstile middleware to all routes in this controller
route.use('*', turnstileVerify)

route.get('/', twitterUserController.getFollowing)
route.get('/:timePeriod', twitterUserController.getFollowingByTimePeriod)
