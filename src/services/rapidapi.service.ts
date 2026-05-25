import { config } from '@/config'
import { LookupStatus, LookupUser } from '@/services/twitter'
import { loggedFetch } from '@/utils/loggedFetch'
import { logger } from '@/utils/logger'
import { extractQuotedUsername, getIsTruncated } from '@/utils/twitter'
interface TweetUrl {
  display_url: string // eg. "time.fun"
  expanded_url: string // eg. "http://time.fun"
  indices: number[] // eg. [0, 23]
  url: string // eg. "https://t.co/hLL3K58de4"
}

interface TweetUserMention {
  id_str: string
  indices: number[]
  name: string
  screen_name: string
}

export interface TweetDetailV3User {
  __typename: string
  rest_id: string
  core: {
    created_at: string
    name: string
    screen_name: string
  }
  avatar: {
    image_url: string
  }
  banner: {
    image_url: string
  }
  location: {
    location: string
  }
  profile_bio: {
    description: string
    entities: {
      url?: {
        urls: {
          display_url: string
          expanded_url: string
          url: string
        }[]
      }
    }
  }
  relationship_counts: {
    followers: number
    following: number
  }
  tweet_counts: {
    tweets: number
    media_tweets: number
  }
  action_counts: {
    favorites_count: number
  }
  website: {
    url: string
  }
  legacy?: {
    profile_image_url_https?: string
    verified?: boolean
  }
  verification?: {
    is_blue_verified?: boolean
  }
  privacy?: {
    protected?: boolean
  }
}

export interface TweetDetailV3Media {
  display_url: string
  expanded_url: string
  id_str: string // needed in db
  indices: number[]
  media_key: string
  media_url_https: string // needed in db
  original_info: {
    focus_rects: {
      h: number
      w: number
      x: number
      y: number
    }[]
    height: number
    width: number
  }
  sizes: {
    // needed in db
    large: {
      h: number
      w: number
    }
  }
  type: string // video, photo, animated_gif // needed in db
  url: string
  video_info: {
    // needed in db
    aspect_ratio: number[]
    duration_millis: number
    variants: {
      bitrate?: number
      content_type: string
      url: string
    }[]
  }
}

export interface TweetDetailV3Legacy {
  bookmark_count: number
  created_at: string
  conversation_id_str: string
  display_text_range?: number[]
  entities: {
    hashtags?: {
      indices: number[]
      text: string
    }[]
    symbols?: {
      indices: number[]
      text: string
    }[]
    urls?: TweetUrl[]
    user_mentions?: TweetUserMention[]
  }
  extended_entities?: {
    media?: TweetDetailV3Media[]
  }
  favorite_count: number
  favorited?: boolean
  full_text: string
  is_quote_status: boolean
  in_reply_to_status_id_str?: string
  in_reply_to_screen_name?: string
  in_reply_to_user_id_str?: string
  lang: string
  possibly_sensitive?: boolean
  possibly_sensitive_editable?: boolean
  quote_count: number
  reply_count: number
  retweet_count: number
  retweeted?: boolean
  user_id_str: string
  id_str: string
  quoted_status_id_str?: string
  quoted_status_permalink?: {
    display: string
    expanded: string
    url: string
  }
  retweeted_status_results?: {
    result: TweetDetailV3Tweet
  }
}

export interface TweetDetailV3NoteTweet {
  note_tweet_results: {
    rest_id: string
    result: {
      __typename: string
      rest_id: string
      text: string
      // needed in db
      entity_set?: {
        hashtags?: {
          indices: number[]
          text: string
        }[]
        symbols?: {
          indices: number[]
          text: string
        }[]
        urls?: TweetUrl[]
        user_mentions?: TweetUserMention[]
      }
      media?: {
        // needed in db
        inline_media?: {
          index: number
          media_id: string
        }[]
      }
      richtext?: {
        // needed in db
        richtext_tags: {
          from_index: number
          to_index: number
          richtext_types: string[]
        }[]
      }
    }
  }
  is_expandable?: boolean
}

export interface TweetDetailV3Tweet {
  __typename: string
  rest_id: string
  core: {
    user_results: {
      result: TweetDetailV3User
    }
  }
  unmention_data?: any
  edit_control?: any
  legacy?: TweetDetailV3Legacy
  note_tweet?: TweetDetailV3NoteTweet
  quoted_tweet_results?: {
    result: TweetDetailV3Tweet
  }
  retweeted_status_results?: {
    rest_id: string
    result: TweetDetailV3Tweet
  }
  view_count_info?: {
    count: string
    state: string
  }
  reply_to_user_results?: {
    rest_id: string
    result: {
      __typename: string
      rest_id: string
      core: {
        screen_name: string
      }
    }
  }
}

export interface TweetWithVisibilityResults {
  __typename: 'TweetWithVisibilityResults'
  tweet: TweetDetailV3Tweet
}

export interface TweetDetailV3ApiResponse {
  data: {
    tweet_results?: {
      result: TweetDetailV3Tweet | TweetWithVisibilityResults
    }
  }
}

export type SimpleTwitterUserFromDB = {
  id: string
  name: string
  screenName: string
  description: string
  followersCount: number

  location: string
  friendsCount: number
  createdAt: Date
  favouritesCount: number
  verified: boolean
  statusesCount: number
  mediaCount: number
  profileImageUrlHttps: string
  profileBannerUrl: string
  lastTweetId: string
  updatedAt: Date
  website: string
  foundAt?: Date | null
  deletedAt: Date | null
  protectedAt: Date | null
  status?: null
}

export type FullTwitterStatus = LookupStatus & {
  bookmarkCount?: number
  viewCount?: number
  quoteCount?: number
  replyCount?: number
  conversationId?: string | null
  fullText?: string
  notetweetEntities?: {
    hashtags?: {
      indices: number[]
      text: string
    }[]
    symbols?: {
      indices: number[]
      text: string
    }[]
    urls?: {
      display_url: string
      expanded_url: string
      indices: number[]
      url: string
    }[]
    user_mentions?: {
      id_str: string
      indices: number[]
      name: string
      screen_name: string
    }[]
    inline_media?: {
      index: number
      media_id: string
    }[]
    richtext_tags?: {
      from_index: number
      to_index: number
      richtext_types: string[]
    }[]
  }
  user?: SimpleTwitterUserFromDB
  replyToStatus?: FullTwitterStatus
  quotedStatus?: FullTwitterStatus
  mentionedUsers?: SimpleTwitterUserFromDB[]
}

// Type guard to check if the result is TweetWithVisibilityResults
function isTweetWithVisibilityResults(result: { __typename?: string; tweet?: any }) {
  return result.tweet && result.tweet.rest_id
}

// Type guard to check if the result is TweetPreviewDisplay
function isTweetPreviewDisplay(result: {
  __typename?: string
  tweet?: any
}): result is TweetPreviewDisplay {
  return result.__typename === 'TweetPreviewDisplay' && !!result.tweet
}

interface TweetDetailByIds283UserLegacy {
  created_at: string
  screen_name: string
  name: string
  description: string
  entities: {
    url?: {
      urls: {
        url: string
        expanded_url: string
        display_url: string
        indices: number[]
      }[]
    }
    description: {
      urls: any[]
    }
  }
  favourites_count: number
  followers_count: number
  friends_count: number
  listed_count: number
  statuses_count: number
  media_count: number

  location: string

  pinned_tweet_ids_str: string[]
  profile_image_url_https: string
  profile_banner_url?: string
}

// Extract the user result type for reuse
export interface TweetDetailByIds283UserResult {
  __typename: string
  rest_id: string
  is_blue_verified: boolean
  legacy: TweetDetailByIds283UserLegacy
}

interface TweetDetailByIds283Tweet {
  __typename?: string
  rest_id: string
  core: {
    user_results: {
      result: TweetDetailByIds283UserResult
    }
  }
  views: {
    count: string
    state: string
  }
  quoted_status_result?: {
    result: TweetDetailByIds283Tweet | TweetDetailByIds283VisibilityTweet | TweetPreviewDisplay
  }
  legacy: Omit<TweetDetailV3Legacy, 'retweeted_status_results'> & {
    retweeted_status_result?: {
      result: TweetDetailByIds283Tweet | TweetDetailByIds283VisibilityTweet
    }
  }
  note_tweet?: TweetDetailV3NoteTweet
}

interface TweetDetailByIds283VisibilityTweet {
  __typename: 'TweetWithVisibilityResults'
  tweet: TweetDetailByIds283Tweet
}

interface TweetPreviewDisplay {
  __typename: 'TweetPreviewDisplay'
  tweet: {
    rest_id: string
    text: string
    core: {
      user_results: {
        result: TweetDetailByIds283UserResult
      }
    }
    entities: any
    reply_count: number
    retweet_count: number
    favorite_count: number
    bookmark_count: number
    quote_count: number
    view_count: {
      count: string
    }
    created_at: string
  }
  limited_action_results?: {
    limited_actions: Array<{
      action: string
    }>
  }
  cta?: {
    title: string
    url: {
      url: string
      urlType: string
    }
  }
}

export interface TweetDetailByIds283Response {
  data: {
    tweetResult: {
      result?: TweetDetailByIds283Tweet | TweetDetailByIds283VisibilityTweet
    }[]
  }
}

// Transform user_results.result to SimpleTwitterUserFromDB
export function transformTweetDetailByIds283UserToSimpleUser(
  user: TweetDetailByIds283UserResult
): SimpleTwitterUserFromDB {
  return {
    id: user.rest_id,
    name: user.legacy.name,
    screenName: user.legacy.screen_name,
    location: user.legacy.location,
    description: user.legacy.description,
    website: user.legacy.entities.url?.urls[0]?.expanded_url || '',
    followersCount: user.legacy.followers_count,
    friendsCount: user.legacy.friends_count,
    createdAt: new Date(user.legacy.created_at),
    favouritesCount: user.legacy.favourites_count,
    verified: user.is_blue_verified,
    statusesCount: user.legacy.statuses_count,
    mediaCount: user.legacy.media_count || 0,
    profileImageUrlHttps: user.legacy.profile_image_url_https,
    profileBannerUrl: user.legacy.profile_banner_url || '',
    lastTweetId: '',
    updatedAt: new Date(),
    deletedAt: null,
    protectedAt: null,
    status: null
  }
}

