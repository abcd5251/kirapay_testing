import { Hono } from 'hono'
// import httpStatus from 'http-status'
// import { inited } from '@/app'
import { testConnection } from '@/db'
// import { ApiError } from '@/utils/ApiError'

export const route = new Hono()

// Add health check endpoint
route.get('/', async (c) => {
  const healthStatus: {
    status: string
    database: string
    timestamp: string
    error?: string
  } = {
    status: 'healthy',
    database: 'unknown',
    timestamp: new Date().toISOString()
  }

  let hasError = false

  // Test database connection
  try {
    await testConnection()
    healthStatus.database = 'connected'
  } catch (error) {
    healthStatus.database = 'disconnected'
    healthStatus.error = error instanceof Error ? error.message : 'Unknown error'
    hasError = true
  }

  if (hasError) {
    healthStatus.status = 'unhealthy'
    return c.json(healthStatus, 503)
  }

  return c.json(healthStatus)
})
