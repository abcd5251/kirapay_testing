import { Hono } from 'hono'
import {
  addCampaign,
  getCampaigns,
  getCampaign,
  getCampaignUsers,
  getCampaignTweets
} from '@/controllers/twitterUser'
import { turnstileVerify } from '@/middlewares/turnstile.middleware'

export const route = new Hono()

// Apply turnstile middleware to all routes in this controller
route.use('*', turnstileVerify)

route.post('/', addCampaign)

// Get all search keyword monitors
route.get('/', getCampaigns)

// Get users for a specific search keyword monitor
route.get('/:slug', getCampaign)

// Get users for a specific search keyword monitor
route.get('/:slug/users', getCampaignUsers)

// Get users for a specific search keyword monitor
route.get('/:slug/tweets', getCampaignTweets)
