import { Hono } from 'hono'
import { tokenStore, verifyTurnstile } from '../services/turnstile.service'
import { config } from '@/config'

export const route = new Hono()

// Validate token and return a verification token
route.post('/validate', async (c) => {
  const { token } = await c.req.json()
  const result = await verifyTurnstile(token, config.turnstileSecretKey)

  if (result.success) {
    // Generate a token and store it in memory
    const verificationToken = tokenStore.createToken()

    // Return the token in the response instead of setting a cookie
    return c.json({
      success: true,
      token: verificationToken,
      expiresIn: 10 * 60 // 10 minutes in seconds
    })
  }

  return c.json(result)
})

// Validate the token (now sent in request body)
route.post('/check', async (c) => {
  const { token } = await c.req.json()

  const isValid = token ? tokenStore.verifyToken(token) : false

  if (isValid) {
    return c.json({ success: true })
  } else {
    return c.json({
      success: false,
      error: 'Turnstile verification invalid or expired'
    })
  }
})
