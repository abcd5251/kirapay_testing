import { logger } from './logger'

// Define a custom interface that extends RequestInit
interface LoggedFetchOptions extends RequestInit {
  maxRetries?: number
  timeout?: number
}

// Rate limiter class to handle requests per second
class RateLimiter {
  private requests: number[] = [] // Timestamps of recent requests
  private readonly maxRequests: number
  private readonly windowMs: number = 1000 // 1 second window
  private rateLimitUntil: number = 0 // When we can make requests again after 429
  private inFlight: number = 0 // Number of requests currently in flight
  private queue: Array<() => void> = [] // Queue of waiting requests
  private processing: boolean = false // Lock to prevent concurrent processing

  constructor(maxRequests: number) {
    this.maxRequests = maxRequests
  }

  async waitForRateLimit(): Promise<void> {
    // Use a promise to queue this request
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    // Prevent concurrent processing
    if (this.processing) {
      return
    }

    this.processing = true

    try {
      while (this.queue.length > 0) {
        const now = Date.now()

        // If we're in a rate limit cooldown period, wait
        if (now < this.rateLimitUntil) {
          const waitTime = this.rateLimitUntil - now
          logger().warn(`Rate limit cooldown active. Waiting ${waitTime}ms`)
          await new Promise((resolve) => setTimeout(resolve, waitTime))
          continue
        }

        // Clean up old requests outside the window
        const windowStart = now - this.windowMs
        this.requests = this.requests.filter((timestamp) => timestamp > windowStart)

        // Check if we're at the limit (considering both completed and in-flight requests)
        const totalRequests = this.requests.length + this.inFlight
        if (totalRequests >= this.maxRequests) {
          // If we have completed requests, wait for the oldest to expire
          if (this.requests.length > 0) {
            const oldestRequest = this.requests[0]
            const waitTime = oldestRequest + this.windowMs - now + 1 // +1 to ensure we're past the window
            logger().warn(
              `Rate limit reached (${this.requests.length} completed + ${this.inFlight} in-flight = ${totalRequests}/${this.maxRequests}). Waiting ${waitTime}ms`
            )
            await new Promise((resolve) => setTimeout(resolve, waitTime))
            continue
          } else {
            // All requests are in-flight, wait a bit and check again
            await new Promise((resolve) => setTimeout(resolve, 50))
            continue
          }
        }

        // We can proceed - increment in-flight counter and resolve the promise
        this.inFlight++
        const resolve = this.queue.shift()!
        resolve()
      }
    } finally {
      this.processing = false
      // If new items were added while processing, process them
      if (this.queue.length > 0) {
        // Use setTimeout to avoid stack overflow and allow other code to run
        setTimeout(() => this.processQueue(), 0)
      }
    }
  }

  recordRequest(): void {
    // Record when request actually completes
    const requestTime = Date.now()
    this.requests.push(requestTime)
    this.inFlight--
    // Trigger queue processing so waiting requests can proceed
    this.processQueue()
  }

  handle429Error(): void {
    // When we get a 429, wait for the next second window
    const now = Date.now()
    // Wait until the start of the next second window
    this.rateLimitUntil = Math.ceil(now / 1000) * 1000 + 100 // Add 100ms buffer
    logger().warn(
      `429 error detected. Rate limit cooldown until ${new Date(this.rateLimitUntil).toISOString()}`
    )
  }
}

// Map of hosts to their rate limits (requests per second)
const hostRateLimits: Record<string, number> = {
  'twitter283.p.rapidapi.com': 100,
  'twitter241.p.rapidapi.com': 10,
  'twitter-aio.p.rapidapi.com': 10
}

// Map of rate limiters keyed by host + API key
const rateLimiters = new Map<string, RateLimiter>()

function getHostFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    // If URL parsing fails, return null
    return null
  }
}

