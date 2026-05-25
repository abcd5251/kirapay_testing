import { Hono } from 'hono'
import { apiKeyRateLimiter } from '../middlewares/apiKeyRateLimiter'
import {
  addCampaign,
  getCampaigns,
  getCampaign,
  getCampaignUsers,
  getCampaignTweets
} from '@/controllers/twitterUser'

export const route = new Hono()

// Apply API key rate limiting middleware
route.use(
  '*',
  apiKeyRateLimiter({
    windowMs: 15 * 1000,
    maxRequests: 10
  })
)

route.post('/', addCampaign)

// Get all search keyword monitors
route.get('/', getCampaigns)

// Get users for a specific search keyword monitor
route.get('/:slug', getCampaign)

// Get users for a specific search keyword monitor
route.get('/:slug/users', getCampaignUsers)

// Get users for a specific search keyword monitor
route.get('/:slug/tweets', getCampaignTweets)