// // Transform AIO API user to SimpleTwitterUserFromDB
// export function transformTweetDetailAIOUserToSimpleUser(
//   user: TweetDetailAIOUser
// ): SimpleTwitterUserFromDB {
//   return {
//     id: user.rest_id,
//     name: user.legacy?.name || '',
//     screenName: user.legacy?.screen_name || '',
//     location: user.legacy?.location || '',
//     description: user.legacy?.description || '',
//     website: user.legacy?.entities?.url?.urls?.[0]?.expanded_url || '',
//     followersCount: user.legacy?.followers_count || 0,
//     friendsCount: user.legacy?.friends_count || 0,
//     createdAt: new Date(user.legacy?.created_at || Date.now()),
//     favouritesCount: user.legacy?.favourites_count || 0,
//     verified: user.is_blue_verified || false,
//     statusesCount: user.legacy?.statuses_count || 0,
//     mediaCount: 0, // AIO API doesn't provide media_count
//     profileImageUrlHttps: user.legacy?.profile_image_url_https || '',
//     profileBannerUrl: user.legacy?.profile_banner_url || '',
//     lastTweetId: '',
//     updatedAt: new Date(),
//     deletedAt: null,
//     protectedAt: null,
//     status: null
//   }
// }

// Transform V3 API user to SimpleTwitterUserFromDB
export function transformTweetDetailV3UserToSimpleUser(
  user: TweetDetailV3User
): SimpleTwitterUserFromDB {
  return {
    id: user.rest_id,
    name: user.core.name,
    screenName: user.core.screen_name,
    location: user.location?.location || '',
    description: user.profile_bio?.description || '',
    website: user.profile_bio?.entities?.url?.urls?.[0]?.expanded_url || '',
    followersCount: user.relationship_counts?.followers || 0,
    friendsCount: user.relationship_counts?.following || 0,
    createdAt: new Date(user.core.created_at),
    favouritesCount: user.action_counts?.favorites_count || 0,
    verified: user.verification?.is_blue_verified || false,
    statusesCount: user.tweet_counts?.tweets || 0,
    mediaCount: user.tweet_counts?.media_tweets || 0,
    profileImageUrlHttps: user.avatar?.image_url || '',
    profileBannerUrl: user.banner?.image_url || '',
    lastTweetId: '',
    updatedAt: new Date(),
    deletedAt: null,
    protectedAt: null,
    status: null
  }
}

export function parseTweetDetailByIds283ToTweetStatus(
  tweet: TweetDetailByIds283Tweet
): FullTwitterStatus {
  if (!tweet) {
    const error = new Error('Tweet is null or undefined')
    ;(error as any).tweet = tweet
    throw error
  }

  if (!tweet.legacy) {
    const tweetId = tweet.rest_id || 'unknown'
    const error = new Error(`Tweet legacy data is missing (tweetId: ${tweetId})`)
    ;(error as any).tweet = tweet
    ;(error as any).tweetId = tweetId
    throw error
  }

  const legacy = tweet.legacy
  const user = tweet.core?.user_results?.result

  // Create the basic user info if user exists
  let tweetUser: SimpleTwitterUserFromDB | undefined
  if (user && user.rest_id) {
    try {
      tweetUser = transformTweetDetailByIds283UserToSimpleUser(user)
    } catch (error) {
      logger().warn(
        { error, user, tweetId: tweet.rest_id },
        'Failed to transform user in parseTweetDetailByIds283ToTweetStatus'
      )
      tweetUser = undefined
    }
  }

  // Create the base FullTwitterStatus object
  let fullStatus: FullTwitterStatus = {
    // LookupStatus required fields
    id: tweet.rest_id,
    userId: legacy.user_id_str,
    text: legacy.full_text,
    truncated: getIsTruncated(legacy.full_text),
    entities: {
      hashtags: legacy.entities.hashtags || [],
      symbols: legacy.entities.symbols || [],
      urls: legacy.entities.urls || [],
      user_mentions: legacy.entities.user_mentions || []
    },
    medias:
      legacy.extended_entities?.media?.map((item) => ({
        id_str: item.id_str,
        type: item.type,
        media_url_https: item.media_url_https,
        url: item.url,
        sizes: {
          large: item.sizes.large
        },
        video_info: item.video_info
      })) || null,
    inReplyToStatusIdStr: legacy.in_reply_to_status_id_str || null,
    inReplyToUserIdStr: legacy.in_reply_to_user_id_str || null,
    inReplyToUserScreenName: legacy.in_reply_to_screen_name || null,
    quotedStatusIdStr: legacy.quoted_status_id_str || null,
    quotedUserIdStr: null,
    quotedUserScreenName: legacy.quoted_status_permalink
      ? extractQuotedUsername(legacy.quoted_status_permalink.expanded)
      : null,
    retweetedStatusIdStr: legacy.retweeted_status_result?.result
      ? isTweetWithVisibilityResults(legacy.retweeted_status_result.result)
        ? (legacy.retweeted_status_result.result as TweetDetailByIds283VisibilityTweet).tweet
            .rest_id
        : (legacy.retweeted_status_result.result as TweetDetailByIds283Tweet).rest_id
      : null,
    retweetedUserIdStr: legacy.retweeted_status_result?.result
      ? isTweetWithVisibilityResults(legacy.retweeted_status_result.result)
        ? (legacy.retweeted_status_result.result as TweetDetailByIds283VisibilityTweet).tweet.core
            .user_results.result.rest_id
        : (legacy.retweeted_status_result.result as TweetDetailByIds283Tweet).core.user_results
            .result.rest_id
      : null,
    retweetedUserScreenName: legacy.retweeted_status_result?.result
      ? isTweetWithVisibilityResults(legacy.retweeted_status_result.result)
        ? (legacy.retweeted_status_result.result as TweetDetailByIds283VisibilityTweet).tweet.core
            .user_results.result.legacy.screen_name
        : (legacy.retweeted_status_result.result as TweetDetailByIds283Tweet).core.user_results
            .result.legacy.screen_name
      : null,
    retweetedStatusCreatedAt: legacy.retweeted_status_result?.result
      ? isTweetWithVisibilityResults(legacy.retweeted_status_result.result)
        ? new Date(
            (
              legacy.retweeted_status_result.result as TweetDetailByIds283VisibilityTweet
            ).tweet.core.user_results.result.legacy.created_at
          )
        : new Date(
            (
              legacy.retweeted_status_result.result as TweetDetailByIds283Tweet
            ).core.user_results.result.legacy.created_at
          )
      : null,
    favoriteCount: legacy.favorite_count,
    retweetCount: legacy.retweet_count,
    createdAt: new Date(legacy.created_at),
    updatedAt: new Date(),

    // Additional fields
    bookmarkCount: legacy.bookmark_count || 0,
    viewCount: parseInt(tweet.views?.count || '0', 10),
    quoteCount: legacy.quote_count || 0,
    replyCount: legacy.reply_count || 0,
    conversationId: legacy.conversation_id_str || null,
    fullText: tweet.note_tweet ? tweet.note_tweet.note_tweet_results.result?.text : undefined,
    user: tweetUser,
    notetweetEntities: tweet.note_tweet
      ? {
          hashtags: tweet.note_tweet.note_tweet_results.result?.entity_set?.hashtags || [],
          symbols: tweet.note_tweet.note_tweet_results.result?.entity_set?.symbols || [],
          urls: tweet.note_tweet.note_tweet_results.result?.entity_set?.urls || [],
          user_mentions:
            tweet.note_tweet.note_tweet_results.result?.entity_set?.user_mentions || [],
          inline_media: tweet.note_tweet.note_tweet_results.result?.media?.inline_media || [],
          richtext_tags: tweet.note_tweet.note_tweet_results.result?.richtext?.richtext_tags || []
        }
      : undefined
  }

  // Add quoted status if exists
  if (tweet.quoted_status_result?.result) {
    try {
      const quotedTweetResult = tweet.quoted_status_result.result

      // Skip TweetPreviewDisplay - it doesn't have legacy data structure
      if (isTweetPreviewDisplay(quotedTweetResult)) {
        logger().warn(
          {
            tweetId: tweet.rest_id,
            quotedTweetId: quotedTweetResult.tweet.rest_id,
            quotedTweetType: 'TweetPreviewDisplay'
          },
          'Skipping quoted status - TweetPreviewDisplay does not have legacy data structure'
        )
      } else {
        // Recursively parse the quoted status and narrow to TweetDetailByIds283Tweet
        const quotedTweet: TweetDetailByIds283Tweet = isTweetWithVisibilityResults(
          quotedTweetResult
        )
          ? (quotedTweetResult as TweetDetailByIds283VisibilityTweet).tweet
          : (quotedTweetResult as TweetDetailByIds283Tweet)

        // Skip if quoted tweet is unavailable or tombstone
        if (
          quotedTweet &&
          typeof quotedTweet === 'object' &&
          '__typename' in quotedTweet &&
          (quotedTweet.__typename === 'TweetUnavailable' ||
            quotedTweet.__typename === 'TweetTombstone')
        ) {
          logger().warn(
            {
              tweetId: tweet.rest_id,
              quotedTweetType: quotedTweet.__typename
            },
            'Skipping quoted status - tweet is unavailable or tombstone'
          )
        } else {
          // Recursively parse the quoted status
          fullStatus.quotedStatus = parseTweetDetailByIds283ToTweetStatus(quotedTweet)
        }
      }
    } catch (error) {
      ;(error as any).tweet = tweet

      logger().error(error, 'Failed to parse quoted status')
    }
  }

  // Add retweeted status if exists
  if (legacy.retweeted_status_result?.result) {
    try {
      const retweetedTweet = legacy.retweeted_status_result.result

      // Recursively parse the retweeted status
      if (isTweetWithVisibilityResults(retweetedTweet)) {
        fullStatus = {
          ...parseTweetDetailByIds283ToTweetStatus(
            (retweetedTweet as TweetDetailByIds283VisibilityTweet).tweet
          ),
          id: fullStatus.id,
          userId: fullStatus.userId,
          retweetedStatusIdStr: fullStatus.retweetedStatusIdStr,
          retweetedUserIdStr: fullStatus.retweetedUserIdStr,
          retweetedUserScreenName: fullStatus.retweetedUserScreenName,
          retweetedStatusCreatedAt: fullStatus.retweetedStatusCreatedAt,
          createdAt: fullStatus.createdAt
        }
      } else {
        fullStatus = {
          ...parseTweetDetailByIds283ToTweetStatus(retweetedTweet as TweetDetailByIds283Tweet),
          id: fullStatus.id,
          userId: fullStatus.userId,
          retweetedStatusIdStr: fullStatus.retweetedStatusIdStr,
          retweetedUserIdStr: fullStatus.retweetedUserIdStr,
          retweetedUserScreenName: fullStatus.retweetedUserScreenName,
          retweetedStatusCreatedAt: fullStatus.retweetedStatusCreatedAt,
          createdAt: fullStatus.createdAt
        }
      }
    } catch (error) {
      ;(error as any).tweet = tweet
      logger().error(error, 'Failed to parse retweeted status')
    }
  }

  return fullStatus
}

