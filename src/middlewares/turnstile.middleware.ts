import { Context, MiddlewareHandler, Next } from 'hono'
import httpStatus from 'http-status'
import { tokenStore } from '../services/turnstile.service'

/**
 * Middleware to verify that the request has a valid turnstile token in the Authorization header
 */
export const turnstileVerify: MiddlewareHandler = async (c: Context, next: Next) => {
  // Get token from Authorization header
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Turnstile ')) {
    return c.json(
      {
        code: httpStatus.UNAUTHORIZED,
        message: 'Turnstile verification required - missing token'
      },
      httpStatus.UNAUTHORIZED
    )
  }

  // Extract the token from the header
  const token = authHeader.replace('Turnstile ', '').trim()

  // Verify the token
  if (!tokenStore.verifyToken(token)) {
    return c.json(
      {
        code: httpStatus.UNAUTHORIZED,
        message: 'Turnstile verification required - invalid or expired token'
      },
      httpStatus.UNAUTHORIZED
    )
  }

  // Token is valid, continue to the route handler
  await next()
}