function getRateLimiterKey(url: string, headers?: HeadersInit): string | null {
  // Extract API key from headers
  let apiKey: string | null = null
  if (headers) {
    if (headers instanceof Headers) {
      apiKey = headers.get('x-rapidapi-key')
    } else if (Array.isArray(headers)) {
      const keyHeader = headers.find(([key]) => key.toLowerCase() === 'x-rapidapi-key')
      apiKey = keyHeader ? (keyHeader[1] as string) : null
    } else {
      // Record<string, string>
      apiKey = (headers as Record<string, string>)['x-rapidapi-key'] || null
    }
  }

  // No rate limiting if no API key
  if (!apiKey) {
    return null
  }

  // Extract host from URL
  const host = getHostFromUrl(url)
  if (!host) {
    return null
  }

  // Return key as host + API key
  return `${host}:${apiKey}`
}

function getRateLimiter(url: string, headers?: HeadersInit): RateLimiter | null {
  const key = getRateLimiterKey(url, headers)
  if (!key) {
    return null
  }

  if (!rateLimiters.has(key)) {
    // Extract host from key (format: "host:apiKey")
    const host = key.split(':')[0]
    const maxRequests = hostRateLimits[host] ?? 100 // Default to 100 if host not configured
    rateLimiters.set(key, new RateLimiter(maxRequests))
  }

  return rateLimiters.get(key)!
}

export async function loggedFetch(
  url: string,
  options?: LoggedFetchOptions,
  defaultResponse?: any
) {
  // Extract custom options with defaults
  const { maxRetries: customMaxRetries, timeout: customTimeout, ...fetchOptions } = options || {}

  // Use provided values or defaults
  const maxRetries = customMaxRetries ?? 3
  const timeout = customTimeout ?? 7000 // 7 seconds default

  let retryCount = 0
  const rateLimiter = getRateLimiter(url, fetchOptions.headers)

  while (true) {
    try {
      // Wait for rate limit before making request (only if rate limiter exists)
      if (rateLimiter) {
        await rateLimiter.waitForRateLimit()
      }

      // Add timeout to fetch
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      }).finally(() => {
        clearTimeout(timeoutId)
        // Record request completion for rate limiting
        if (rateLimiter) {
          rateLimiter.recordRequest()
        }
      })

      if (!response.ok) {
        if (response.status === 400 && defaultResponse) {
          logger().warn(`400 error for ${url}. Returning default response ${defaultResponse}.`)
          return defaultResponse
        }

        // Handle 429 rate limit errors specially
        if (response.status === 429 && rateLimiter) {
          const text = await response.text()
          rateLimiter.handle429Error()
          throw new Error(`HTTP error! status: ${response.status} ${text}`)
        }

        const text = await response.text()
        throw new Error(`HTTP error! status: ${response.status} ${text}`)
      }

      const data = await response.json()
      return data
    } catch (error: any) {
      retryCount++

      // Use exponential backoff for all errors
      // waitForRateLimit() will handle the cooldown period when we retry
      const waitTime = Math.min(100 * Math.pow(2, retryCount), 10000) // exponential backoff with max 10s

      // Log the full error details
      logger().warn(
        {
          error: {
            name: error.name,
            message: error.message,
            code: error.code,
            type: error.type,
            cause: error.cause,
            stack: error.stack
          },
          url,
          retryCount,
          maxRetries,
          waitTime
        },
        `Error fetching ${url}. Retry ${retryCount}/${maxRetries}. Waiting ${waitTime}ms`
      )

      if (retryCount >= maxRetries) {
        logger().error(
          {
            error: {
              name: error.name,
              message: error.message,
              code: error.code,
              type: error.type,
              cause: error.cause,
              stack: error.stack
            },
            url,
            retryCount,
            maxRetries,
            waitTime
          },
          `Max retries (${maxRetries}) reached for fetching ${url}. Giving up.`
        )
        return defaultResponse ?? null
      }

      // Wait before retry
      try {
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      } catch (timeoutError) {
        logger().error(`Error during timeout between retries: ${timeoutError}`)
      }
    }
  }
}
