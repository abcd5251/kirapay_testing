import { Hono } from 'hono'

export const route = new Hono()

route.get('/', async (_c) => {
  throw new Error('Test error for Sentry debugging')
})
