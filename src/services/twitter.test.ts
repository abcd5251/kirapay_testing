import {
  followingChanges as sharedFollowingChanges,
  followings as sharedFollowings,
  tweets as sharedTweets,
  twitterUsers as sharedTwitterUsers,
  userCa as sharedUserCa
} from '@yidongw/pawx-schemas'
import { sql, eq, isNull, isNotNull } from 'drizzle-orm'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  bulkSaveFollowingChanges,
  bulkSaveFollowingsForMultipleUsers,
  deleteUnfollowedUsers,
  bulkRestoreFollowings,
  getTweets
} from './twitter'
import { BatchFollowingChange } from './twitterSubscription'
import db from '@/db'
import { logger } from '@/utils/logger'

const followingChanges: any = sharedFollowingChanges
const twitterUsers: any = sharedTwitterUsers
const followings: any = sharedFollowings
const userCa: any = sharedUserCa
const tweets: any = sharedTweets

vi.mock('./x.service', () => ({
  batchFetchUserLookup: vi.fn(),
  upsertTwitterUsers: vi.fn()
}))

// Helper function to create test users
async function createTestUsers(userIds: string[]) {
  const now = new Date()
  await db()
    .insert(twitterUsers)
    .values(
      userIds.map((id) => ({
        id,
        name: `User ${id}`,
        screenName: `${id}`,
        followersCount: 100,
        friendsCount: 100,
        createdAt: now,
        favouritesCount: 0,
        verified: false,
        statusesCount: 0,
        mediaCount: 0,
        profileImageUrlHttps: '',
        profileBannerUrl: 'banner_url',
        updatedAt: now
      }))
    )
}

describe('bulkSaveFollowingChanges', () => {
  beforeEach(async () => {
    try {
      // Set multiple client message levels to be extra sure
      await db().execute(sql`
        ALTER DATABASE test SET client_min_messages TO WARNING;
        SET session_replication_role = 'replica';  -- This disables triggers and constraints temporarily
      `)

      // Clean up both tables
      await db().execute(sql`DELETE FROM following_changes`)
      await db().execute(sql`DELETE FROM twitter_users`)

      // Reset replication role
      await db().execute(sql`SET session_replication_role = 'origin'`)

      vi.resetAllMocks()
    } catch (error) {
      logger().error(error, 'Error in beforeEach')
      throw error
    }
  })

  afterEach(async () => {
    // Same settings as beforeEach
    await db().execute(sql`
      ALTER DATABASE test SET client_min_messages TO WARNING;
      SET session_replication_role = 'replica';
    `)

    await db().execute(sql`DELETE FROM following_changes`)
    await db().execute(sql`DELETE FROM twitter_users`)

    // Reset replication role
    await db().execute(sql`SET session_replication_role = 'origin'`)

    vi.resetAllMocks()
  })

  it('should handle empty input array', async () => {
    const result = await bulkSaveFollowingChanges([])
    expect(result).toEqual([])

    const records = await db().select().from(followingChanges)
    expect(records).toHaveLength(0)
  })

  it('should insert new following changes', async () => {
    try {
      // Create test users first
      await createTestUsers(['123', '456'])

      const changes = [
        {
          userId: '123',
          oldFollowings: 100,
          newFollowings: 150,
          source: 'test'
        },
        {
          userId: '456',
          oldFollowings: 200,
          newFollowings: 250,
          source: 'test'
        }
      ]

      logger().info('Attempting to save following changes')
      const result = await bulkSaveFollowingChanges(changes)
      logger().info('Successfully saved following changes')
      expect(result).toEqual([])

      const records = await db().select().from(followingChanges)
      expect(records).toHaveLength(2)

      expect(records[0]).toMatchObject({
        userId: '123',
        oldFollowings: 100,
        newFollowings: 150,
        source: 'test',
        coreStatus: 'pending'
      })

      expect(records[1]).toMatchObject({
        userId: '456',
        oldFollowings: 200,
        newFollowings: 250,
        source: 'test',
        coreStatus: 'pending'
      })
    } catch (error) {
      logger().error(error, 'Error in test case')
      throw error
    }
  })

  it('should update existing pending changes for same user', async () => {
    // Create test user first
    await createTestUsers(['123'])

    // First insert
    const firstChanges = [
      {
        userId: '123',
        oldFollowings: 100,
        newFollowings: 150,
        source: 'test'
      }
    ]

    await bulkSaveFollowingChanges(firstChanges)

    // Second insert for same user
    const secondChanges = [
      {
        userId: '123',
        oldFollowings: 150,
        newFollowings: 200,
        source: 'test'
      }
    ]

    await bulkSaveFollowingChanges(secondChanges)

    const records = await db().select().from(followingChanges)
    expect(records).toHaveLength(1)

    expect(records[0]).toMatchObject({
      userId: '123',
      oldFollowings: 100,
      newFollowings: 200,
      source: 'test',
      coreStatus: 'pending'
    })
  })

  it('should work within a transaction', async () => {
    // Create test user first
    await createTestUsers(['123'])

    const changes = [
      {
        userId: '123',
        oldFollowings: 100,
        newFollowings: 150,
        source: 'test'
      }
    ]

    await db().transaction(async (tx) => {
      await bulkSaveFollowingChanges(changes, tx as any)
    })

    const records = await db().select().from(followingChanges)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      userId: '123',
      oldFollowings: 100,
      newFollowings: 150,
      source: 'test',
      coreStatus: 'pending'
    })
  })
})

