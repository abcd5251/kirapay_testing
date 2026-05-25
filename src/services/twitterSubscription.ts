import {
  members as sharedMembers,
  twitterSubscriptions as sharedTwitterSubscriptions,
  twitterUsers as sharedTwitterUsers,
  tweets as sharedTweets
} from '@yidongw/pawx-schemas'
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'

import { ensureTweetUsersByUsernames } from './twitter'
import db from '@/db'
import { FullTwitterStatus } from '@/services/rapidapi.service'
import { SimpleTwitterUserFromDB } from '@/services/rapidapi.service'
import { withDbError } from '@/utils/db'
import { logger } from '@/utils/logger'

const members: any = sharedMembers
const twitterUsers: any = sharedTwitterUsers
const tweets: any = sharedTweets
const twitterSubscriptions: any = sharedTwitterSubscriptions

export interface BatchFollowingChange {
  userId: string
  changeId: number
  newFollowings: number
  currentFriendsIds: string[]
  existingFollowingIds: Set<string>
  followedUserIds: string[]
  unfollowedUserIds: string[]
  followedUsers: Array<{
    id: string
    name: string
    screenName: string
    description: string
    followersCount: number
  }>
  unfollowedUsers: Array<{
    id: string
    name: string
    screenName: string
    description: string
    followersCount: number
  }>
}

/**
 * Fetches user tweets with all related information from the database
 * @param userId - The user ID to fetch tweets for
 * @param createdBefore - Optional upper bound for tweet creation time
 * @param createdAfter - Optional lower bound for tweet creation time
 * @returns Array of FullTwitterStatus objects with populated related tweets and users
 */
