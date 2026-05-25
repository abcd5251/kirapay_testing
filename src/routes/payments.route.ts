import { Hono } from 'hono'
import httpStatus from 'http-status'
import { handleKiraPayRedirectCallback, handleKiraPayWebhook } from '../services/payments.service'
import {
  createPaymentSessionHandler,
  getPaymentSessionHandler,
  getPaymentSessionStatusHandler
} from '@/controllers/payments.controller'

export const route = new Hono()

route.post('/sessions', createPaymentSessionHandler)

route.get('/sessions/:sessionId', getPaymentSessionHandler)

route.get('/sessions/:sessionId/status', getPaymentSessionStatusHandler)

route.get('/callbacks/kirapay', async (c) => {
  const { redirectUrl, result } = await handleKiraPayRedirectCallback(c)

  if (redirectUrl) {
    return c.redirect(redirectUrl, httpStatus.FOUND)
  }

  return c.json({
    code: httpStatus.OK,
    data: result,
    message: 'Callback processed'
  })
})

route.post('/callbacks/kirapay', async (c) => {
  const { redirectUrl, result } = await handleKiraPayRedirectCallback(c)

  if (redirectUrl) {
    return c.redirect(redirectUrl, httpStatus.FOUND)
  }

  return c.json({
    code: httpStatus.OK,
    data: result,
    message: 'Callback processed'
  })
})

route.post('/webhooks/kirapay', async (c) => {
  const rawBody = await c.req.text()
  const result = await handleKiraPayWebhook(c, rawBody)

  return c.json({
    code: httpStatus.OK,
    data: result,
    message: 'Webhook processed'
  })
})
