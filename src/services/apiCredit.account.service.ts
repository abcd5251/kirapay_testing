import crypto from 'crypto'
import { sql } from 'drizzle-orm'
import type { ApiCreditAccessContext } from './apiCredit.types'
import type {
  ActiveApiKeyRow,
  ApiCreditResolvedManagedAccessContext,
  ApiCreditAccountRow,
  ApiKeyLookupRow,
  DbExecutor,
  MemberProfileRow,
  ResolvedManagedAccountSnapshot
} from './apiCredit.types'
import db from '@/db'
import {
  buildTelegramPhotoProxyUrl,
  refreshMemberTelegramProfile
} from '@/services/telegramProfile.service'

const hashApiKey = (plainApiKey: string) =>
  crypto.createHash('sha256').update(plainApiKey).digest('hex')

const findAccountByTwitterId = async (
  executor: DbExecutor,
  twitterId: string
): Promise<ApiCreditAccountRow | null> => {
  const result = await executor.execute(sql`
    SELECT id, member_tg_id, twitter_id, status, available_credits, invited_by_tg_id
    FROM api_credit_accounts
    WHERE twitter_id = ${twitterId}
    LIMIT 1
  `)
  return (result[0] as ApiCreditAccountRow | undefined) || null
}

const findAccountByApiKey = async (apiKey: string): Promise<ApiKeyLookupRow | null> => {
  const apiKeyHash = hashApiKey(apiKey)
  const result = await db('primary').execute(sql`
    SELECT
      a.id AS account_id,
      a.member_tg_id,
      a.twitter_id,
      a.status AS account_status,
      a.available_credits,
      a.invited_by_tg_id,
      k.id AS api_key_id,
      k.status AS key_status
    FROM api_keys k
    JOIN api_credit_accounts a ON a.id = k.api_credit_account_id
    WHERE k.key_hash = ${apiKeyHash}
      AND k.status = 'active'
    LIMIT 1
  `)
  return (result[0] as ApiKeyLookupRow | undefined) || null
}

export const findManagedAccountByApiKey = async (apiKey: string): Promise<ApiKeyLookupRow | null> =>
  findAccountByApiKey(apiKey)

export const findManagedAccountByTwitterId = async (
  twitterId: string
): Promise<ApiCreditAccountRow | null> => findAccountByTwitterId(db('primary'), twitterId)

export const findActiveApiKeyByAccountId = async (
  executor: DbExecutor,
  accountId: string
): Promise<ActiveApiKeyRow | null> => {
  const result = await executor.execute(sql`
    SELECT id, key_last4
    FROM api_keys
    WHERE api_credit_account_id = ${accountId}
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `)
  return (result[0] as ActiveApiKeyRow | undefined) || null
}

export const findMemberProfileByTelegramId = async (
  executor: DbExecutor,
  telegramId: string
): Promise<MemberProfileRow | null> => {
  const result = await executor.execute(sql`
    SELECT tg_id, tg_meta, sub_limit, referral_code, updated_at
    FROM members
    WHERE tg_id = ${telegramId}
    LIMIT 1
  `)
  return (result[0] as MemberProfileRow | undefined) || null
}

export const resolveManagedAccountSnapshot = (
  access: ApiCreditResolvedManagedAccessContext
): ResolvedManagedAccountSnapshot => {
  if (access.authSource === 'session') {
    return {
      account: access.account,
      accountId: access.account.id,
      accountStatus: access.account.status,
      currentBalance: Number(access.account.available_credits),
      telegramId: access.account.member_tg_id,
      twitterId: access.account.twitter_id
    }
  }

  return {
    account: access.account,
    accountId: access.account.account_id,
    accountStatus: access.account.account_status,
    currentBalance: Number(access.account.available_credits),
    telegramId: access.account.member_tg_id,
    twitterId: access.account.twitter_id
  }
}

