import { Hono } from 'hono'
import * as twitterUserController from '../controllers/twitterUser'
import { turnstileVerify } from '../middlewares/turnstile.middleware'

export const route = new Hono()

route.use('*', turnstileVerify)

// Public endpoint - no turnstile protection needed
route.get('/', twitterUserController.getTopTwitterUsers)

// Appply turnstile middleware directly to the username route
route.get('/:username', twitterUserController.getTwitterUser)