export async function getUserTweetsWithDetails(
  userId: string,
  createdBefore?: Date,
  createdAfter?: Date
): Promise<FullTwitterStatus[]> {
  // 1. Fetch all tweets for the user from the database
  const userTweets = await withDbError(
    db()
      .select()
      .from(tweets)
      .where(
        and(
          eq(tweets.userId, userId),
          createdBefore ? lt(tweets.createdAt, createdBefore) : undefined,
          createdAfter ? gt(tweets.createdAt, createdAfter) : undefined
        )
      )
      .orderBy(desc(tweets.createdAt))
  )

  if (userTweets.length === 0) {
    return []
  }

  // 2. Collect all tweet IDs and usernames that need to be fetched
  const tweetIdsToFetch = new Set<string>()
  const userUsernamesToFetch = new Set<string>()

  for (const tweet of userTweets) {
    // Collect quoted tweet IDs
    if (tweet.quotedStatusIdStr) {
      tweetIdsToFetch.add(tweet.quotedStatusIdStr)
    }

    // Collect reply tweet IDs
    if (tweet.inReplyToStatusIdStr) {
      tweetIdsToFetch.add(tweet.inReplyToStatusIdStr)
    }

    // Collect mentioned usernames
    const entities = tweet.entities as any
    if (entities?.user_mentions) {
      for (const mention of entities.user_mentions) {
        if (mention.screen_name) {
          userUsernamesToFetch.add(mention.screen_name)
        }
      }
    }

    // Collect usernames from reply, quoted, and retweeted relationships
    if (tweet.inReplyToUserScreenName) {
      userUsernamesToFetch.add(tweet.inReplyToUserScreenName)
    }
    if (tweet.quotedUserScreenName) {
      userUsernamesToFetch.add(tweet.quotedUserScreenName)
    }
    if (tweet.retweetedUserScreenName) {
      userUsernamesToFetch.add(tweet.retweetedUserScreenName)
    }
  }

  // 3. Fetch all referenced tweets and users in parallel
  const [referencedTweets, referencedUsers] = await Promise.all([
    // Fetch referenced tweets
    (async () => {
      if (tweetIdsToFetch.size === 0) return []
      return await withDbError(
        db()
          .select()
          .from(tweets)
          .where(inArray(tweets.id, Array.from(tweetIdsToFetch)))
      )
    })(),

    // Fetch referenced users
    (async () => {
      if (userUsernamesToFetch.size === 0) return []
      return await withDbError(
        db()
          .select()
          .from(twitterUsers)
          .where(
            inArray(
              sql`LOWER(${twitterUsers.screenName})`,
              Array.from(userUsernamesToFetch).map((u) => u.toLowerCase())
            )
          )
      )
    })()
  ])

  // 4. Create lookup maps
  const tweetsMap = new Map(referencedTweets.map((tweet) => [tweet.id, tweet]))
  const usersMap = new Map(referencedUsers.map((user) => [user.screenName.toLowerCase(), user]))

  // 5. Build enriched FullTwitterStatus objects
  const result: FullTwitterStatus[] = []

  for (const tweet of userTweets) {
    // Convert database tweet to FullTwitterStatus
    const status: FullTwitterStatus = {
      id: tweet.id,
      userId: tweet.userId,
      text: tweet.text,
      truncated: tweet.truncated || false,
      entities: (tweet.entities as any) || {
        hashtags: [],
        symbols: [],
        urls: [],
        user_mentions: []
      },
      medias: (tweet.medias as any) || null,
      inReplyToStatusIdStr: tweet.inReplyToStatusIdStr || null,
      inReplyToUserIdStr: tweet.inReplyToUserIdStr || null,
      inReplyToUserScreenName: tweet.inReplyToUserScreenName || null,
      quotedStatusIdStr: tweet.quotedStatusIdStr || null,
      quotedUserScreenName: tweet.quotedUserScreenName || null,
      quotedUserIdStr: tweet.quotedUserIdStr || null,
      retweetedStatusIdStr: tweet.retweetedStatusIdStr || null,
      retweetedUserIdStr: tweet.retweetedUserIdStr || null,
      retweetedUserScreenName: tweet.retweetedUserScreenName || null,
      retweetedStatusCreatedAt: tweet.retweetedStatusCreatedAt || null,
      favoriteCount: tweet.favoriteCount,
      retweetCount: tweet.retweetCount,
      createdAt: tweet.createdAt,
      updatedAt: tweet.updatedAt,
      bookmarkCount: tweet.bookmarkCount ?? undefined,
      viewCount: tweet.viewCount ?? undefined,
      quoteCount: tweet.quoteCount ?? undefined,
      replyCount: tweet.replyCount ?? undefined,
      conversationId: tweet.conversationId ?? undefined,
      fullText: tweet.fullText ?? undefined,
      notetweetEntities: (tweet.notetweetEntities as any) ?? undefined
    }

    // Populate mentioned users
    const mentionedUsernames = Array.from(
      new Set(
        [
          status.inReplyToUserScreenName || '',
          status.quotedUserScreenName || '',
          status.retweetedUserScreenName || '',
          ...(status.entities.user_mentions?.map((u: any) => u.screen_name) || [])
        ]
          .filter(Boolean)
          .filter((u) => u !== userId) // Filter out the requesting user
      )
    )

    status.mentionedUsers = mentionedUsernames
      .map((username: string) => {
        const u = usersMap.get(username.toLowerCase())
        if (u) {
          return {
            id: u.id,
            name: u.name,
            screenName: u.screenName,
            description: u.description,
            followersCount: u.followersCount,
            location: u.location,
            friendsCount: u.friendsCount,
            createdAt: u.createdAt,
            favouritesCount: u.favouritesCount,
            verified: u.verified,
            statusesCount: u.statusesCount,
            mediaCount: u.mediaCount,
            profileImageUrlHttps: u.profileImageUrlHttps,
            profileBannerUrl: u.profileBannerUrl,
            lastTweetId: u.lastTweetId,
            updatedAt: u.updatedAt,
            website: u.website,
            foundAt: u.foundAt,
            deletedAt: u.deletedAt,
            protectedAt: u.protectedAt,
            status: null
          }
        }
        return null
      })
      .filter(Boolean) as SimpleTwitterUserFromDB[]

    // Populate quoted status
    if (status.quotedStatusIdStr) {
      const quotedTweet = tweetsMap.get(status.quotedStatusIdStr)
      if (quotedTweet) {
        status.quotedStatus = {
          id: quotedTweet.id,
          userId: quotedTweet.userId,
          text: quotedTweet.text,
          truncated: quotedTweet.truncated || false,
          entities: (quotedTweet.entities as any) || {
            hashtags: [],
            symbols: [],
            urls: [],
            user_mentions: []
          },
          medias: (quotedTweet.medias as any) || null,
          inReplyToStatusIdStr: quotedTweet.inReplyToStatusIdStr || null,
          inReplyToUserIdStr: quotedTweet.inReplyToUserIdStr || null,
          inReplyToUserScreenName: quotedTweet.inReplyToUserScreenName || null,
          quotedStatusIdStr: quotedTweet.quotedStatusIdStr || null,
          quotedUserScreenName: quotedTweet.quotedUserScreenName || null,
          quotedUserIdStr: quotedTweet.quotedUserIdStr || null,
          retweetedStatusIdStr: quotedTweet.retweetedStatusIdStr || null,
          retweetedUserIdStr: quotedTweet.retweetedUserIdStr || null,
          retweetedUserScreenName: quotedTweet.retweetedUserScreenName || null,
          retweetedStatusCreatedAt: quotedTweet.retweetedStatusCreatedAt || null,
          favoriteCount: quotedTweet.favoriteCount,
          retweetCount: quotedTweet.retweetCount,
          createdAt: quotedTweet.createdAt,
          updatedAt: quotedTweet.updatedAt,
          bookmarkCount: quotedTweet.bookmarkCount ?? undefined,
          viewCount: quotedTweet.viewCount ?? undefined,
          quoteCount: quotedTweet.quoteCount ?? undefined,
          replyCount: quotedTweet.replyCount ?? undefined,
          conversationId: quotedTweet.conversationId ?? undefined,
          fullText: quotedTweet.fullText ?? undefined,
          notetweetEntities: (quotedTweet.notetweetEntities as any) ?? undefined
        }

        // Add user info to quoted status
        if (status.quotedUserScreenName) {
          const quotedUser = usersMap.get(status.quotedUserScreenName.toLowerCase())
          if (quotedUser) {
            status.quotedStatus.user = {
              id: quotedUser.id,
              name: quotedUser.name,
              screenName: quotedUser.screenName,
              description: quotedUser.description,
              followersCount: quotedUser.followersCount,
              location: quotedUser.location,
              friendsCount: quotedUser.friendsCount,
              createdAt: quotedUser.createdAt,
              favouritesCount: quotedUser.favouritesCount,
              verified: quotedUser.verified,
              statusesCount: quotedUser.statusesCount,
              mediaCount: quotedUser.mediaCount,
              profileImageUrlHttps: quotedUser.profileImageUrlHttps,
              profileBannerUrl: quotedUser.profileBannerUrl,
              lastTweetId: quotedUser.lastTweetId,
              updatedAt: quotedUser.updatedAt,
              website: quotedUser.website,
              foundAt: quotedUser.foundAt,
              deletedAt: quotedUser.deletedAt,
              protectedAt: quotedUser.protectedAt,
              status: null
            }
          }
        }
      }
    }

    // Populate reply status
    if (status.inReplyToStatusIdStr) {
      const replyTweet = tweetsMap.get(status.inReplyToStatusIdStr)
      if (replyTweet) {
        status.replyToStatus = {
          id: replyTweet.id,
          userId: replyTweet.userId,
          text: replyTweet.text,
          truncated: replyTweet.truncated || false,
          entities: (replyTweet.entities as any) || {
            hashtags: [],
            symbols: [],
            urls: [],
            user_mentions: []
          },
          medias: (replyTweet.medias as any) || null,
          inReplyToStatusIdStr: replyTweet.inReplyToStatusIdStr || null,
          inReplyToUserIdStr: replyTweet.inReplyToUserIdStr || null,
          inReplyToUserScreenName: replyTweet.inReplyToUserScreenName || null,
          quotedStatusIdStr: replyTweet.quotedStatusIdStr || null,
          quotedUserScreenName: replyTweet.quotedUserScreenName || null,
          quotedUserIdStr: replyTweet.quotedUserIdStr || null,
          retweetedStatusIdStr: replyTweet.retweetedStatusIdStr || null,
          retweetedUserIdStr: replyTweet.retweetedUserIdStr || null,
          retweetedUserScreenName: replyTweet.retweetedUserScreenName || null,
          retweetedStatusCreatedAt: replyTweet.retweetedStatusCreatedAt || null,
          favoriteCount: replyTweet.favoriteCount,
          retweetCount: replyTweet.retweetCount,
          createdAt: replyTweet.createdAt,
          updatedAt: replyTweet.updatedAt,
          bookmarkCount: replyTweet.bookmarkCount ?? undefined,
          viewCount: replyTweet.viewCount ?? undefined,
          quoteCount: replyTweet.quoteCount ?? undefined,
          replyCount: replyTweet.replyCount ?? undefined,
          conversationId: replyTweet.conversationId ?? undefined,
          fullText: replyTweet.fullText ?? undefined,
          notetweetEntities: (replyTweet.notetweetEntities as any) ?? undefined
        }

        // Add user info to reply status
        if (status.inReplyToUserScreenName) {
          const replyUser = usersMap.get(status.inReplyToUserScreenName.toLowerCase())
          if (replyUser) {
            status.replyToStatus.user = {
              id: replyUser.id,
              name: replyUser.name,
              screenName: replyUser.screenName,
              description: replyUser.description,
              followersCount: replyUser.followersCount,
              location: replyUser.location,
              friendsCount: replyUser.friendsCount,
              createdAt: replyUser.createdAt,
              favouritesCount: replyUser.favouritesCount,
              verified: replyUser.verified,
              statusesCount: replyUser.statusesCount,
              mediaCount: replyUser.mediaCount,
              profileImageUrlHttps: replyUser.profileImageUrlHttps,
              profileBannerUrl: replyUser.profileBannerUrl,
              lastTweetId: replyUser.lastTweetId,
              updatedAt: replyUser.updatedAt,
              website: replyUser.website,
              foundAt: replyUser.foundAt,
              deletedAt: replyUser.deletedAt,
              protectedAt: replyUser.protectedAt,
              status: null
            }
          }
        }
      }
    }

    // Populate retweeted user
    if (status.retweetedUserScreenName) {
      const retweetedUser = usersMap.get(status.retweetedUserScreenName.toLowerCase())
      if (retweetedUser) {
        status.user = {
          id: retweetedUser.id,
          name: retweetedUser.name,
          screenName: retweetedUser.screenName,
          description: retweetedUser.description,
          followersCount: retweetedUser.followersCount,
          location: retweetedUser.location,
          friendsCount: retweetedUser.friendsCount,
          createdAt: retweetedUser.createdAt,
          favouritesCount: retweetedUser.favouritesCount,
          verified: retweetedUser.verified,
          statusesCount: retweetedUser.statusesCount,
          mediaCount: retweetedUser.mediaCount,
          profileImageUrlHttps: retweetedUser.profileImageUrlHttps,
          profileBannerUrl: retweetedUser.profileBannerUrl,
          lastTweetId: retweetedUser.lastTweetId,
          updatedAt: retweetedUser.updatedAt,
          website: retweetedUser.website,
          foundAt: retweetedUser.foundAt,
          deletedAt: retweetedUser.deletedAt,
          protectedAt: retweetedUser.protectedAt,
          status: null
        }
      }
    }

    result.push(status)
  }

  return result
}