export const getApiKeyAccountProfilePayload = async (access: ApiCreditAccessContext) => {
  if (access.apiKeyType === 'legacy') {
    return {
      apiKeyType: 'legacy',
      credits: null,
      accountStatus: 'active'
    }
  }

  if (access.authSource === 'session') {
    if (!access.account) {
      return {
        apiKeyType: 'managed',
        twitterId: access.sessionTwitterId,
        telegramId: null,
        accountStatus: 'active',
        credits: 0,
        invitedByTgId: null,
        referralCode: null,
        hasActiveApiKey: false
      }
    }

    const sessionAccount = access.account
    const activeApiKey = await findActiveApiKeyByAccountId(db('primary'), sessionAccount.id)
    const rawMemberProfile = sessionAccount.member_tg_id
      ? await findMemberProfileByTelegramId(db('primary'), sessionAccount.member_tg_id)
      : null
    const refreshedTgMeta =
      rawMemberProfile && sessionAccount.member_tg_id
        ? await refreshMemberTelegramProfile(
            sessionAccount.member_tg_id,
            rawMemberProfile.tg_meta,
            {
              memberUpdatedAt: rawMemberProfile.updated_at
            }
          )
        : (rawMemberProfile?.tg_meta ?? null)
    const memberProfile =
      rawMemberProfile && refreshedTgMeta !== rawMemberProfile.tg_meta
        ? { ...rawMemberProfile, tg_meta: refreshedTgMeta }
        : rawMemberProfile

    return {
      apiKeyType: 'managed',
      twitterId: sessionAccount.twitter_id,
      telegramId: sessionAccount.member_tg_id,
      accountStatus: sessionAccount.status,
      credits: Number(sessionAccount.available_credits),
      invitedByTgId: sessionAccount.invited_by_tg_id,
      referralCode:
        typeof memberProfile?.referral_code === 'string' ? memberProfile.referral_code : null,
      telegramUsername:
        typeof memberProfile?.tg_meta?.username === 'string'
          ? memberProfile.tg_meta.username
          : null,
      telegramPhotoUrl:
        sessionAccount.member_tg_id && memberProfile
          ? buildTelegramPhotoProxyUrl(sessionAccount.member_tg_id, {
              tgMeta: memberProfile.tg_meta,
              memberUpdatedAt: memberProfile.updated_at
            })
          : null,
      telegramSubLimit:
        memberProfile?.sub_limit === null || memberProfile?.sub_limit === undefined
          ? null
          : Number(memberProfile.sub_limit),
      hasActiveApiKey: Boolean(activeApiKey),
      activeApiKeyLast4: activeApiKey?.key_last4 ?? null
    }
  }

  const account = access.account
  const rawMemberProfile = account.member_tg_id
    ? await findMemberProfileByTelegramId(db('primary'), account.member_tg_id)
    : null
  const refreshedTgMeta =
    rawMemberProfile && account.member_tg_id
      ? await refreshMemberTelegramProfile(account.member_tg_id, rawMemberProfile.tg_meta, {
          memberUpdatedAt: rawMemberProfile.updated_at
        })
      : (rawMemberProfile?.tg_meta ?? null)
  const memberProfile =
    rawMemberProfile && refreshedTgMeta !== rawMemberProfile.tg_meta
      ? { ...rawMemberProfile, tg_meta: refreshedTgMeta }
      : rawMemberProfile

  return {
    apiKeyType: 'managed',
    twitterId: account.twitter_id,
    telegramId: account.member_tg_id,
    accountStatus: account.account_status,
    credits: Number(account.available_credits),
    invitedByTgId: account.invited_by_tg_id,
    referralCode:
      typeof memberProfile?.referral_code === 'string' ? memberProfile.referral_code : null,
    telegramUsername:
      typeof memberProfile?.tg_meta?.username === 'string' ? memberProfile.tg_meta.username : null,
    telegramPhotoUrl:
      account.member_tg_id && memberProfile
        ? buildTelegramPhotoProxyUrl(account.member_tg_id, {
            tgMeta: memberProfile.tg_meta,
            memberUpdatedAt: memberProfile.updated_at
          })
        : null,
    telegramSubLimit:
      memberProfile?.sub_limit === null || memberProfile?.sub_limit === undefined
        ? null
        : Number(memberProfile.sub_limit)
  }
}