describe('bulkSaveFollowingsForMultipleUsers', () => {
  beforeEach(async () => {
    // Set multiple client message levels to be extra sure
    await db().execute(sql`
      ALTER DATABASE test SET client_min_messages TO WARNING;
      SET session_replication_role = 'replica';  -- This disables triggers and constraints temporarily
    `)

    // Clean up both tables
    await db().execute(sql`DELETE FROM following_changes`)
    await db().execute(sql`DELETE FROM followings`)
    await db().execute(sql`DELETE FROM twitter_users`)

    // Reset replication role
    await db().execute(sql`SET session_replication_role = 'origin'`)

    vi.resetAllMocks()
  })

  afterEach(async () => {
    // Same settings as beforeEach
    await db().execute(sql`
      ALTER DATABASE test SET client_min_messages TO WARNING;
      SET session_replication_role = 'replica';
    `)

    await db().execute(sql`DELETE FROM following_changes`)
    await db().execute(sql`DELETE FROM followings`)
    await db().execute(sql`DELETE FROM twitter_users`)

    // Reset replication role
    await db().execute(sql`SET session_replication_role = 'origin'`)

    vi.resetAllMocks()
  })

  it('should return empty array when no followings to insert', async () => {
    const changesByUser = new Map<string, BatchFollowingChange>()
    const allUsersMap = new Map()
    const kolFollowersCountMap = new Map()
    const maxPositionMap = new Map()
    const kolUserIdsMap = new Map()

    const result = await bulkSaveFollowingsForMultipleUsers(
      changesByUser,
      allUsersMap,
      kolFollowersCountMap,
      maxPositionMap,
      kolUserIdsMap
    )

    expect(result).toEqual([])
  })

  it('should correctly insert followings for KOL user', async () => {
    const userId = 'user1'
    const followeeIds = ['followee1', 'followee2']

    // Create test users
    await createTestUsers([userId, ...followeeIds])

    // Setup input maps
    const changesByUser = new Map<string, BatchFollowingChange>([
      [
        userId,
        {
          userId,
          changeId: 1,
          newFollowings: 2,
          currentFriendsIds: [],
          existingFollowingIds: new Set<string>(),
          followedUserIds: followeeIds,
          unfollowedUserIds: [],
          followedUsers: [],
          unfollowedUsers: []
        }
      ]
    ])

    const allUsersMap = new Map(followeeIds.map((id) => [id, 100]))

    const kolFollowersCountMap = new Map(followeeIds.map((id) => [id, 5]))
    const maxPositionMap = new Map([[userId, 0]])
    const kolUserIdsMap = new Map([[userId, true]])

    const result = await bulkSaveFollowingsForMultipleUsers(
      changesByUser,
      allUsersMap,
      kolFollowersCountMap,
      maxPositionMap,
      kolUserIdsMap
    )

    // Verify returned records
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      follower: userId,
      followee: followeeIds[0]
    })
    expect(result[1]).toMatchObject({
      follower: userId,
      followee: followeeIds[1]
    })

    // Verify database state
    const dbRecords = await db().select().from(followings)
    expect(dbRecords).toHaveLength(2)
    expect(dbRecords[0]).toMatchObject({
      follower: userId,
      followee: followeeIds[0],
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 1
    })
    expect(dbRecords[1]).toMatchObject({
      follower: userId,
      followee: followeeIds[1],
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 2
    })
  })

  it('should correctly insert followings for non-KOL user', async () => {
    const userId = 'user1'
    const followeeIds = ['followee1', 'followee2']

    // Create test users
    await createTestUsers([userId, ...followeeIds])

    // Setup input maps
    const changesByUser = new Map<string, BatchFollowingChange>([
      [
        userId,
        {
          userId,
          changeId: 1,
          newFollowings: 2,
          currentFriendsIds: [],
          existingFollowingIds: new Set<string>(),
          followedUserIds: followeeIds,
          unfollowedUserIds: [],
          followedUsers: [],
          unfollowedUsers: []
        }
      ]
    ])

    const allUsersMap = new Map(followeeIds.map((id) => [id, 100]))

    const kolFollowersCountMap = new Map(followeeIds.map((id) => [id, 5]))
    const maxPositionMap = new Map([[userId, 0]])
    const kolUserIdsMap = new Map([[userId, false]])

    const result = await bulkSaveFollowingsForMultipleUsers(
      changesByUser,
      allUsersMap,
      kolFollowersCountMap,
      maxPositionMap,
      kolUserIdsMap
    )

    // Verify returned records
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      follower: userId,
      followee: followeeIds[0]
    })
    expect(result[1]).toMatchObject({
      follower: userId,
      followee: followeeIds[1]
    })

    // Verify database state
    const dbRecords = await db().select().from(followings)
    expect(dbRecords).toHaveLength(2)
    expect(dbRecords[0]).toMatchObject({
      follower: userId,
      followee: followeeIds[0],
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 1
    })
    expect(dbRecords[1]).toMatchObject({
      follower: userId,
      followee: followeeIds[1],
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 2
    })
  })

  it('should correctly handle multiple users with mixed KOL status', async () => {
    const userId1 = 'user1' // KOL
    const userId2 = 'user2' // non-KOL
    const followeeIds = ['followee1', 'followee2']

    // Create test users
    await createTestUsers([userId1, userId2, ...followeeIds])

    // Setup input maps
    const changesByUser = new Map<string, BatchFollowingChange>([
      [
        userId1,
        {
          userId: userId1,
          changeId: 1,
          newFollowings: 1,
          currentFriendsIds: [],
          existingFollowingIds: new Set<string>(),
          followedUserIds: [followeeIds[0]],
          unfollowedUserIds: [],
          followedUsers: [],
          unfollowedUsers: []
        }
      ],
      [
        userId2,
        {
          userId: userId2,
          changeId: 2,
          newFollowings: 1,
          currentFriendsIds: [],
          existingFollowingIds: new Set<string>(),
          followedUserIds: [followeeIds[1]],
          unfollowedUserIds: [],
          followedUsers: [],
          unfollowedUsers: []
        }
      ]
    ])

    const allUsersMap = new Map(followeeIds.map((id) => [id, 100]))

    const kolFollowersCountMap = new Map(followeeIds.map((id) => [id, 5]))
    const maxPositionMap = new Map([
      [userId1, 2], // user1 already has 2 followings
      [userId2, 1] // user2 already has 1 following
    ])
    const kolUserIdsMap = new Map([
      [userId1, true],
      [userId2, false]
    ])

    const result = await bulkSaveFollowingsForMultipleUsers(
      changesByUser,
      allUsersMap,
      kolFollowersCountMap,
      maxPositionMap,
      kolUserIdsMap
    )

    // Verify returned records
    expect(result).toHaveLength(2)

    // Verify database state
    const dbRecords = await db()
      .select()
      .from(followings)
      .orderBy(followings.follower, followings.followerPosition)

    expect(dbRecords).toHaveLength(2)
    expect(dbRecords[0]).toMatchObject({
      follower: userId1,
      followee: followeeIds[0],
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 3 // Starts from maxPosition + 1
    })
    expect(dbRecords[1]).toMatchObject({
      follower: userId2,
      followee: followeeIds[1],
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 2
    })
  })

  it('should work within a transaction', async () => {
    const userId = 'user1'
    const followeeIds = ['followee1', 'followee2']

    // Create test users
    await createTestUsers([userId, ...followeeIds])

    const changesByUser = new Map<string, BatchFollowingChange>([
      [
        userId,
        {
          userId,
          changeId: 1,
          newFollowings: 2,
          currentFriendsIds: [],
          existingFollowingIds: new Set<string>(),
          followedUserIds: followeeIds,
          unfollowedUserIds: [],
          followedUsers: [],
          unfollowedUsers: []
        }
      ]
    ])

    const allUsersMap = new Map(followeeIds.map((id) => [id, 100]))

    const kolFollowersCountMap = new Map(followeeIds.map((id) => [id, 5]))
    const maxPositionMap = new Map([[userId, 0]])
    const kolUserIdsMap = new Map([[userId, true]])

    await db().transaction(async (tx) => {
      const result = await bulkSaveFollowingsForMultipleUsers(
        changesByUser,
        allUsersMap,
        kolFollowersCountMap,
        maxPositionMap,
        kolUserIdsMap,
        tx
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        follower: userId,
        followee: followeeIds[0]
      })
    })
  })

  it('should decrement followeeKeyFollowers for unfollowed users by KOL', async () => {
    const userId1 = 'kolUser1'
    const userId2 = 'kolUser2'

    const followeeIds = ['followee1', 'followee2']
    // Initial: kolUser follows both followee1 and followee2, both have 5 key followers
    await createTestUsers([userId1, userId2])

    // Setup input maps
    const changesByUser = new Map<string, BatchFollowingChange>([
      [
        userId1,
        {
          userId: userId1,
          changeId: 1,
          newFollowings: 1,
          currentFriendsIds: [followeeIds[1]], // Now only follows followee2
          existingFollowingIds: new Set<string>(),
          followedUserIds: [followeeIds[1]], // New follow: followee2
          unfollowedUserIds: [followeeIds[0]], // Unfollow: followee1
          followedUsers: [],
          unfollowedUsers: []
        }
      ],
      [
        userId2,
        {
          userId: userId2,
          changeId: 1,
          newFollowings: 1,
          currentFriendsIds: [followeeIds[0]], // Now only follows followee1
          existingFollowingIds: new Set<string>(),
          followedUserIds: [followeeIds[0]], // New follow: followee1
          unfollowedUserIds: [],
          followedUsers: [],
          unfollowedUsers: []
        }
      ]
    ])

    const allUsersMap = new Map(followeeIds.map((id) => [id, 100]))

    // Both followees start with 5 key followers
    const kolFollowersCountMap = new Map(followeeIds.map((id) => [id, 5]))
    const maxPositionMap = new Map([
      [userId1, 0],
      [userId2, 0]
    ])
    const kolUserIdsMap = new Map([
      [userId1, true],
      [userId2, true]
    ])

    const result = await bulkSaveFollowingsForMultipleUsers(
      changesByUser,
      allUsersMap,
      kolFollowersCountMap,
      maxPositionMap,
      kolUserIdsMap
    )

    // Verify returned records
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      follower: userId1,
      followee: followeeIds[1]
    })
    expect(result[1]).toMatchObject({
      follower: userId2,
      followee: followeeIds[0]
    })

    // Verify database state
    const dbRecords = await db().select().from(followings)

    expect(dbRecords).toHaveLength(2)
    expect(dbRecords[0]).toMatchObject({
      follower: userId1,
      followee: followeeIds[1],
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 1
    })

    expect(dbRecords[1]).toMatchObject({
      follower: userId2,
      followee: followeeIds[0],
      followeeFollowers: 100,
      followeeKeyFollowers: 4,
      followerPosition: 1
    })
  })

  it('should set deletedAt to null when reinserting previously deleted following', async () => {
    const userId = 'user1'
    const followeeId = 'followee1'

    // Create test users
    await createTestUsers([userId, followeeId])

    // First insert a following and mark it as deleted
    const now = new Date()
    await db().insert(followings).values({
      follower: userId,
      followee: followeeId,
      followeeFollowers: 100,
      followeeKeyFollowers: 5,
      followerPosition: 1,
      createdAt: now,
      deletedAt: now // Mark as deleted
    })

    // Verify it's marked as deleted
    const deletedRecord = await db()
      .select()
      .from(followings)
      .where(eq(followings.follower, userId))

    expect(deletedRecord[0].deletedAt).not.toBeNull()

    // Now try to reinsert the same following
    const changesByUser = new Map<string, BatchFollowingChange>([
      [
        userId,
        {
          userId,
          changeId: 1,
          newFollowings: 1,
          currentFriendsIds: [],
          existingFollowingIds: new Set<string>(),
          followedUserIds: [followeeId],
          unfollowedUserIds: [],
          followedUsers: [],
          unfollowedUsers: []
        }
      ]
    ])

    const allUsersMap = new Map([[followeeId, 100]])
    const kolFollowersCountMap = new Map([[followeeId, 5]])
    const maxPositionMap = new Map([[userId, 0]])
    const kolUserIdsMap = new Map([[userId, true]])

    await bulkSaveFollowingsForMultipleUsers(
      changesByUser,
      allUsersMap,
      kolFollowersCountMap,
      maxPositionMap,
      kolUserIdsMap
    )

    // Verify deletedAt is now null
    const updatedRecord = await db()
      .select()
      .from(followings)
      .where(eq(followings.follower, userId))
    expect(updatedRecord[0].deletedAt).toBeNull()
  })
})

