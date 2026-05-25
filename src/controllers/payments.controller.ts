import { type Context } from 'hono'
import httpStatus from 'http-status'
import {
  createPaymentSession,
  getPaymentSession,
  getPaymentSessionStatus
} from '@/services/payments.service'
import { assertAllowedFrontendOrigin, getXSession } from '@/services/xAuth.service'
import { ApiError } from '@/utils/ApiError'
import { extractApiKey } from '@/utils/requestAuth'
import {
  createPaymentSessionBodySchema,
  paymentSessionParamsSchema
} from '@/validations/payments.validation'

const resolveManagedPaymentAccess = (c: Context) => {
  const apiKey = extractApiKey(c)
  const session = getXSession(c)

  if (!apiKey && !session) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'API key or signed-in X session is required')
  }

  if (session) {
    assertAllowedFrontendOrigin(c)
  }

  return {
    apiKey,
    sessionTwitterId: session?.twitterId
  }
}

export const createPaymentSessionHandler = async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsedBody = createPaymentSessionBodySchema.safeParse(body)

  if (!parsedBody.success) {
    return c.json(
      {
        issues: parsedBody.error.flatten(),
        message: 'Invalid payment session payload'
      },
      httpStatus.BAD_REQUEST
    )
  }

  const session = await createPaymentSession(c, resolveManagedPaymentAccess(c), parsedBody.data)
  return c.json(
    {
      code: httpStatus.CREATED,
      data: session,
      message: 'Payment session created'
    },
    httpStatus.CREATED
  )
}

export const getPaymentSessionHandler = async (c: Context) => {
  const parsedParams = paymentSessionParamsSchema.safeParse(c.req.param())

  if (!parsedParams.success) {
    return c.json(
      {
        issues: parsedParams.error.flatten(),
        message: 'Invalid payment session id'
      },
      httpStatus.BAD_REQUEST
    )
  }

  const session = await getPaymentSession(
    c,
    resolveManagedPaymentAccess(c),
    parsedParams.data.sessionId
  )
  return c.json({
    code: httpStatus.OK,
    data: session,
    message: 'Payment session fetched'
  })
}

export const getPaymentSessionStatusHandler = async (c: Context) => {
  const parsedParams = paymentSessionParamsSchema.safeParse(c.req.param())

  if (!parsedParams.success) {
    return c.json(
      {
        issues: parsedParams.error.flatten(),
        message: 'Invalid payment session id'
      },
      httpStatus.BAD_REQUEST
    )
  }

  const session = await getPaymentSessionStatus(
    resolveManagedPaymentAccess(c),
    parsedParams.data.sessionId
  )
  return c.json({
    code: httpStatus.OK,
    data: session,
    message: 'Payment session status fetched'
  })
}
