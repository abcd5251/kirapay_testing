import { route as authRoute } from './auth.route'
import { route as campaignRoute } from './campaign.route'
import { route as debugSentryRoute } from './debugSentry.route'
import { route as discoverRoute } from './discover.route'
import { route as healthRoute } from './health.route'
import { route as keywordMonitorRoute } from './keywordMonitor.route'
import { route as paymentsRoute } from './payments.route'
import { route as profilesRoute } from './profiles.route'
import { route as subscriptionRoute } from './subscription'
import { route as turnstileRoute } from './turnstile'
import { route as tweetsRoute } from './tweets.route'
import { route as twitterUsersRoute } from './twitterUsers.route'
import { route as userRoute } from './user.route'

const base_path = '/api/v1'

export const defaultRoutes = [
  {
    path: `${base_path}/auth`,
    route: authRoute
  },
  {
    path: `${base_path}/users`,
    route: userRoute
  },
  {
    path: `${base_path}/health`,
    route: healthRoute
  },
  {
    path: `${base_path}/profiles`,
    route: profilesRoute
  },
  {
    path: `${base_path}/twitterUsers`,
    route: twitterUsersRoute
  },
  {
    path: `${base_path}/discover`,
    route: discoverRoute
  },
  {
    path: `${base_path}/tweets`,
    route: tweetsRoute
  },
  {
    path: `${base_path}/turnstile`,
    route: turnstileRoute
  },
  {
    path: `${base_path}/campaigns`,
    route: campaignRoute
  },
  {
    path: `${base_path}/subscription`,
    route: subscriptionRoute
  },
  {
    path: `${base_path}/keywordMonitors`,
    route: keywordMonitorRoute
  },
  {
    path: `${base_path}/payments`,
    route: paymentsRoute
  },
  {
    path: `${base_path}/debug-sentry`,
    route: debugSentryRoute
  }
]