describe('deleteUnfollowedUsers', () => {
  beforeEach(async () => {
    try {
      // Set multiple client message levels to be extra sure
      await db().execute(sql`
        ALTER DATABASE test SET client_min_messages TO WARNING;
        SET session_replication_role = 'replica';  -- This disables triggers and constraints temporarily
      `)

      // Clean up tables
      await db().execute(sql`DELETE FROM following_changes`)
      await db().execute(sql`DELETE FROM followings`)
      await db().execute(sql`DELETE FROM twitter_users`)

      // Reset replication role
      await db().execute(sql`SET session_replication_role = 'origin'`)

      vi.resetAllMocks()
    } catch (error) {
      logger().error(error, 'Error in beforeEach')
      throw error
    }
  })

  afterEach(async () => {
    // Same settings as beforeEach
    await db().execute(sql`
      ALTER DATABASE test SET client_min_messages TO WARNING;
      SET session_replication_role = 'replica';
    `)

    await db().execute(sql`DELETE FROM following_changes`)
    await db().execute(sql`DELETE FROM followings`)
    await db().execute(sql`DELETE FROM twitter_users`)

    // Reset replication role
    await db().execute(sql`SET session_replication_role = 'origin'`)

    vi.resetAllMocks()
  })

  it('should not mark anything as deleted if unfollowedPairs is empty', async () => {
    // Insert a following
    const userId = 'user1'
    const followeeId = 'followee1'

    // Create test users
    await createTestUsers([userId])

    await db().insert(followings).values({
      follower: userId,
      followee: followeeId,
      createdAt: new Date(),
      followerPosition: 0
    })

    await db().transaction(async (tx) => {
      await deleteUnfollowedUsers([], tx as any)
    })

    const followingsAfter = await db().select().from(followings).where(isNull(followings.deletedAt))
    expect(followingsAfter.length).toBe(1)
    expect(followingsAfter[0].deletedAt).toBeNull()
  })

  it('should mark the specified followings as deleted', async () => {
    // Insert followings
    const userId = 'user1'
    const followeeIds = ['followee1', 'followee2']

    // Create test users
    await createTestUsers([userId])

    const now = new Date()
    await db()
      .insert(followings)
      .values([
        { follower: userId, followee: followeeIds[0], createdAt: now, followerPosition: 0 },
        { follower: userId, followee: followeeIds[1], createdAt: now, followerPosition: 0 }
      ])

    await deleteUnfollowedUsers([{ follower: userId, followee: followeeIds[0] }])

    // Check active followings (not deleted)
    const activeFollowings = await db()
      .select()
      .from(followings)
      .where(isNull(followings.deletedAt))
    expect(activeFollowings.length).toBe(1)
    expect(activeFollowings[0]).toMatchObject({
      follower: userId,
      followee: followeeIds[1],
      deletedAt: null
    })

    // Check deleted followings
    const deletedFollowings = await db()
      .select()
      .from(followings)
      .where(isNotNull(followings.deletedAt))
    expect(deletedFollowings.length).toBe(1)
    expect(deletedFollowings[0]).toMatchObject({
      follower: userId,
      followee: followeeIds[0]
    })
    expect(deletedFollowings[0].deletedAt).toBeInstanceOf(Date)
  })

  it('should not mark already deleted followings', async () => {
    // Insert followings
    const userId = 'user1'
    const followeeId = 'followee1'

    // Create test users
    await createTestUsers([userId])

    const now = new Date()
    const oldDeletedAt = new Date(now.getTime() - 1000) // 1 second ago

    await db().insert(followings).values({
      follower: userId,
      followee: followeeId,
      createdAt: now,
      followerPosition: 0,
      deletedAt: oldDeletedAt
    })

    await deleteUnfollowedUsers([{ follower: userId, followee: followeeId }])

    // Verify the deletedAt wasn't updated
    const followingsAfter = await db()
      .select()
      .from(followings)
      .where(eq(followings.follower, userId))
    expect(followingsAfter.length).toBe(1)
    expect(followingsAfter[0].deletedAt).toEqual(oldDeletedAt)
  })
})

