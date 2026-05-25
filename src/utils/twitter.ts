import { logger } from './logger'

export function extractRetweetedUsername(text: string): string {
  const match = text.match(/^RT @([^:]+):/)
  if (!match) {
    logger().warn(`Could not extract retweeted username from text: ${text}`)
    return ''
  }
  return match[1]
}

export function extractQuotedUsername(url: string): string {
  const match = url.match(/(?:twitter|x)\.com\/([^\/]+)\/status\//)
  if (!match) {
    logger().warn(`Could not extract quoted username from URL: ${url}`)
    return ''
  }
  return match[1]
}

export function extractMentionedUsernames(text: string): string[] {
  // Match all occurrences of @username pattern
  const matches = text.match(/@([a-zA-Z0-9_]+)/g)

  if (!matches) {
    return []
  }

  // Remove the @ symbol and return usernames
  return matches.map((match) => match.slice(1))
}

// export function cleanTweetText(status: TwitterStatus): string {
//   let text = status.full_text

//   if (status.retweeted_status) {
//     // Remove "RT @username:" pattern from retweets
//     text = text.replace(/^RT @[^:]+: /, '')
//   } else if (status.in_reply_to_screen_name) {
//     // Remove the first @username from replies
//     text = text.replace(new RegExp(`^@${status.in_reply_to_screen_name}\\s+`), '')
//   }

//   return text
// }

// Check if it's a truncated tweet
export function getIsTruncated(text: string) {
  return (
    text.endsWith('…') || // Add Unicode ellipsis check
    text.includes('… https://t.co/')
  )
}
