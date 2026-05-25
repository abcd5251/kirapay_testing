import { Hono } from 'hono'
import * as apiCreditController from '../controllers/apiCredit.controller'

export const route = new Hono()

route.post('/', apiCreditController.createTwitterApiKey)
route.post('/bind-telegram', apiCreditController.bindTelegramForApiCredits)
route.get('/telegram-photo/:telegramId', apiCreditController.getTelegramPhotoProxy)
route.get('/me', apiCreditController.getApiKeyAccountProfile)
route.get('/referral', apiCreditController.getTelegramReferralProfile)
route.post('/referral', apiCreditController.createTelegramReferral)
route.get('/referral/resolve', apiCreditController.resolveTelegramReferralCode)
route.post('/referral/payment', apiCreditController.createReferralPayment)
route.get('/credits-events', apiCreditController.getApiCreditEvents)
route.get('/credits-history', apiCreditController.getApiCreditIncreaseHistory)
route.get('/usage', apiCreditController.getApiKeyUsage)
route.post('/top-up', apiCreditController.topUpApiCredits)