describe('bulkRestoreFollowings', () => {
  beforeEach(async () => {
    try {
      await db().execute(sql`
          ALTER DATABASE test SET client_min_messages TO WARNING;
          SET session_replication_role = 'replica';
        `)

      await db().execute(sql`DELETE FROM followings`)
      await db().execute(sql`DELETE FROM twitter_users`)

      await db().execute(sql`SET session_replication_role = 'origin'`)

      vi.resetAllMocks()
    } catch (error) {
      logger().error(error, 'Error in beforeEach')
      throw error
    }
  })

  afterEach(async () => {
    await db().execute(sql`
        ALTER DATABASE test SET client_min_messages TO WARNING;
        SET session_replication_role = 'replica';
      `)

    await db().execute(sql`DELETE FROM followings`)
    await db().execute(sql`DELETE FROM twitter_users`)

    await db().execute(sql`SET session_replication_role = 'origin'`)

    vi.resetAllMocks()
  })

  it('should restore deleted followings while preserving createdAt', async () => {
    // Create test users
    await createTestUsers(['user1', 'user2', 'followee1', 'followee2'])

    // Insert deleted followings with specific dates
    const originalCreatedAt = new Date('2023-01-01')
    const deletedDate = new Date('2023-01-02')
    await db()
      .insert(followings)
      .values([
        {
          follower: 'user1',
          followee: 'followee1',
          createdAt: originalCreatedAt,
          deletedAt: deletedDate,
          followerPosition: 1
        },
        {
          follower: 'user2',
          followee: 'followee2',
          createdAt: originalCreatedAt,
          deletedAt: deletedDate,
          followerPosition: 1
        }
      ])

    const refollowedPairs = [
      { follower: 'user1', followee: 'followee1' },
      { follower: 'user2', followee: 'followee2' }
    ]

    const result = await bulkRestoreFollowings(refollowedPairs)

    // Verify returned pairs
    expect(result).toEqual(refollowedPairs)

    // Verify database state
    const restoredFollowings = await db().select().from(followings).orderBy(followings.follower)

    expect(restoredFollowings).toHaveLength(2)
    restoredFollowings.forEach((following) => {
      expect(following.deletedAt).toBeNull()
      // createdAt should remain unchanged
      expect(following.createdAt).toEqual(originalCreatedAt)
    })
  })

  it('should only restore followings that were previously deleted while preserving dates', async () => {
    // Create test users
    await createTestUsers(['user1', 'followee1', 'followee2'])

    // Insert one deleted and one active following
    const originalCreatedAt = new Date('2023-01-01')
    const deletedDate = new Date('2023-01-02')
    await db()
      .insert(followings)
      .values([
        {
          follower: 'user1',
          followee: 'followee1',
          createdAt: originalCreatedAt,
          deletedAt: deletedDate,
          followerPosition: 1
        },
        {
          follower: 'user1',
          followee: 'followee2',
          createdAt: originalCreatedAt,
          deletedAt: null,
          followerPosition: 2
        }
      ])

    const refollowedPairs = [
      { follower: 'user1', followee: 'followee1' },
      { follower: 'user1', followee: 'followee2' }
    ]

    await bulkRestoreFollowings(refollowedPairs)

    // Verify database state
    const followingsAfter = await db().select().from(followings).orderBy(followings.followee)

    expect(followingsAfter).toHaveLength(2)
    expect(followingsAfter[0].deletedAt).toBeNull() // followee1 - was deleted, now restored
    expect(followingsAfter[0].createdAt).toEqual(originalCreatedAt) // should remain unchanged
    expect(followingsAfter[1].deletedAt).toBeNull() // followee2 - was never deleted
    expect(followingsAfter[1].createdAt).toEqual(originalCreatedAt) // should remain unchanged
  })

  it('should work within a transaction', async () => {
    // Create test users
    await createTestUsers(['user1', 'followee1'])

    // Insert a deleted following
    const originalCreatedAt = new Date('2023-01-01')
    const deletedDate = new Date('2023-01-02')
    await db().insert(followings).values({
      follower: 'user1',
      followee: 'followee1',
      createdAt: originalCreatedAt,
      deletedAt: deletedDate,
      followerPosition: 1
    })

    const refollowedPairs = [{ follower: 'user1', followee: 'followee1' }]

    await db().transaction(async (tx) => {
      await bulkRestoreFollowings(refollowedPairs, tx)

      // Verify within transaction
      const restoredFollowing = await tx
        .select()
        .from(followings)
        .where(eq(followings.follower, 'user1'))

      expect(restoredFollowing[0].deletedAt).toBeNull()
      expect(restoredFollowing[0].createdAt).toEqual(originalCreatedAt)
    })
  })

  it('should handle multiple pairs with same follower', async () => {
    // Create test users
    await createTestUsers(['user1', 'followee1', 'followee2'])

    // Insert deleted followings
    const originalCreatedAt = new Date('2023-01-01')
    const deletedDate = new Date('2023-01-02')
    await db()
      .insert(followings)
      .values([
        {
          follower: 'user1',
          followee: 'followee1',
          createdAt: originalCreatedAt,
          deletedAt: deletedDate,
          followerPosition: 1
        },
        {
          follower: 'user1',
          followee: 'followee2',
          createdAt: originalCreatedAt,
          deletedAt: deletedDate,
          followerPosition: 2
        }
      ])

    const refollowedPairs = [
      { follower: 'user1', followee: 'followee1' },
      { follower: 'user1', followee: 'followee2' }
    ]

    await bulkRestoreFollowings(refollowedPairs)

    // Verify database state
    const restoredFollowings = await db().select().from(followings).orderBy(followings.followee)

    expect(restoredFollowings).toHaveLength(2)
    restoredFollowings.forEach((following) => {
      expect(following.deletedAt).toBeNull()
      expect(following.createdAt).toEqual(originalCreatedAt)
    })
  })
})

