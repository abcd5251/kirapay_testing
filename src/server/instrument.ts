import * as Sentry from '@sentry/bun'
import { config } from '@/config'
// Ensure to call this before importing any other modules!
Sentry.init({
  dsn: config.sentryDsn,
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/bun/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
  tracesSampleRate: 1.0
})