export type SubscriberInfo = {
  subscriberId: string
  subscriberType: 'telegram' | 'webapp' | 'api'
  subscriberMeta: Record<string, any>
  subscriptionsOptions?: Record<string, any>
}

// Helper function to get all subscriptions for a subscriber
export async function getSubscriptions(subscriber: SubscriberInfo) {
  try {
    return await withDbError(
      db('primary')
        .select({
          subscription: twitterSubscriptions,
          twitterUser: {
            id: twitterUsers.id,
            name: twitterUsers.name,
            screenName: twitterUsers.screenName
          }
        })
        .from(twitterSubscriptions)
        .leftJoin(twitterUsers, eq(twitterSubscriptions.twitterUserId, twitterUsers.id))
        .where(
          and(
            eq(twitterSubscriptions.subscriberId, subscriber.subscriberId),
            eq(twitterSubscriptions.subscriberType, subscriber.subscriberType)
          )
        )
    )
  } catch (error) {
    logger().error(error, 'Failed to get subscriptions')
    throw error
  }
}

export async function checkSubscriptionLimit(subscriber: SubscriberInfo, twitterUsername: string) {
  try {
    if (!twitterUsername) {
      throw new Error('twitterUsername is required')
    }

    // Get current subscriptions
    const subscriptions = await getSubscriptions(subscriber)
    const currentSubscriptionsCount = subscriptions.length

    // Get member by tgId (clientId)
    const member = await withDbError(
      db().select().from(members).where(eq(members.tgId, subscriber.subscriberId)).limit(1)
    )

    // Determine subscription limit
    let subLimit = 3 // Default limit
    if (member.length > 0) {
      subLimit = member[0].subLimit
    }

    // Check if Twitter user exists using ensureTweetUsersByUsernames
    let twitterUserExists = false
    let alreadySubscribed = false
    let twitterUserId: string | null = null

    try {
      const fetchedUsers = await ensureTweetUsersByUsernames([twitterUsername])

      if (fetchedUsers.length > 0) {
        twitterUserExists = true
        twitterUserId = fetchedUsers[0].id

        // Check if already subscribed to this user from subscriptions
        alreadySubscribed = subscriptions.some(
          (sub) => sub.subscription.twitterUserId === twitterUserId
        )
      }
    } catch (error) {
      logger().error(error, `Failed to validate Twitter username: ${twitterUsername}`)
      // If there's an error, assume user doesn't exist
      twitterUserExists = false
    }

    // Check if can add more subscriptions (allow if already subscribed)
    const canAddSubscription =
      alreadySubscribed || (currentSubscriptionsCount < subLimit && twitterUserExists)
    const remainingSlots = Math.max(0, subLimit - currentSubscriptionsCount)

    return {
      success: true,
      currentSubscriptionsCount,
      subLimit,
      canAddSubscription,
      remainingSlots,
      twitterUserExists,
      alreadySubscribed,
      twitterUserId
    }
  } catch (error) {
    logger().error(error, 'Failed to check subscription limit')
    throw error
  }
}