describe('getTweets', () => {
  beforeEach(async () => {
    try {
      await db().execute(sql`
        ALTER DATABASE test SET client_min_messages TO WARNING;
        SET session_replication_role = 'replica';
      `)

      await db().execute(sql`DELETE FROM user_ca`)
      await db().execute(sql`DELETE FROM tweets`)
      await db().execute(sql`DELETE FROM twitter_users`)

      await db().execute(sql`SET session_replication_role = 'origin'`)

      vi.resetAllMocks()
    } catch (error) {
      logger().error(error, 'Error in beforeEach')
      throw error
    }
  })

  afterEach(async () => {
    await db().execute(sql`
      ALTER DATABASE test SET client_min_messages TO WARNING;
      SET session_replication_role = 'replica';
    `)

    await db().execute(sql`DELETE FROM user_ca`)
    await db().execute(sql`DELETE FROM tweets`)
    await db().execute(sql`DELETE FROM twitter_users`)

    await db().execute(sql`SET session_replication_role = 'origin'`)

    vi.resetAllMocks()
  })

  it('should return tweets with token information and filter out non-tokens', async () => {
    // Create test user
    const now = new Date()
    await db().insert(twitterUsers).values({
      id: 'user1',
      name: 'Test User',
      screenName: 'test_user',
      followersCount: 100,
      friendsCount: 100,
      createdAt: now,
      favouritesCount: 0,
      verified: false,
      statusesCount: 0,
      mediaCount: 0,
      profileImageUrlHttps: '',
      profileBannerUrl: 'banner_url',
      updatedAt: now,
      isKol: true
    })

    // Create test tweets
    await db()
      .insert(tweets)
      .values([
        {
          id: 'tweet1',
          userId: 'user1',
          text: 'Test tweet 1',
          processedText: 'Test tweet 1',
          contractAddresses: ['0x123'],
          createdAt: now,
          updatedAt: now,
          favoriteCount: 0,
          quoteCount: 0,
          replyCount: 0,
          retweetCount: 0
        },
        {
          id: 'tweet2',
          userId: 'user1',
          text: 'Test tweet 2',
          processedText: 'Test tweet 2',
          contractAddresses: ['0x456'],
          createdAt: now,
          updatedAt: now,
          favoriteCount: 0,
          quoteCount: 0,
          replyCount: 0,
          retweetCount: 0
        }
      ])

    // Create test user_ca records
    await db()
      .insert(userCa)
      .values([
        {
          userId: 'user1',
          ca: '0x123',
          tweetId: 'tweet1',
          isToken: true,
          chainIds: ['1'],
          name: 'Token 1',
          symbol: 'TKN1'
        },
        {
          userId: 'user1',
          ca: '0x456',
          tweetId: 'tweet2',
          isToken: false,
          chainIds: ['1'],
          name: 'Token 2',
          symbol: 'TKN2'
        }
      ])

    const result = await getTweets()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      text: 'Test tweet 1',
      contractAddresses: ['0x123'],
      user: {
        name: 'Test User',
        screenName: 'test_user'
      },
      token: {
        ca: '0x123',
        chainIds: ['1'],
        name: 'Token 1',
        symbol: 'TKN1'
      }
    })
  })

  it('should handle case-insensitive contract address matching', async () => {
    // Create test user
    const now = new Date()
    await db().insert(twitterUsers).values({
      id: 'user1',
      name: 'Test User',
      screenName: 'test_user',
      followersCount: 100,
      friendsCount: 100,
      createdAt: now,
      favouritesCount: 0,
      verified: false,
      statusesCount: 0,
      mediaCount: 0,
      profileImageUrlHttps: '',
      profileBannerUrl: 'banner_url',
      updatedAt: now,
      isKol: true
    })

    // Create test tweet
    await db()
      .insert(tweets)
      .values({
        id: 'tweet1',
        userId: 'user1',
        text: 'Test tweet',
        processedText: 'Test tweet',
        contractAddresses: ['0xABC'],
        createdAt: now,
        updatedAt: now,
        favoriteCount: 0,
        quoteCount: 0,
        replyCount: 0,
        retweetCount: 0
      })

    // Create test user_ca record
    await db()
      .insert(userCa)
      .values({
        userId: 'user1',
        ca: '0xABC',
        tweetId: 'tweet1',
        isToken: true,
        chainIds: ['1'],
        name: 'Token',
        symbol: 'TKN'
      })

    // Test with different case
    const result = await getTweets(undefined, undefined, 10, '0xabc')

    expect(result).toHaveLength(1)
    expect(result[0].token.ca).toBe('0xABC')
  })

  it('should handle date ordering correctly', async () => {
    // Create test user
    const now = new Date()
    await db().insert(twitterUsers).values({
      id: 'user1',
      name: 'Test User',
      screenName: 'test_user',
      followersCount: 100,
      friendsCount: 100,
      createdAt: now,
      favouritesCount: 0,
      verified: false,
      statusesCount: 0,
      mediaCount: 0,
      profileImageUrlHttps: '',
      profileBannerUrl: 'banner_url',
      updatedAt: now,
      isKol: true
    })

    // Create test tweets with different dates
    const date1 = new Date('2024-01-01')
    const date2 = new Date('2024-01-02')
    await db()
      .insert(tweets)
      .values([
        {
          id: 'tweet1',
          userId: 'user1',
          text: 'Test tweet 1',
          processedText: 'Test tweet 1',
          contractAddresses: ['0x123'],
          createdAt: date1,
          updatedAt: date1,
          favoriteCount: 0,
          quoteCount: 0,
          replyCount: 0,
          retweetCount: 0
        },
        {
          id: 'tweet2',
          userId: 'user1',
          text: 'Test tweet 2',
          processedText: 'Test tweet 2',
          contractAddresses: ['0x456'],
          createdAt: date2,
          updatedAt: date2,
          favoriteCount: 0,
          quoteCount: 0,
          replyCount: 0,
          retweetCount: 0
        }
      ])

    // Create test user_ca records
    await db()
      .insert(userCa)
      .values([
        {
          userId: 'user1',
          ca: '0x123',
          tweetId: 'tweet1',
          isToken: true,
          chainIds: ['1'],
          name: 'Token 1',
          symbol: 'TKN1'
        },
        {
          userId: 'user1',
          ca: '0x456',
          tweetId: 'tweet2',
          isToken: true,
          chainIds: ['1'],
          name: 'Token 2',
          symbol: 'TKN2'
        }
      ])

    // Test ascending order (afterDate)
    const ascendingResult = await getTweets(new Date(0))

    expect(ascendingResult).toHaveLength(2)
    expect(ascendingResult[0].createdAt).toEqual(date1)
    expect(ascendingResult[1].createdAt).toEqual(date2)

    // Test descending order (beforeDate)
    const descendingResult = await getTweets(undefined, new Date())
    expect(descendingResult).toHaveLength(2)
    expect(descendingResult[0].createdAt).toEqual(date1)
    expect(descendingResult[1].createdAt).toEqual(date2)
  })
})