export async function fetchTweetDetailByIds283(tweetIds: string[]): Promise<FullTwitterStatus[]> {
  const response: TweetDetailByIds283Response = await loggedFetch(
    `https://twitter283.p.rapidapi.com/TweetResultsByRestIds?tweet_ids=${tweetIds.join(',')}`,
    {
      headers: {
        'x-rapidapi-host': 'twitter283.p.rapidapi.com',
        'x-rapidapi-key': config.rapidApiKey
      },
      maxRetries: 2
    }
  )

  const tweet_results = response.data.tweetResult
    .map((tweetItem, index) => {
      if (!tweetItem.result) {
        return null
      }

      const tweet = isTweetWithVisibilityResults(tweetItem.result)
        ? (tweetItem.result as TweetDetailByIds283VisibilityTweet).tweet
        : (tweetItem.result as TweetDetailByIds283Tweet)

      if (tweet.__typename !== 'TweetUnavailable') {
        try {
          return parseTweetDetailByIds283ToTweetStatus(tweet)
        } catch (error) {
          // Get tweetId from array index or from tweet.rest_id
          const tweetId = tweetIds[index] || tweet.rest_id || 'unknown'

          // Enhance error with tweetId and index information
          const enhancedError = error as Error & {
            tweetId?: string
            index?: number
            tweet?: any
            endpoint?: string
          }
          enhancedError.tweetId = tweetId
          enhancedError.index = index
          enhancedError.endpoint = '283'
          if (!enhancedError.tweet) {
            enhancedError.tweet = tweet
          }

          // Ensure error message exists (metadata is in object properties)
          if (!enhancedError.message) {
            enhancedError.message = 'Failed to parse tweet'
          }

          // if (tweetItem.result.__typename !== 'TweetTombstone') {
          //   logger().error(
          //     { tweetId, index, tweetItem, error: enhancedError.message },
          //     'Failed to parse tweet from 283 endpoint'
          //   )
          // }
          throw enhancedError
        }
      } else {
        return null
      }
    })
    .filter(Boolean) as FullTwitterStatus[]

  return tweet_results
}

export interface TweetDetailByIds241Response {
  result: {
    tweetResult: {
      result?: TweetDetailByIds283Tweet | TweetDetailByIds283VisibilityTweet
    }[]
  }
}

export async function fetchTweetDetailByIds241(tweetIds: string[]): Promise<FullTwitterStatus[]> {
  const response: TweetDetailByIds241Response = await loggedFetch(
    `https://twitter241.p.rapidapi.com/tweet-by-ids?tweetIds=${tweetIds.join(',')}`,
    {
      headers: {
        'x-rapidapi-host': 'twitter241.p.rapidapi.com',
        'x-rapidapi-key': config.rapidApiKey
      },
      maxRetries: 2
    }
  )

  const tweet_results = response.result.tweetResult
    .map((tweetItem, index) => {
      if (!tweetItem.result) {
        return null
      }

      const tweet = isTweetWithVisibilityResults(tweetItem.result)
        ? (tweetItem.result as TweetDetailByIds283VisibilityTweet).tweet
        : (tweetItem.result as TweetDetailByIds283Tweet)

      if (tweet.__typename !== 'TweetUnavailable') {
        try {
          return parseTweetDetailByIds283ToTweetStatus(tweet)
        } catch (error) {
          // Get tweetId from array index or from tweet.rest_id
          const tweetId = tweetIds[index] || tweet.rest_id || 'unknown'

          // Enhance error with tweetId and index information
          const enhancedError = error as Error & {
            tweetId?: string
            index?: number
            tweet?: any
            endpoint?: string
          }
          enhancedError.tweetId = tweetId
          enhancedError.index = index
          enhancedError.endpoint = '241'
          if (!enhancedError.tweet) {
            enhancedError.tweet = tweet
          }

          // Ensure error message exists (metadata is in object properties)
          if (!enhancedError.message) {
            enhancedError.message = 'Failed to parse tweet'
          }

          throw enhancedError
        }
      } else {
        return null
      }
    })
    .filter(Boolean) as FullTwitterStatus[]

  return tweet_results
}

export async function fetchFullTweetByIds(tweetIds: string[]): Promise<FullTwitterStatus[]> {
  if (tweetIds.length === 0) {
    return []
  }

  try {
    return await fetchTweetDetailByIds283(tweetIds)
  } catch (error) {
    logger().warn(
      error,
      'fetchTweetDetailByIds283 failed, falling back to fetchTweetDetailByIds241'
    )
    try {
      return await fetchTweetDetailByIds241(tweetIds)
    } catch (fallbackError) {
      logger().error(
        fallbackError,
        'fetchTweetDetailByIds241 also failed after fetchTweetDetailByIds283 failed'
      )
      throw fallbackError
    }
  }
}

// Interface for the UserResultsByRestIds response
interface UserResultsByRestIds283User {
  __typename: string
  rest_id: string
  action_counts: {
    favorites_count: number
  }
  avatar: {
    image_url: string
  }
  banner?: {
    image_url: string
  }
  core: {
    created_at: string
    name: string
    screen_name: string
  }
  location?: {
    location: string
  }
  profile_bio?: {
    description: string
    entities?: {
      url?: {
        urls: {
          display_url: string
          expanded_url: string
          url: string
        }[]
      }
    }
  }
  relationship_counts: {
    followers: number
    following: number
  }
  tweet_counts: {
    tweets: number
    media_tweets: number
  }
  website?: {
    url: string
  }
  verification?: {
    is_blue_verified?: boolean
    verified_type?: string
  }
  pinned_items?: {
    tweet_ids_str: string[]
  }
  privacy?: {
    protected?: boolean
  }
}

interface UserResultsByRestIds283Response {
  data: {
    users: {
      rest_id: string
      result: UserResultsByRestIds283User
    }[]
  }
}

// Transform the UserResultsByRestIds response to LookupUser format
function transformUserResultsByRestIds283ToLookupUser(
  user: UserResultsByRestIds283User
): LookupUser {
  const now = new Date()

  return {
    id: user.rest_id,
    name: user.core.name,
    screenName: user.core.screen_name,
    location: user.location?.location || '',
    description: user.profile_bio?.description || '',
    website: user.profile_bio?.entities?.url?.urls[0]?.expanded_url || user.website?.url || '',
    friendsCount: user.relationship_counts?.following || 0,
    profileImageUrlHttps: user.avatar?.image_url || '',
    profileBannerUrl: user.banner?.image_url || '',
    lastTweetId: '',
    followersCount: user.relationship_counts?.followers || 0,
    createdAt: new Date(user.core.created_at),
    favouritesCount: user.action_counts?.favorites_count || 0,
    verified: user.verification?.is_blue_verified || false,
    statusesCount: user.tweet_counts?.tweets || 0,
    updatedAt: now,
    deletedAt: null,
    protectedAt: user.privacy?.protected ? now : null, // This endpoint doesn't provide protected status info
    status: null // This endpoint doesn't provide status info by default
  }
}

// limit 358 in 1 batch
// Fetch users by IDs using the UserResultsByRestIds endpoint
export async function fetchUsersByIds283(userIds: string[]): Promise<LookupUser[]> {
  if (userIds.length === 0) {
    return []
  }

  const MAX_RETRIES = 2

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response: UserResultsByRestIds283Response = await loggedFetch(
      `https://twitter283.p.rapidapi.com/UserResultsByRestIds?user_ids=${userIds.map((id) => id.trim()).join(',')}`,
      {
        headers: {
          'x-rapidapi-host': 'twitter283.p.rapidapi.com',
          'x-rapidapi-key': config.rapidApiKey
        },
        maxRetries: 2
      }
    )

    if (!response.data?.users) {
      logger().error(response, 'Invalid response structure from UserResultsByRestIds')
      throw new Error('Invalid response structure from UserResultsByRestIds')
    }

    const validUsers = response.data.users.filter(
      (userItem) => userItem.result && userItem.result.__typename === 'User'
    )

    // Check if any user has no core field before processing
    const usersWithMissingCore = validUsers.filter((userItem) => !userItem.result.core)

    if (usersWithMissingCore.length > 0) {
      const missingCoreIds = usersWithMissingCore.map((userItem) => userItem.result.rest_id)
      const errorMsg = `Found ${usersWithMissingCore.length} users with missing core data: ${missingCoreIds.join(', ')}`
      logger().warn(errorMsg)

      if (attempt < MAX_RETRIES) {
        logger().info(
          `Retrying request (attempt ${attempt + 1}/${MAX_RETRIES}) due to missing core data`
        )
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)) // Progressive delay
        continue
      } else {
        // On final attempt, log the users without core data and throw
        logger().error(
          usersWithMissingCore.map((u) => u.result),
          `Max retries reached. Users without core data: ${missingCoreIds.join(', ')}`
        )
        throw new Error(
          `After ${MAX_RETRIES} attempts, still found ${usersWithMissingCore.length} users with missing core data: ${missingCoreIds.join(', ')}`
        )
      }
    }

    // If we get here, all users have valid core data
    try {
      return validUsers.map((userItem) =>
        transformUserResultsByRestIds283ToLookupUser(userItem.result)
      )
    } catch (error) {
      logger().error(
        {
          error,
          response,
          validUsers,
          userIds
        },
        'Failed to transform users from UserResultsByRestIds'
      )
      throw error
    }
  }

  // This should never be reached due to the logic above, but TypeScript needs it
  throw new Error('Unexpected end of retry loop')
}

