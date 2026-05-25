import { Hono } from 'hono'
import {
  apiKeyRateLimiter,
  getRateLimitStats,
  getRateLimitInfo
} from '../middlewares/apiKeyRateLimiter'

export const route = new Hono()

// Test route with default rate limiting (15 minutes, 1000 requests, max 100 API keys)
route.get('/test', apiKeyRateLimiter(), (c) => {
  return c.json({
    message: 'Rate limit test successful',
    timestamp: new Date().toISOString()
  })
})

// Route to check rate limit stats (for monitoring)
route.get('/stats', (c) => {
  const stats = getRateLimitStats()
  return c.json({
    message: 'Rate limit statistics',
    stats,
    timestamp: new Date().toISOString()
  })
})

// Route to check specific API key rate limit info
route.get('/info/:apiKey', (c) => {
  const apiKey = c.req.param('apiKey')
  const info = getRateLimitInfo(apiKey)

  if (!info) {
    return c.json({
      message: 'No active rate limit found for this API key',
      apiKey
    })
  }

  return c.json({
    message: 'Rate limit info for API key',
    apiKey,
    info: {
      count: info.count,
      resetTime: new Date(info.resetTime).toISOString(),
      remaining: 1000 - info.count
    }
  })
})

