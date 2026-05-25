import * as Sentry from '@sentry/bun'
import type { ErrorHandler } from 'hono'
import { env } from 'hono/adapter'
import { type StatusCode } from 'hono/utils/http-status'
import httpStatus from 'http-status'
import { ZodError } from 'zod'
import { ApiError } from '../utils/ApiError'
import { generateZodErrorMessage } from '../utils/zod'
import { logger } from '@/utils/logger'

const genericJSONErrMsg = 'Unexpected end of JSON input'

export const errorConverter = (err: unknown): ApiError => {
  let error = err
  if (error instanceof ZodError) {
    const errorMessage = generateZodErrorMessage(error)
    error = new ApiError(httpStatus.BAD_REQUEST, errorMessage)
  } else if (error instanceof SyntaxError && error.message.includes(genericJSONErrMsg)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid JSON payload')
  } else if (!(error instanceof ApiError)) {
    const castedErr = (typeof error === 'object' ? error : {}) as Record<string, unknown>
    const statusCode: StatusCode =
      typeof castedErr.statusCode === 'number'
        ? (castedErr.statusCode as StatusCode)
        : httpStatus.INTERNAL_SERVER_ERROR
    const message = (castedErr.description ||
      castedErr.message ||
      httpStatus[statusCode.toString() as keyof typeof httpStatus]) as string
    if (statusCode >= httpStatus.INTERNAL_SERVER_ERROR) {
      // Log any unhandled application error
      logger().error(err, 'Uncaught Exception')
      Sentry.captureException(err)
    }
    error = new ApiError(statusCode, message, false)
  }
  return error as ApiError
}

export const errorHandler: ErrorHandler = async (err, c) => {
  // Can't load config in case error is inside config so load env here and default
  // to highest obscurity aka production if env is not set
  const environment = env(c).ENV || 'production'

  const error = errorConverter(err)

  if (environment === 'production' && !error.isOperational) {
    error.statusCode = httpStatus.INTERNAL_SERVER_ERROR
    error.message = httpStatus[httpStatus.INTERNAL_SERVER_ERROR].toString()
  }

  const response = {
    code: error.statusCode,
    message: error.message,
    ...(environment === 'development' && { stack: err.stack })
  }
  delete c.error // Don't pass to sentry middleware as it is either logged or already handled
  return c.json(response, error.statusCode as any)
}