export interface TwitterStatusMedia {
  id_str: string
  type: string
  media_url_https: string
  url: string
  sizes: {
    large: {
      h: number
      w: number
    }
  }
  video_info?: {
    aspect_ratio: number[]
    duration_millis: number
    variants: {
      bitrate?: number
      content_type: string
      url: string
    }[]
  }
}

interface TweetUserMention {
  id_str: string
  indices: number[]
  name: string
  screen_name: string
}

export interface TwitterStatusEntities {
  hashtags: {
    indices: number[]
    text: string
  }[]
  symbols: {
    indices: number[]
    text: string
  }[]
  urls: TweetUrl[]
  user_mentions: TweetUserMention[]
}

export interface TwitterStatus {
  created_at: string
  id: number
  id_str: string
  full_text: string
  truncated: boolean
  display_text_range: number[]
  entities: TwitterStatusEntities
  extended_entities?: {
    media: TwitterStatusMedia[]
  }
  source: string
  in_reply_to_status_id: number | null
  in_reply_to_status_id_str: string | null
  in_reply_to_user_id: number | null
  in_reply_to_user_id_str: string | null
  in_reply_to_screen_name: string | null
  geo: null
  coordinates: null
  place: null
  contributors: null
  is_quote_status: boolean
  quoted_status_id?: number
  quoted_status_id_str?: string
  quoted_status_permalink?: {
    url: string
    expanded: string
    display: string
  }
  retweet_count: number
  favorite_count: number
  favorited: boolean
  retweeted: boolean
  lang: string
  possibly_sensitive?: boolean
  retweeted_status?: TwitterStatus
}

export interface TimelineStatus extends TwitterStatus {
  quoted_status?: TimelineStatus
  retweeted_status?: TimelineStatus
  user?: Omit<XTwitterUser, 'status'>
}

interface TwitterEntities {
  url?: {
    urls: {
      url: string
      expanded_url: string
      display_url: string
      indices: number[]
    }[]
  }
  description: {
    urls: any[]
  }
}

export interface XTwitterUser {
  id: number
  id_str: string
  name: string
  screen_name: string
  location: string
  description: string
  url: string | null
  entities: TwitterEntities
  protected: boolean
  followers_count: number
  friends_count: number
  listed_count: number
  created_at: string
  favourites_count: number
  utc_offset: null
  time_zone: null
  geo_enabled: boolean
  verified: boolean
  statuses_count: number
  lang: null
  status?: TwitterStatus | null
  contributors_enabled: boolean
  is_translator: boolean
  is_translation_enabled: boolean
  profile_background_color: string
  profile_background_image_url: string
  profile_background_image_url_https: string
  profile_background_tile: boolean
  profile_image_url: string
  profile_image_url_https: string
  profile_banner_url?: string
  profile_link_color: string
  profile_sidebar_border_color: string
  profile_sidebar_fill_color: string
  profile_text_color: string
  profile_use_background_image: boolean
  has_extended_profile: boolean
  default_profile: boolean
  default_profile_image: boolean
  following: boolean
  follow_request_sent: boolean
  notifications: boolean
  translator_type: string
  withheld_in_countries: string[]
}

// Batch fetch users by IDs with similar structure to batchFetchUserLookup
export async function batchFetchUsersByIds(userIds: string[]): Promise<LookupUser[]> {
  const BATCH_SIZE = 300

  // Create batches for userIds
  const userIdBatches = []
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE)
    userIdBatches.push(batch)
  }

  // Create promises for all batches
  const fetchPromises = userIdBatches.map((batch) => fetchUsersByIds283(batch))

  // Execute all promises in parallel and wait for all to complete
  const results = await Promise.all(fetchPromises)

  // Flatten and filter results
  const users: LookupUser[] = []
  for (const result of results) {
    if (result && Array.isArray(result)) {
      users.push(...result)
    }
  }

  return users
}

// Interface for the UserResultByScreenName response
interface UserResultByScreenName283Response {
  data: {
    user_results: {
      rest_id: string
      result: UserResultsByRestIds283User
    }
  }
}

// Fetch user by username using the UserResultByScreenName endpoint
export async function fetchUserByUsername283(username: string): Promise<LookupUser | null> {
  const response: UserResultByScreenName283Response = await loggedFetch(
    `https://twitter283.p.rapidapi.com/UserResultByScreenName?username=${username}`,
    {
      headers: {
        'x-rapidapi-host': 'twitter283.p.rapidapi.com',
        'x-rapidapi-key': config.rapidApiKey
      },
      maxRetries: 1
    }
  )

  if (!response.data?.user_results?.result) {
    logger().error(
      response,
      `Invalid response structure from UserResultByScreenName for username: ${username}`
    )
    return null
  }

  const user = response.data.user_results.result
  if (user.__typename !== 'User') {
    logger().warn(response, `User ${username} is not available (${user.__typename})`)
    return null
  }

  return transformUserResultsByRestIds283ToLookupUser(user)
}

// Batch fetch users by usernames with parallel execution
export async function batchFetchUsersByUsernames283(usernames: string[]): Promise<LookupUser[]> {
  if (usernames.length === 0) {
    return []
  }

  // Create promises for all usernames (fetch in parallel)
  const fetchPromises = usernames.map((username) => fetchUserByUsername283(username))

  // Execute all promises in parallel and wait for all to complete
  const results = await Promise.all(fetchPromises)

  // Filter out null results and return valid users
  return results.filter((user): user is LookupUser => user !== null)
}

// Interface for UserTweetsReplies response
export interface TimelineClientEventInfo {
  component: string
  details: {
    timelines_details: {
      controller_data: string
      injection_type: string
    }
  }
  element?: string
}

export interface TimelineConversationMetadata {
  all_tweet_ids: string[]
  enable_deduplication: boolean
}

export interface TimelineModuleItem {
  dispensable: boolean
  entry_id: string
  item: {
    client_event_info: TimelineClientEventInfo
    content: {
      __typename: 'TimelineTweet'
      timeline_tweet_display_type: string
      tweet_results: {
        rest_id: string
        result: TweetDetailV3Tweet
      }
    }
  }
}

export interface TimelineModuleItemAIO {
  dispensable: boolean
  entryId: string
  item: {
    itemContent: {
      __typename: 'TimelineTweet'
      itemType: string
      tweet_results: {
        result: TweetDetailByIds283Tweet
      }
    }
  }
}

export interface TimelineTimelineModule {
  __typename: 'TimelineTimelineModule'
  client_event_info: TimelineClientEventInfo
  display_type: string
  items: TimelineModuleItem[]
  metadata?: {
    conversation_metadata: TimelineConversationMetadata
  }
}

export interface TimelineTimelineModuleAIO {
  __typename: 'TimelineTimelineModule'
  displayType?: string
  items: TimelineModuleItemAIO[]
  metadata?: {
    conversationMetadata: {
      allTweetIds: string[]
      enableDeduplication: boolean
    }
  }
  clientEventInfo?: {
    component: string
    element?: string
    details?: {
      timelinesDetails: {
        injectionType: string
        controllerData: string
      }
    }
  }
}

export interface TweetDetailByIds283TweetWithVisibilityResults {
  __typename: 'TweetWithVisibilityResults'
  tweet: TweetDetailByIds283Tweet
}

export interface TimelineTimelineItem {
  __typename: 'TimelineTimelineItem'
  client_event_info: TimelineClientEventInfo
  content: {
    __typename: 'TimelineTweet'
    timeline_tweet_display_type: string
    tweet_results: {
      rest_id: string
      result: TweetDetailV3Tweet | TweetWithVisibilityResults
    }
  }
}

export interface TimelineTimelineCursor {
  __typename: 'TimelineTimelineCursor'
  cursor_type: 'Top' | 'Bottom'
  value: string
  cursor_info?: {
    autoload_on_min_distance_below_timeline_viewport: number
  }
}

export type TimelineEntryContent =
  | TimelineTimelineModule
  | TimelineTimelineItem
  | TimelineTimelineCursor

export interface TimelineEntry {
  content: TimelineEntryContent
  entry_id: string
  sort_index: string
}

export interface TimelineInstruction {
  __typename: 'TimelineClearCache' | 'TimelineAddEntries' | 'TimelinePinEntry'
  entries?: TimelineEntry[]
  entry?: TimelineEntry
}

export interface UserTweetsRepliesResponse {
  data: {
    user_result_by_rest_id: {
      rest_id: string
      result: {
        __typename: string
        rest_id: string
        profile_with_replies_timeline_v2: {
          id: string
          timeline: {
            id: string
            instructions: TimelineInstruction[]
            metadata?: {
              scribe_config: {
                page: string
              }
            }
          }
        }
      }
    }
  }
}

// AIO-specific types (Twitter AIO API has different structure)
export interface TimelineTimelineItemAIO {
  __typename: 'TimelineTimelineItem'
  entryType?: string
  itemContent: {
    __typename: 'TimelineTweet'
    itemType?: string
    tweet_results: {
      result: TweetDetailByIds283Tweet | TweetDetailByIds283TweetWithVisibilityResults
    }
  }
}

export interface TimelineTimelineCursorAIO {
  __typename: 'TimelineTimelineCursor'
  entryType?: string
  cursorType: 'Top' | 'Bottom'
  value: string
}

export type TimelineEntryContentAIO =
  | TimelineTimelineItemAIO
  | TimelineTimelineCursorAIO
  | TimelineTimelineModuleAIO

