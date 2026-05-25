import { logger } from './logger'
import { withTimeout, withRetry } from '@/utils/apiWrappers'

// Local redirection map for known redirections
const urlRedirectMap = new Map<string, string>([
  // Add your known redirections here
  // ['t.co/xJqRByq1Z6', 'abc.com'],
  // ['abc.com', 'cde.com']
])

interface RedirectResult {
  finalUrl: string
  redirectChain: string[]
}

async function getRedirectUrlFromNetwork(url: string): Promise<string | null> {
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          fetch(url, {
            method: 'HEAD',
            redirect: 'manual' // Only gets the next redirect
          }),
          `getRedirectUrlFromNetwork ${url}`,
          5000
        ),
      `getRedirectUrlFromNetwork ${url}`,
      2
    )

    if (response.headers.get('location')) {
      return response.headers.get('location')
    }
    return null
  } catch (error: any) {
    logger().error(
      {
        url,
        error: error.message
      },
      'Failed to get redirect from network'
    )
    return null
  }
}

export async function resolveUrlTracked(url: string): Promise<RedirectResult> {
  const redirectChain: string[] = []

  async function resolveRecursively(currentUrl: string): Promise<string> {
    if (redirectChain.includes(currentUrl)) {
      return currentUrl
    }

    // Add current URL to chain
    redirectChain.push(currentUrl)

    // Normalize URL for map lookup
    const normalizedUrl = currentUrl.toLowerCase()

    // First check local redirect map
    const mappedUrl = urlRedirectMap.get(normalizedUrl)
    if (mappedUrl) {
      // Recursively resolve the mapped URL
      return resolveRecursively(mappedUrl)
    }

    // If not in map, try network resolution
    const redirectUrl = await getRedirectUrlFromNetwork(currentUrl)
    if (redirectUrl && redirectUrl !== currentUrl) {
      // Handle relative URLs by resolving against the current URL
      let absoluteRedirectUrl = redirectUrl

      // Check if the redirect URL is relative (starts with / or doesn't have protocol)
      if (redirectUrl.startsWith('/') || !redirectUrl.includes('://')) {
        // Create a URL object using the current URL as base
        const baseUrl = new URL(currentUrl)
        absoluteRedirectUrl = new URL(redirectUrl, baseUrl.origin).toString()
      }

      // Add to our local map for future use
      urlRedirectMap.set(normalizedUrl, absoluteRedirectUrl)

      // Recursively resolve the redirect URL
      return resolveRecursively(absoluteRedirectUrl)
    }

    // No more redirects found, return current URL
    return currentUrl
  }

  const finalUrl = await resolveRecursively(url)

  return {
    finalUrl,
    redirectChain
  }
}

// Local redirection map for known redirections
const urlFollowRedirectMap = new Map<string, string>([])

export async function resolveUrlDirect(url: string): Promise<string> {
  try {
    // Check cache first
    const normalizedUrl = url.toLowerCase()
    const cachedUrl = urlFollowRedirectMap.get(normalizedUrl)
    if (cachedUrl) {
      return cachedUrl
    }

    const response = await withRetry(
      () =>
        withTimeout(
          fetch(url, {
            method: 'HEAD',
            redirect: 'follow' // Only gets the next redirect
          }),
          `resolveUrlDirect for ${url}`,
          5000
        ),
      `resolveUrlDirect for ${url}`,
      2
    )

    // Return the final URL after all redirects have been followed
    const finalUrl = response.url

    // Cache the result for future use
    if (finalUrl !== url) {
      urlFollowRedirectMap.set(normalizedUrl, finalUrl)
    }

    return finalUrl
  } catch (error) {
    logger().error(
      {
        url,
        error: error instanceof Error ? error.message : String(error)
      },
      'Error resolving URL destination'
    )

    // Return the original URL if resolution fails
    return url
  }
}

export async function extractUrlsWithRedirectPaths(text: string): Promise<string[]> {
  if (!text) return []

  // Regular expression to match URLs
  const tcoUrlRegex = /https?:\/\/t\.co\/([A-Za-z0-9_-]{10})/gi
  const urls = text.match(tcoUrlRegex) || []

  const resolvedUrls = await Promise.all(
    urls.map(async (url) => {
      const redirectResult = await resolveUrlTracked(url)
      logger().info(redirectResult.redirectChain, 'Redirect chain')
      return redirectResult.redirectChain
    })
  )

  return resolvedUrls.flat()
}

export async function extractUrlsWithDirectMapping(text: string): Promise<Map<string, string>> {
  if (!text) return new Map()

  const startTime = performance.now()

  // Regular expression to match URLs
  const tcoUrlRegex = /https?:\/\/t\.co\/([A-Za-z0-9_-]{10})/gi

  const urls = Array.from(new Set(Array.from(text.matchAll(tcoUrlRegex)).map((match) => match[0])))

  // Create a map to store original URL to resolved URL mapping
  const urlMap = new Map<string, string>()

  // Resolve each URL
  await Promise.all(
    urls.map(async (url) => {
      const resolvedUrl = await resolveUrlDirect(url)
      urlMap.set(url, resolvedUrl)
    })
  )

  const endTime = performance.now()
  logger().info(
    `URL resolution completed in ${(endTime - startTime).toFixed(2)}ms for ${urls.length} unique URLs`
  )

  return urlMap
}
