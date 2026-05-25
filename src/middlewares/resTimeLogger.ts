/**
 * @module
 * Logger Middleware for Hono.
 */

import { env } from 'hono/adapter'
import type { MiddlewareHandler } from 'hono/types'
import { getColorEnabled } from 'hono/utils/color'
import { createConfig } from '@/config'
import { logger as pinoLogger } from '@/utils/logger'
enum LogPrefix {
  Outgoing = '-->',
  Incoming = '<--',
  Error = 'xxx'
}

const time = (start: number) => {
  const delta = Date.now() - start
  return delta < 1000 ? delta + 'ms' : Math.round(delta / 1000) + '.' + (delta % 1000) + 's'
}

export const colorStatus = (status: number) => {
  const colorEnabled = getColorEnabled()
  const out: { [key: string]: string } = {
    7: colorEnabled ? `\x1b[35m${status}\x1b[0m` : `${status}`,
    5: colorEnabled ? `\x1b[31m${status}\x1b[0m` : `${status}`,
    4: colorEnabled ? `\x1b[33m${status}\x1b[0m` : `${status}`,
    3: colorEnabled ? `\x1b[36m${status}\x1b[0m` : `${status}`,
    2: colorEnabled ? `\x1b[32m${status}\x1b[0m` : `${status}`,
    1: colorEnabled ? `\x1b[32m${status}\x1b[0m` : `${status}`,
    0: colorEnabled ? `\x1b[33m${status}\x1b[0m` : `${status}`
  }

  const calculateStatus = (status / 100) | 0

  return out[calculateStatus]
}

function logMessage(
  prefix: string,
  method: string,
  path: string,
  status: number = 0,
  elapsed?: string
) {
  const out =
    prefix === LogPrefix.Incoming ? `${method} ${path}` : `${method} ${path} ${status} ${elapsed}`
  return out
}

/**
 * Res Time Logger Middleware for Hono.
 *
 * @see {@link https://hono.dev/docs/middleware/builtin/logger}
 *
 * @param {PrintFunc} [fn=console.log] - Optional function for customized logging behavior.
 * @returns {MiddlewareHandler} The middleware handler function.
 *
 * @example
 * ```ts
 * const app = new Hono()
 *
 * app.use(logger())
 * app.get('/', (c) => c.text('Hello Hono!'))
 * ```
 */
export const resTimeLogger = (): MiddlewareHandler => {
  return async function logger(c, next) {
    const config = createConfig(env(c))

    const { method } = c.req

    const path = c.req.raw.url

    const start = Date.now()

    await next()

    if (config.env !== 'test') {
      const msg = logMessage(LogPrefix.Outgoing, method, path, c.res.status, time(start))
      pinoLogger().info(msg)
    }
  }
}