export interface TimelineEntryAIO {
  content: TimelineEntryContentAIO
  entryId: string
  sortIndex: string
}

export interface TimelineInstructionAIO {
  type: 'TimelineClearCache' | 'TimelineAddEntries' | 'TimelinePinEntry'
  entries?: TimelineEntryAIO[]
  entry?: TimelineEntryAIO
}

export interface UserTweetsRepliesAIOResponse {
  user: {
    result: {
      __typename: string
      timeline: {
        timeline: {
          instructions: TimelineInstructionAIO[]
          metadata?: {
            scribeConfig: {
              page: string
            }
          }
        }
      }
    }
  }
}

// Fetch user tweets and replies from Twitter283 (single page, raw response)
export async function fetchUserTweetsReplies(
  userId: string,
  cursor?: string
): Promise<UserTweetsRepliesResponse> {
  const url = cursor
    ? `https://twitter283.p.rapidapi.com/UserTweetsReplies?user_id=${userId}&cursor=${encodeURIComponent(cursor)}`
    : `https://twitter283.p.rapidapi.com/UserTweetsReplies?user_id=${userId}`

  const response: UserTweetsRepliesResponse = await loggedFetch(url, {
    headers: {
      'x-rapidapi-host': 'twitter283.p.rapidapi.com',
      'x-rapidapi-key': config.rapidApiKey
    },
    maxRetries: 3
  })

  return response
}

// Fetch user tweets and replies from Twitter AIO (single page, raw response)
export async function fetchUserTweetsRepliesAIO(
  userId: string,
  cursor?: string
): Promise<UserTweetsRepliesAIOResponse> {
  const url = cursor
    ? `https://twitter-aio.p.rapidapi.com/user/${userId}/tweetsAndReplies?cursor=${encodeURIComponent(cursor)}`
    : `https://twitter-aio.p.rapidapi.com/user/${userId}/tweetsAndReplies`

  const response: UserTweetsRepliesAIOResponse = await loggedFetch(url, {
    headers: {
      'x-rapidapi-host': 'twitter-aio.p.rapidapi.com',
      'x-rapidapi-key': config.rapidApiKey
    },
    maxRetries: 2
  })

  return response
}

// Fetch user tweets and replies from Twitter AIO (single page, transformed to FullTwitterStatus)
export async function fetchUserTweetsRepliesAIOTransformed(
  userId: string,
  cursor?: string
): Promise<FullTwitterStatus[]> {
  const response = await fetchUserTweetsRepliesAIO(userId, cursor)
  const extracted = extractTimelineStatusesFromUserTweetsRepliesAIO(response, userId)

  // Combine pinned and timeline tweets
  const allTweets = [...extracted.pinned, ...extracted.timeline]

  // Sort by createdAt from recent to old
  allTweets.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA // Descending order (newest first)
  })

  return allTweets
}

// Fetch user tweets and replies from Twitter283 (single page, transformed to FullTwitterStatus)
export async function fetchUserTweetsRepliesTransformed(
  userId: string,
  cursor?: string
): Promise<FullTwitterStatus[]> {
  const response = await fetchUserTweetsReplies(userId, cursor)
  const extracted = extractTimelineStatusesFromUserTweetsReplies(response, userId)

  // Combine pinned and timeline tweets
  const allTweets = [...extracted.pinned, ...extracted.timeline]

  // Sort by createdAt from recent to old
  allTweets.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA // Descending order (newest first)
  })

  return allTweets
}

// Advanced fetch user tweets and replies with pagination and timestamp range support
export async function fetchUserTweetsRepliesAdvanced(
  userId: string,
  options: {
    count?: number
    sinceTimestamp?: Date
    maxTimestamp?: Date
    account?: number
  } = {}
): Promise<FullTwitterStatus[]> {
  const { count, sinceTimestamp, maxTimestamp } = options

  // Use a Map to automatically deduplicate by tweet ID
  const tweetsMap = new Map<string, FullTwitterStatus>()
  let cursor: string | undefined
  let requestCount = 0
  const maxRequests = 500 // Safety limit to prevent infinite loops

  // Track if we've found tweets before sinceTimestamp
  let foundTweetsBeforeSince = false

  // Accumulate additional tweet IDs from conversation metadata
  const pendingAdditionalIds = new Set<string>()

  // Track consecutive empty timeline occurrences
  let emptyTimelineCount = 0
  let lastTweetTime: Date | undefined

  // Helper function to fetch and process additional tweet IDs
  const fetchAndProcessAdditionalIds = async (idsToFetch: string[]) => {
    if (idsToFetch.length === 0) {
      return
    }

    // Fetch in batches of 200
    const BATCH_SIZE = 200
    const batches: string[][] = []
    for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
      batches.push(idsToFetch.slice(i, i + BATCH_SIZE))
    }

    // Fetch all batches in parallel
    const fetchPromises = batches.map((batch) => fetchFullTweetByIds(batch))
    const results = await Promise.all(fetchPromises)

    // Process all fetched tweets
    for (const fetchedTweets of results) {
      for (const tweet of fetchedTweets) {
        // Only keep tweets made by the desired user
        if (tweet.userId === userId) {
          // Filter by timestamp if provided
          if (sinceTimestamp || maxTimestamp) {
            const tweetTime = new Date(tweet.createdAt)
            if (sinceTimestamp && tweetTime < sinceTimestamp) {
              continue
            }
            if (maxTimestamp && tweetTime > maxTimestamp) {
              continue
            }
          }
          // Add to map (automatically deduplicates by ID)
          tweetsMap.set(tweet.id, tweet)
        }
      }
    }
  }

  while (requestCount < maxRequests) {
    // Stop if we've reached the desired count
    if (count && tweetsMap.size >= count) {
      break
    }

    // Stop if we have sinceTimestamp and found tweets before it
    if (sinceTimestamp && foundTweetsBeforeSince) {
      break
    }

    // Fetch batch with fallback logic
    let extracted: ExtractedTimeline

    // Try Twitter283 first
    let response: any
    let aioResponse: any
    try {
      response = await fetchUserTweetsReplies(userId, cursor)

      extracted = extractTimelineStatusesFromUserTweetsReplies(response, userId)
    } catch (error) {
      logger().warn(
        {
          error,
          response: response,
          count,
          requestCount,
          maxRequests,
          tweetsMapSize: tweetsMap.size
        },
        `Twitter283 API failed, falling back to Twitter AIO`
      )
      // Try AIO fallback
      try {
        aioResponse = await fetchUserTweetsRepliesAIO(userId, cursor)
        extracted = extractTimelineStatusesFromUserTweetsRepliesAIO(aioResponse, userId)
      } catch (aioError) {
        logger().error(
          {
            error: aioError,
            response: aioResponse,
            count,
            requestCount,
            maxRequests,
            tweetsMapSize: tweetsMap.size
          },
          `Both Twitter283 and Twitter AIO APIs failed`
        )
        throw aioError
      }
    }

    // Combine pinned and timeline tweets
    const batch = [...extracted.pinned, ...extracted.timeline]

    // Track consecutive empty timeline occurrences
    if (extracted.timeline.length === 0) {
      emptyTimelineCount++
      // logger().debug({ response, aioResponse, extracted }, 'Empty timeline received')
    } else {
      // Reset counter if we got tweets
      emptyTimelineCount = 0
    }

    // Get lastTweetTime from the last item in extracted.timeline if it exists
    lastTweetTime =
      extracted.timeline.length > 0
        ? extracted.timeline[extracted.timeline.length - 1].createdAt
        : lastTweetTime

    // logger().debug(
    //   {
    //     requestCount,
    //     maxRequests,
    //     tweetsMapSize: tweetsMap.size,
    //     pendingAdditionalIds: pendingAdditionalIds.size,
    //     extractedTimelineLen: extracted.timeline.length,
    //     batchLength: batch.length,
    //     cursor: cursor,
    //     sinceTimestamp: sinceTimestamp,
    //     lastTweetTime: lastTweetTime,
    //     foundTweetsBeforeSince: foundTweetsBeforeSince
    //   },
    //   'fetching user tweets and replies'
    // )

    // Check if we've had 10 consecutive empty timelines
    if (emptyTimelineCount >= 10) {
      logger().warn(
        {
          userId,
          options,
          requestCount,
          tweetsMapSize: tweetsMap.size,
          pendingAdditionalIds: pendingAdditionalIds.size,
          extractedTimelineLen: extracted.timeline.length,
          cursor: cursor,
          lastTweetTime: lastTweetTime
        },
        'Consecutive empty timeline limit reached (10 times)'
      )
      break
    }

    // Check if we should stop pagination based on last item in timeline
    if (sinceTimestamp && !foundTweetsBeforeSince) {
      if (hasTweetBeforeTimestamp(extracted, sinceTimestamp)) {
        foundTweetsBeforeSince = true
      }
    }

    // Filter by timestamp if provided
    let filteredBatch = batch
    if (sinceTimestamp || maxTimestamp) {
      filteredBatch = batch.filter((tweet) => {
        const tweetTime = new Date(tweet.createdAt)
        if (sinceTimestamp && tweetTime < sinceTimestamp) {
          return false
        }
        if (maxTimestamp && tweetTime > maxTimestamp) {
          return false
        }
        return true
      })
    }

    // Add tweets to map (automatically deduplicates by ID)
    for (const tweet of filteredBatch) {
      tweetsMap.set(tweet.id, tweet)
    }

    // Collect additional tweet IDs from conversation metadata
    if (extracted.additionalTweetIds && extracted.additionalTweetIds.length > 0) {
      for (const id of extracted.additionalTweetIds) {
        // Only add if not already in tweetsMap
        if (!tweetsMap.has(id)) {
          pendingAdditionalIds.add(id)
        }
      }

      // Clean up: remove any IDs from pendingAdditionalIds that are now in tweetsMap
      // (they might have been added to tweetsMap in the same iteration)
      // let removedCount = 0
      for (const id of Array.from(pendingAdditionalIds)) {
        if (tweetsMap.has(id)) {
          pendingAdditionalIds.delete(id)
          // removedCount++
        }
      }
      // if (removedCount > 0) {
      //   logger().info(
      //     { removedCount },
      //     `Removed ${removedCount} IDs from pendingAdditionalIds (already in tweetsMap)`
      //   )
      // }

      // Fetch additional IDs when we have more than 200 accumulated
      if (pendingAdditionalIds.size > 200) {
        const idsArray = Array.from(pendingAdditionalIds)
        const idsToFetch = idsArray.slice(0, 200)
        // Remove the first 200 IDs from the Set
        for (const id of idsToFetch) {
          pendingAdditionalIds.delete(id)
        }
        await fetchAndProcessAdditionalIds(idsToFetch)
      }
    }

    // Get next cursor from extracted result
    const nextCursor = extracted.cursor

    // If no cursor found, we've reached the end
    if (!nextCursor) {
      break
    }

    cursor = nextCursor
    requestCount++
  }

  if (requestCount >= maxRequests) {
    logger().warn(
      {
        userId,
        options,
        requestCount,
        maxRequests,
        tweetsMapSize: tweetsMap.size,
        pendingAdditionalIds: pendingAdditionalIds.size,
        cursor: cursor,
        lastTweetTime: lastTweetTime
      },
      `Reached maximum request limit (${maxRequests}), stopping pagination`
    )
  }

  // Fetch any remaining additional tweet IDs at the end
  if (pendingAdditionalIds.size > 0) {
    const idsToFetch = Array.from(pendingAdditionalIds)
    await fetchAndProcessAdditionalIds(idsToFetch)
  }

  // Convert Map to array and sort by ID in descending order (high to low)
  const allTweets = Array.from(tweetsMap.values()).sort((a, b) => {
    // Convert string IDs to BigInt for proper numerical comparison
    const idA = BigInt(a.id)
    const idB = BigInt(b.id)
    // Sort descending (high to low)
    if (idA > idB) return -1
    if (idA < idB) return 1
    return 0
  })

  // Return only the first count tweets if count is specified
  return allTweets // count ? allTweets.slice(0, count) : allTweets
}

