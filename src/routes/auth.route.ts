import { Hono } from 'hono'
import * as authController from '../controllers/auth/auth.controller'
import { auth } from '../middlewares/auth'
// import { rateLimit } from '../middlewares/rateLimiter'

export const route = new Hono()

// const twoMinutes = 120
// const oneRequest = 1

route.post('/register', authController.register)
route.post('/login', authController.login)
route.post('/code-login', authController.codeLogin)
route.get('/x/start', authController.startXOAuth)
route.get('/x/callback', authController.xOAuthCallback)
route.get('/x/session', authController.getXOAuthSession)
route.post('/x/logout', authController.logoutXOAuthSession)
route.post('/refresh-tokens', authController.refreshTokens)
route.post('/forgot-password', authController.forgotPassword)
route.post('/reset-password', authController.resetPassword)
route.post(
  '/send-verification-email',
  auth(),
  // rateLimit(twoMinutes, oneRequest),
  authController.sendVerificationEmail
)
route.post('/verify-email', authController.verifyEmail)
route.get('/authorisations', auth(), authController.getAuthorisations)
