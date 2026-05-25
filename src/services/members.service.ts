import crypto from 'crypto'
import { members as sharedMembers } from '@yidongw/pawx-schemas'
import { eq, and } from 'drizzle-orm'
import { SubscriberInfo } from './twitterSubscription'
import db from '@/db'
import { withDbError } from '@/utils/db'
import { logger } from '@/utils/logger'

const members: any = sharedMembers

/**
 * Get subscription limit for a telegram user
 * @param tgId - Telegram user ID
 * @returns subscription limit (defaults to 2 if member not found)
 */
export async function getSubscriptionLimit(tgId: string): Promise<number> {
  try {
    const membersResult = await withDbError(
      db()
        .select({ subLimit: members.subLimit })
        .from(members)
        .where(eq(members.tgId, tgId))
        .limit(1)
    )
    const member = membersResult[0]

    return member?.subLimit ?? 2 // Default to 2 if member not found
  } catch (error) {
    logger().error(error, `Failed to get subscription limit for tgId: ${tgId}`)
    return 2 // Default to 2 on error
  }
}

export async function createMemberIfNotExists(subscriber: SubscriberInfo) {
  // If telegram subscriber, ensure member record exists
  return await withDbError(
    db()
      .insert(members)
      .values({
        tgId: subscriber.subscriberId,
        tgMeta: subscriber.subscriberMeta,
        subLimit: 2
      })
      .onConflictDoUpdate({
        target: members.tgId,
        set: {
          tgMeta: subscriber.subscriberMeta,
          updatedAt: new Date()
        }
      })
      .returning()
  )
}

export const getMemberByIdAndCode = async (id: string, code: string) => {
  const [member] = await withDbError(
    db()
      .select()
      .from(members)
      .where(and(eq(members.id, id), eq(members.code, code)))
  )
  // Check if member exists and code hasn't expired
  if (!member) {
    return null
  }

  // Check if code has expired
  if (member.codeExpiresAt && new Date() > member.codeExpiresAt) {
    return null
  }

  return member
}

export const refreshCode = async (memberId: string) => {
  try {
    // Generate a new UUID code
    const newCode = crypto.randomUUID()

    // Set expiration to 15 minutes from now
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const [updatedMember] = await withDbError(
      db()
        .update(members)
        .set({
          code: newCode,
          codeExpiresAt: expiresAt,
          updatedAt: new Date()
        })
        .where(eq(members.id, memberId))
        .returning()
    )

    return updatedMember
  } catch (error) {
    logger().error(error, `Failed to refresh code for member: ${memberId}`)
    throw error
  }
}