// Transform TweetDetailV3Tweet to FullTwitterStatus
export function transformTweetDetailV3ToFullTwitterStatus(
  tweet: TweetDetailV3Tweet
): FullTwitterStatus | null {
  if (!tweet || !tweet.legacy) {
    // nested quoted tweet will not have legacy
    // this is the case for nested quoted tweet
    // {
    //   "__typename": "Tweet",
    //   "rest_id": "1980013254555365618"
    // }
    return null
  }

  const legacy = tweet.legacy
  const user = tweet.core?.user_results?.result

  // if (legacy.in_reply_to_status_id_str) {
  //   if (!tweet.reply_to_user_results?.rest_id) {
  //     logger().error(
  //       tweet,
  //       'twitter search result tweet has no reply to user id in the reply tweet'
  //     )
  //   }
  // }

  // if (tweet.reply_to_user_results) {
  //   if (!tweet.reply_to_user_results.result?.core?.screen_name) {
  //     logger().warn(
  //       tweet,
  //       'twitter search result tweet has no screen name in the reply_to_user_results'
  //     )
  //   }
  // }

  // Extract reply info - check user_mentions if not directly available
  let inReplyToUserId = tweet.reply_to_user_results?.rest_id
  let inReplyToScreenName = tweet.reply_to_user_results?.result?.core?.screen_name

  // If it's a reply but missing user info, get it from the first user_mention
  if (legacy.in_reply_to_status_id_str && (!inReplyToUserId || !inReplyToScreenName)) {
    // logger().error(
    //   tweet,
    //   'twitter search result tweet has no reply to user id or screen name in the reply tweet V3'
    // )
    const firstMention = legacy.entities.user_mentions?.[0]
    if (firstMention) {
      inReplyToUserId = inReplyToUserId || firstMention.id_str
      inReplyToScreenName = inReplyToScreenName || firstMention.screen_name
    }
  }

  // Create the user object if available
  let tweetUser: SimpleTwitterUserFromDB | undefined
  if (user && user.__typename === 'User') {
    tweetUser = transformTweetDetailV3UserToSimpleUser(user)
  }

  // Extract quoted user info
  const quotedUserScreenName = legacy.quoted_status_permalink
    ? extractQuotedUsername(legacy.quoted_status_permalink.expanded)
    : null

  // Create the base FullTwitterStatus object
  let fullStatus: FullTwitterStatus = {
    // LookupStatus required fields
    id: tweet.rest_id,
    userId: legacy.user_id_str || '',
    text: legacy.full_text,
    truncated: getIsTruncated(legacy.full_text),
    entities: {
      hashtags: legacy.entities.hashtags || [],
      symbols: legacy.entities.symbols || [],
      urls: legacy.entities.urls || [],
      user_mentions: legacy.entities.user_mentions || []
    },
    medias:
      legacy.extended_entities?.media?.map((item) => ({
        id_str: item.id_str,
        type: item.type,
        media_url_https: item.media_url_https,
        url: item.url,
        sizes: {
          large: item.sizes.large
        },
        video_info: item.video_info
      })) || null,
    inReplyToStatusIdStr: legacy.in_reply_to_status_id_str || null,
    inReplyToUserIdStr: inReplyToUserId || null,
    inReplyToUserScreenName: inReplyToScreenName || null,
    // when user is suspended, we won't get the screen name.
    // Object is the following:
    // "result": {
    //   "__typename": "UserUnavailable",
    //   "message": "User is suspended",
    //   "unavailable_reason": "Suspended"
    // }

    quotedStatusIdStr: legacy.quoted_status_id_str || null,
    quotedUserIdStr: null,
    quotedUserScreenName: quotedUserScreenName,

    retweetedStatusIdStr: null,
    retweetedUserIdStr: null,
    retweetedUserScreenName: null,
    retweetedStatusCreatedAt: null,

    favoriteCount: legacy.favorite_count,
    retweetCount: legacy.retweet_count,
    createdAt: new Date(legacy.created_at),
    updatedAt: new Date(),

    // Additional fields
    bookmarkCount: legacy.bookmark_count || 0,
    viewCount: parseInt(tweet.view_count_info?.count || '0', 10),
    quoteCount: legacy.quote_count || 0,
    replyCount: legacy.reply_count || 0,
    conversationId: legacy.conversation_id_str || null,
    fullText: tweet.note_tweet ? tweet.note_tweet.note_tweet_results.result?.text : undefined,
    user: tweetUser,
    notetweetEntities: tweet.note_tweet
      ? {
          hashtags: tweet.note_tweet.note_tweet_results.result?.entity_set?.hashtags || [],
          symbols: tweet.note_tweet.note_tweet_results.result?.entity_set?.symbols || [],
          urls: tweet.note_tweet.note_tweet_results.result?.entity_set?.urls || [],
          user_mentions:
            tweet.note_tweet.note_tweet_results.result?.entity_set?.user_mentions || [],
          inline_media: tweet.note_tweet.note_tweet_results.result?.media?.inline_media || [],
          richtext_tags: tweet.note_tweet.note_tweet_results.result?.richtext?.richtext_tags || []
        }
      : undefined
  }

  // Handle quoted status recursively
  if (tweet.quoted_tweet_results?.result) {
    try {
      const quotedResult = tweet.quoted_tweet_results.result
      if (isTweetWithVisibilityResults(quotedResult)) {
        const quotedTweet = (quotedResult as unknown as TweetWithVisibilityResults).tweet
        fullStatus.quotedStatus =
          transformTweetDetailV3ToFullTwitterStatus(quotedTweet) || undefined
      } else {
        fullStatus.quotedStatus =
          transformTweetDetailV3ToFullTwitterStatus(quotedResult as TweetDetailV3Tweet) || undefined
      }
    } catch (error) {
      logger().error(tweet, 'Failed to parse quoted status')
      logger().error(error, 'Failed to parse quoted status')
    }
  }

  // Handle retweeted status recursively
  if (legacy.retweeted_status_results?.result) {
    try {
      const retweetedResult = legacy.retweeted_status_results.result

      // For retweets, we need to extract the retweeted status info
      if (isTweetWithVisibilityResults(retweetedResult)) {
        const retweetedTweet = (retweetedResult as unknown as TweetWithVisibilityResults).tweet
        const retweetedStatus = transformTweetDetailV3ToFullTwitterStatus(retweetedTweet)

        if (retweetedStatus) {
          fullStatus = {
            ...retweetedStatus,
            id: fullStatus.id,
            userId: fullStatus.userId,
            retweetedStatusIdStr: retweetedStatus.id,
            retweetedUserIdStr: retweetedStatus.userId,
            retweetedUserScreenName: retweetedStatus.user?.screenName || null,
            retweetedStatusCreatedAt: retweetedStatus.createdAt,
            createdAt: fullStatus.createdAt
          }
        }
      } else {
        const retweetedStatus = transformTweetDetailV3ToFullTwitterStatus(
          retweetedResult as TweetDetailV3Tweet
        )

        if (retweetedStatus) {
          fullStatus = {
            ...retweetedStatus,
            id: fullStatus.id,
            userId: fullStatus.userId,
            retweetedStatusIdStr: retweetedStatus.id,
            retweetedUserIdStr: retweetedStatus.userId,
            retweetedUserScreenName: retweetedStatus.user?.screenName || null,
            retweetedStatusCreatedAt: retweetedStatus.createdAt,
            createdAt: fullStatus.createdAt
          }
        }
      }
    } catch (error) {
      logger().error(tweet, 'Failed to parse retweeted status')
      logger().error(error, 'Failed to parse retweeted status')
    }
  }

  return fullStatus
}

