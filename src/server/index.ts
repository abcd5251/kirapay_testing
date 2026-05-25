import { Hono } from 'hono'
import { cors } from 'hono/cors'
import httpStatus from 'http-status'
import { config } from '@/config'
import { errorHandler } from '@/middlewares/error'
import { resTimeLogger } from '@/middlewares/resTimeLogger'
import { defaultRoutes } from '@/routes'
import { ApiError } from '@/utils/ApiError'
import './instrument'

interface Dependencies {
  ws?: any
}

export function createServer(dependencies?: Dependencies) {
  const app = new Hono()
  const configuredOrigins = config.corsOrigin
    ? config.corsOrigin
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : null

  app.use(resTimeLogger())

  // Configure CORS for API requests
  app.use(
    '*',
    cors({
      // In production, restrict to your domains; in dev allow all localhost ports
      origin:
        configuredOrigins && configuredOrigins.length > 0
          ? configuredOrigins
          : config.env === 'production'
            ? ['https://foxhole.bot', 'https://info-meme.vercel.app']
            : ['http://localhost:3000', 'http://localhost:3001'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true,
      exposeHeaders: [
        'Content-Length',
        'X-Request-Id',
        'X-Credits-Remaining',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset'
      ],
      maxAge: 600 // 10 minutes
    })
  )

  app.notFound(() => {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found')
  })

  app.onError(errorHandler)

  defaultRoutes.forEach((route) => {
    app.route(`${route.path}`, route.route)
  })

  if (dependencies?.ws) {
    app.get('/ws/:clientId', dependencies.ws)
  }

  return app
}

export type Server = Awaited<ReturnType<typeof createServer>>

let handle: undefined | ReturnType<typeof Bun.serve>

export function createServerManager(
  server: any,
  options: { host: string; port: number; websocket?: any }
) {
  return {
    start() {
      handle = Bun.serve({
        fetch: server.fetch,
        websocket: options.websocket,
        hostname: options.host,
        port: options.port,
        idleTimeout: 120
      })
      return {
        url: handle.url
      }
    },
    stop() {
      return handle?.stop()
    }
  }
}
