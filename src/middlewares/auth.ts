import jwt from '@tsndr/cloudflare-worker-jwt'
import { type MiddlewareHandler } from 'hono'
import { env } from 'hono/adapter'
import httpStatus from 'http-status'
import { createConfig } from '../config'
import { ApiError } from '../utils/ApiError'
import { roleRights, type Permission, tokenTypes } from '../validations/token'
import { validateTokenPayload } from '@/validations/token'

const authenticate = async (jwtToken: string, secret: string) => {
  let authorized = false
  let payload = null
  try {
    authorized = await jwt.verify(jwtToken, secret)
    const decoded = jwt.decode(jwtToken)
    payload = validateTokenPayload(decoded.payload)

    authorized = authorized && payload?.type === tokenTypes.ACCESS
  } catch {}
  return { authorized, payload }
}

export const auth =
  (...requiredRights: Permission[]): MiddlewareHandler =>
  async (c, next) => {
    const credentials = c.req.raw.headers.get('Authorization')

    const config = createConfig(env(c))
    if (!credentials) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate')
    }

    const parts = credentials.split(/\s+/)
    if (parts.length !== 2) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate')
    }

    const jwtToken = parts[1]
    const { authorized, payload } = await authenticate(jwtToken, config.jwt.secret)

    if (!authorized || !payload) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate')
    }

    if (requiredRights.length) {
      const userRights = roleRights[payload.role]
      const hasRequiredRights = requiredRights.every((requiredRight) =>
        (userRights as unknown as string[]).includes(requiredRight)
      )
      if (!hasRequiredRights && c.req.param('userId') !== payload.sub) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden')
      }
    }

    c.set('payload', payload)
    await next()
  }