// Transform TweetDetailByIds283Tweet to FullTwitterStatus
export function transformTweetDetailByIds283ToFullTwitterStatus(
  tweet: TweetDetailByIds283Tweet
): FullTwitterStatus | null {
  if (!tweet || !tweet.legacy) {
    // nested quoted tweet will not have legacy
    // this is the case for nested quoted tweet
    // {
    //   "__typename": "Tweet",
    //   "rest_id": "1980013254555365618"
    // }
    return null
  }

  const legacy = tweet.legacy
  const user = tweet.core?.user_results?.result

  // Extract reply info - check user_mentions if not directly available
  let inReplyToUserId = legacy.in_reply_to_user_id_str
  let inReplyToScreenName = legacy.in_reply_to_screen_name

  // If it's a reply but missing user info, get it from the first user_mention
  if (legacy.in_reply_to_status_id_str && (!inReplyToUserId || !inReplyToScreenName)) {
    logger().error(
      tweet,
      'twitter search result tweet has no reply to user id or screen name in the reply tweet 283'
    )
    const firstMention = legacy.entities.user_mentions?.[0]
    if (firstMention) {
      inReplyToUserId = inReplyToUserId || firstMention.id_str
      inReplyToScreenName = inReplyToScreenName || firstMention.screen_name
    }
  }

  // Create the user object if available
  let tweetUser: SimpleTwitterUserFromDB | undefined
  if (user && user.__typename === 'User') {
    tweetUser = transformTweetDetailByIds283UserToSimpleUser(user)
  }

  // Extract quoted user info
  const quotedUserScreenName = legacy.quoted_status_permalink
    ? extractQuotedUsername(legacy.quoted_status_permalink.expanded)
    : null

  // Create the base FullTwitterStatus object
  let fullStatus: FullTwitterStatus = {
    // LookupStatus required fields
    id: tweet.rest_id,
    userId: user?.rest_id || '',
    text: legacy.full_text,
    truncated: getIsTruncated(legacy.full_text),
    entities: {
      hashtags: legacy.entities.hashtags || [],
      symbols: legacy.entities.symbols || [],
      urls: legacy.entities.urls || [],
      user_mentions: legacy.entities.user_mentions || []
    },
    medias:
      legacy.extended_entities?.media?.map((item) => ({
        id_str: item.id_str,
        type: item.type,
        media_url_https: item.media_url_https,
        url: item.url,
        sizes: {
          large: item.sizes.large
        },
        video_info: item.video_info
      })) || null,
    inReplyToStatusIdStr: legacy.in_reply_to_status_id_str || null,
    inReplyToUserIdStr: inReplyToUserId || null,
    inReplyToUserScreenName: inReplyToScreenName || null,
    quotedStatusIdStr: legacy.quoted_status_id_str || null,
    quotedUserIdStr: null,
    quotedUserScreenName: quotedUserScreenName,
    retweetedStatusIdStr: null,
    retweetedUserIdStr: null,
    retweetedUserScreenName: null,
    retweetedStatusCreatedAt: null,
    favoriteCount: legacy.favorite_count,
    retweetCount: legacy.retweet_count,
    createdAt: new Date(legacy.created_at),
    updatedAt: new Date(),

    // Additional fields
    bookmarkCount: legacy.bookmark_count || 0,
    viewCount: parseInt(tweet.views?.count || '0', 10),
    quoteCount: legacy.quote_count || 0,
    replyCount: legacy.reply_count || 0,
    conversationId: legacy.conversation_id_str || null,
    fullText: tweet.note_tweet ? tweet.note_tweet.note_tweet_results.result?.text : undefined,
    user: tweetUser,
    notetweetEntities: tweet.note_tweet
      ? {
          hashtags: tweet.note_tweet.note_tweet_results.result?.entity_set?.hashtags || [],
          symbols: tweet.note_tweet.note_tweet_results.result?.entity_set?.symbols || [],
          urls: tweet.note_tweet.note_tweet_results.result?.entity_set?.urls || [],
          user_mentions:
            tweet.note_tweet.note_tweet_results.result?.entity_set?.user_mentions || [],
          inline_media: tweet.note_tweet.note_tweet_results.result?.media?.inline_media || [],
          richtext_tags: tweet.note_tweet.note_tweet_results.result?.richtext?.richtext_tags || []
        }
      : undefined
  }

  // Handle quoted status recursively
  if (tweet.quoted_status_result?.result) {
    try {
      const quotedResult = tweet.quoted_status_result.result
      if (isTweetWithVisibilityResults(quotedResult)) {
        const quotedTweet = (quotedResult as TweetDetailByIds283VisibilityTweet).tweet
        fullStatus.quotedStatus =
          transformTweetDetailByIds283ToFullTwitterStatus(quotedTweet) || undefined
      } else {
        fullStatus.quotedStatus =
          transformTweetDetailByIds283ToFullTwitterStatus(
            quotedResult as TweetDetailByIds283Tweet
          ) || undefined
      }
    } catch (error) {
      logger().error(tweet, 'Failed to parse quoted status')
      logger().error(error, 'Failed to parse quoted status')
    }
  }

  // Handle retweeted status recursively
  if (legacy.retweeted_status_result?.result) {
    try {
      const retweetedResult = legacy.retweeted_status_result.result

      // For retweets, we need to extract the retweeted status info
      if (isTweetWithVisibilityResults(retweetedResult)) {
        const retweetedTweet = (retweetedResult as TweetDetailByIds283VisibilityTweet).tweet
        const retweetedStatus = transformTweetDetailByIds283ToFullTwitterStatus(retweetedTweet)

        if (retweetedStatus) {
          fullStatus = {
            ...retweetedStatus,
            id: fullStatus.id,
            userId: fullStatus.userId,
            retweetedStatusIdStr: retweetedStatus.id,
            retweetedUserIdStr: retweetedStatus.userId,
            retweetedUserScreenName: retweetedStatus.user?.screenName || null,
            retweetedStatusCreatedAt: retweetedStatus.createdAt,
            createdAt: fullStatus.createdAt
          }
        }
      } else {
        const retweetedStatus = transformTweetDetailByIds283ToFullTwitterStatus(
          retweetedResult as TweetDetailByIds283Tweet
        )

        if (retweetedStatus) {
          fullStatus = {
            ...retweetedStatus,
            id: fullStatus.id,
            userId: fullStatus.userId,
            retweetedStatusIdStr: retweetedStatus.id,
            retweetedUserIdStr: retweetedStatus.userId,
            retweetedUserScreenName: retweetedStatus.user?.screenName || null,
            retweetedStatusCreatedAt: retweetedStatus.createdAt,
            createdAt: fullStatus.createdAt
          }
        }
      }
    } catch (error) {
      logger().error(tweet, 'Failed to parse retweeted status')
      logger().error(error, 'Failed to parse retweeted status')
    }
  }

  return fullStatus
}

// Check if any tweet in the response is before the given timestamp
// Only checks TimelineTimelineModule entries and looks at the last item
export function hasTweetBeforeTimestamp(extracted: ExtractedTimeline, timestamp: Date): boolean {
  // Check if any tweet in the timeline field is before the timestamp
  // The timeline is sorted from newest to oldest, so we can check the last tweet
  if (extracted.timeline.length === 0) {
    return false
  }

  const lastTweet = extracted.timeline[extracted.timeline.length - 1]
  const tweetTime = new Date(lastTweet.createdAt)

  if (tweetTime < timestamp) {
    logger().info(
      {
        tweetId: lastTweet.id,
        tweetTime: tweetTime.toISOString(),
        timestamp: timestamp.toISOString(),
        fullText: (lastTweet.fullText || lastTweet.text)?.substring(0, 100)
      },
      'Found tweet before timestamp in timeline'
    )
    return true
  }

  return false
}

// Type for the extracted timeline result
export interface ExtractedTimeline {
  pinned: FullTwitterStatus[]
  timeline: FullTwitterStatus[]
  cursor?: string
  additionalTweetIds?: string[] // Unique tweet IDs from conversation metadata, excluding ones already in pinned/timeline
}

// Extract and transform tweets from UserTweetsRepliesResponse (only tweets by the requested user)
export function extractTimelineStatusesFromUserTweetsReplies(
  response: UserTweetsRepliesResponse,
  userId: string
): ExtractedTimeline {
  const pinned: FullTwitterStatus[] = []
  const timeline: FullTwitterStatus[] = []
  let cursor: string | undefined
  const allMetadataTweetIds = new Set<string>() // Collect all tweet IDs from conversation metadata

  if (!response || !response.data) {
    logger().error({ response: response }, 'User timeline result does not contain data (283)')
    throw new Error('User timeline result does not contain data (283)')
  }

  // Guard clause: check if result exists
  if (!response.data.user_result_by_rest_id.result) {
    logger().warn(
      { rest_id: response.data.user_result_by_rest_id.rest_id },
      'User result does not contain timeline data'
    )
    return { pinned, timeline, cursor, additionalTweetIds: [] }
  }

  // Guard clause: check if profile_with_replies_timeline_v2 exists
  if (!response.data.user_result_by_rest_id.result.profile_with_replies_timeline_v2) {
    logger().warn(
      { rest_id: response.data.user_result_by_rest_id.rest_id },
      'User result does not contain profile_with_replies_timeline_v2'
    )
    return { pinned, timeline, cursor, additionalTweetIds: [] }
  }

  const instructions =
    response.data.user_result_by_rest_id.result.profile_with_replies_timeline_v2.timeline
      .instructions

  for (const instruction of instructions) {
    // Handle TimelinePinEntry (pinned tweet)
    if (instruction.__typename === 'TimelinePinEntry' && instruction.entry) {
      const content = instruction.entry.content

      if (content.__typename === 'TimelineTimelineItem' && content.content?.tweet_results?.result) {
        let tweet = content.content.tweet_results.result
        // Skip if result is incomplete (only has rest_id without full tweet data)
        if (!tweet || typeof tweet !== 'object') {
          continue
        }
        // Unwrap TweetWithVisibilityResults if needed
        if (isTweetWithVisibilityResults(tweet)) {
          tweet = (tweet as unknown as TweetWithVisibilityResults).tweet
        }
        // Skip if tweet is still incomplete after unwrapping
        if (!tweet || typeof tweet !== 'object' || !('legacy' in tweet)) {
          continue
        }
        // Type assertion once after potential unwrapping
        const tweetData = tweet as TweetDetailV3Tweet
        // Only process tweets by the requested user
        const tweetUserId =
          tweetData.legacy?.user_id_str || tweetData.core?.user_results?.result?.rest_id
        if (tweetUserId === userId) {
          const transformedStatus = transformTweetDetailV3ToFullTwitterStatus(tweetData)
          if (transformedStatus) {
            pinned.push(transformedStatus)
          }
        }
      }
    }

    if (instruction.__typename === 'TimelineAddEntries' && instruction.entries) {
      for (const entry of instruction.entries) {
        const content = entry.content

        // Handle cursor
        if (content.__typename === 'TimelineTimelineCursor' && content.cursor_type === 'Bottom') {
          cursor = content.value
          continue
        }

        // Handle TimelineTimelineModule (conversation threads)
        if (content.__typename === 'TimelineTimelineModule') {
          // Collect tweet IDs from conversation metadata
          if (content.metadata?.conversation_metadata?.all_tweet_ids) {
            for (const tweetId of content.metadata.conversation_metadata.all_tweet_ids) {
              allMetadataTweetIds.add(tweetId)
            }
          }

          for (const item of content.items) {
            // Skip items that don't have tweet_results (e.g., who-to-follow modules)
            if (!item.item?.content?.tweet_results?.result) {
              // logger().warn(item, "Skipping item that doesn't have tweet_results")
              continue
            }
            let tweet = item.item.content.tweet_results.result
            // Skip if result is incomplete
            if (!tweet || typeof tweet !== 'object') {
              continue
            }
            // Unwrap TweetWithVisibilityResults if needed
            if (isTweetWithVisibilityResults(tweet)) {
              tweet = (tweet as unknown as TweetWithVisibilityResults).tweet
            }
            // Skip if tweet is still incomplete after unwrapping
            if (!tweet || typeof tweet !== 'object' || !('legacy' in tweet)) {
              continue
            }
            // Type assertion once after potential unwrapping
            const tweetData = tweet as TweetDetailV3Tweet
            // Only process tweets by the requested user
            const tweetUserId =
              tweetData.legacy?.user_id_str || tweetData.core?.user_results?.result?.rest_id
            if (tweetUserId === userId) {
              const transformedStatus = transformTweetDetailV3ToFullTwitterStatus(tweetData)
              if (transformedStatus) {
                timeline.push(transformedStatus)
              }
            }
          }
        }

        // Handle TimelineTimelineItem (single tweets)
        if (content.__typename === 'TimelineTimelineItem') {
          let tweet = content.content.tweet_results.result
          // Skip if result is incomplete (only has rest_id without full tweet data)
          if (!tweet || typeof tweet !== 'object') {
            continue
          }
          // Unwrap TweetWithVisibilityResults if needed
          if (isTweetWithVisibilityResults(tweet)) {
            tweet = (tweet as TweetWithVisibilityResults).tweet
          }
          // Skip if tweet is still incomplete after unwrapping
          if (!tweet || typeof tweet !== 'object' || !('legacy' in tweet)) {
            continue
          }
          // Type assertion once after potential unwrapping
          const tweetData = tweet as TweetDetailV3Tweet
          // Only process tweets by the requested user
          const tweetUserId =
            tweetData.legacy?.user_id_str || tweetData.core?.user_results?.result?.rest_id
          if (tweetUserId === userId) {
            const transformedStatus = transformTweetDetailV3ToFullTwitterStatus(tweetData)
            if (transformedStatus) {
              timeline.push(transformedStatus)
            }
          }
        }
      }
    }
  }

  // Get all tweet IDs from pinned and timeline
  const existingTweetIds = new Set<string>()
  for (const status of pinned) {
    if (status.id) {
      existingTweetIds.add(status.id)
    }
  }
  for (const status of timeline) {
    if (status.id) {
      existingTweetIds.add(status.id)
    }
  }

  // Get unique tweet IDs from metadata that are NOT already in pinned/timeline
  const additionalTweetIds = Array.from(allMetadataTweetIds).filter(
    (id) => !existingTweetIds.has(id)
  )

  return { pinned, timeline, cursor, additionalTweetIds }
}

// Extract and transform tweets from UserTweetsRepliesAIOResponse (only tweets by the requested user)
export function extractTimelineStatusesFromUserTweetsRepliesAIO(
  response: UserTweetsRepliesAIOResponse,
  userId: string
): ExtractedTimeline {
  const pinned: FullTwitterStatus[] = []
  const timeline: FullTwitterStatus[] = []
  let cursor: string | undefined
  const allMetadataTweetIds = new Set<string>() // Collect all tweet IDs from conversation metadata

  if (!response || !response.user) {
    logger().error({ response: response }, 'User timeline result does not contain data (AIO)')
    throw new Error('User timeline result does not contain data (AIO)')
  }

  // Guard clause: check if result exists
  if (!response.user.result) {
    logger().warn('User result does not contain timeline data')
    return { pinned, timeline, cursor, additionalTweetIds: [] }
  }

  // Guard clause: check if timeline exists
  if (!response.user.result.timeline?.timeline) {
    logger().warn('User result does not contain timeline.timeline')
    return { pinned, timeline, cursor, additionalTweetIds: [] }
  }

  const instructions = response.user.result.timeline.timeline.instructions

  for (const instruction of instructions) {
    // Handle TimelinePinEntry (pinned tweet)
    if (instruction.type === 'TimelinePinEntry' && instruction.entry) {
      const content = instruction.entry.content

      if (
        content.__typename === 'TimelineTimelineItem' &&
        content.itemContent?.tweet_results?.result
      ) {
        let tweet = content.itemContent.tweet_results.result
        // Skip if result is incomplete (only has rest_id without full tweet data)
        if (!tweet || typeof tweet !== 'object') {
          continue
        }
        // Unwrap TweetWithVisibilityResults if needed
        if (isTweetWithVisibilityResults(tweet)) {
          tweet = (tweet as TweetDetailByIds283TweetWithVisibilityResults).tweet
        }
        // Skip if tweet is still incomplete after unwrapping
        if (!tweet || typeof tweet !== 'object' || !('legacy' in tweet)) {
          continue
        }
        // Type assertion once after potential unwrapping
        const tweetData = tweet as TweetDetailByIds283Tweet
        // Only process tweets by the requested user
        const tweetUserId =
          tweetData.legacy?.user_id_str || tweetData.core?.user_results?.result?.rest_id
        if (tweetUserId === userId) {
          const transformedStatus = transformTweetDetailByIds283ToFullTwitterStatus(tweetData)
          if (transformedStatus) {
            pinned.push(transformedStatus)
          }
        }
      }
    }

    if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
      for (const entry of instruction.entries) {
        const content = entry.content

        // Handle cursor
        if (content.__typename === 'TimelineTimelineCursor' && content.cursorType === 'Bottom') {
          cursor = content.value
          continue
        }

        // Handle TimelineTimelineModuleAIO (conversation threads)
        if (content.__typename === 'TimelineTimelineModule') {
          // Type guard: check if it's the AIO version with items array
          const moduleContent = content as TimelineTimelineModuleAIO

          // Collect tweet IDs from conversation metadata
          if (moduleContent.metadata?.conversationMetadata?.allTweetIds) {
            for (const tweetId of moduleContent.metadata.conversationMetadata.allTweetIds) {
              allMetadataTweetIds.add(tweetId)
            }
          }

          for (const item of moduleContent.items) {
            // Skip items that don't have tweet_results
            if (!item.item?.itemContent?.tweet_results?.result) {
              continue
            }
            let tweet = item.item.itemContent.tweet_results.result
            // Skip if result is incomplete
            if (!tweet || typeof tweet !== 'object') {
              continue
            }
            // Unwrap TweetWithVisibilityResults if needed
            if (isTweetWithVisibilityResults(tweet)) {
              tweet = (tweet as unknown as TweetDetailByIds283TweetWithVisibilityResults).tweet
            }
            // Skip if tweet is still incomplete after unwrapping
            if (!tweet || typeof tweet !== 'object' || !('legacy' in tweet)) {
              continue
            }
            // Type assertion once after potential unwrapping
            const tweetData = tweet as TweetDetailByIds283Tweet
            // Only process tweets by the requested user
            const tweetUserId =
              tweetData.legacy?.user_id_str || tweetData.core?.user_results?.result?.rest_id
            if (tweetUserId === userId) {
              const transformedStatus = transformTweetDetailByIds283ToFullTwitterStatus(tweetData)
              if (transformedStatus) {
                timeline.push(transformedStatus)
              }
            }
          }
        }

        // Handle TimelineTimelineItem (single tweets)
        if (
          content.__typename === 'TimelineTimelineItem' &&
          content.itemContent?.tweet_results?.result
        ) {
          let tweet = content.itemContent.tweet_results.result
          // Skip if result is incomplete (only has rest_id without full tweet data)
          if (!tweet || typeof tweet !== 'object') {
            continue
          }
          // Unwrap TweetWithVisibilityResults if needed
          if (isTweetWithVisibilityResults(tweet)) {
            tweet = (tweet as unknown as TweetDetailByIds283TweetWithVisibilityResults).tweet
          }
          // Skip if tweet is still incomplete after unwrapping
          if (!tweet || typeof tweet !== 'object' || !('legacy' in tweet)) {
            continue
          }
          // Type assertion once after potential unwrapping
          const tweetData = tweet as TweetDetailByIds283Tweet
          // Only process tweets by the requested user
          const tweetUserId =
            tweetData.legacy?.user_id_str || tweetData.core?.user_results?.result?.rest_id
          if (tweetUserId === userId) {
            const transformedStatus = transformTweetDetailByIds283ToFullTwitterStatus(tweetData)
            if (transformedStatus) {
              timeline.push(transformedStatus)
            }
          }
        }
      }
    }
  }

  // Get all tweet IDs from pinned and timeline
  const existingTweetIds = new Set<string>()
  for (const status of pinned) {
    if (status.id) {
      existingTweetIds.add(status.id)
    }
  }
  for (const status of timeline) {
    if (status.id) {
      existingTweetIds.add(status.id)
    }
  }

  // Get unique tweet IDs from metadata that are NOT already in pinned/timeline
  const additionalTweetIds = Array.from(allMetadataTweetIds).filter(
    (id) => !existingTweetIds.has(id)
  )

  return { pinned, timeline, cursor, additionalTweetIds }
}
