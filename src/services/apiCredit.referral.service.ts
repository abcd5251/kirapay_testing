import { sql } from 'drizzle-orm'
import httpStatus from 'http-status'
import type {
  CreateReferralBody,
  CreateReferralPaymentBody,
  ReferralResolveQuery
} from '../validations/apiCredit.validation'
import {
  findMemberProfileByTelegramId,
  resolveManagedAccountSnapshot
} from './apiCredit.account.service'
import type {
  ApiCreditAccessContext,
  ApiCreditResolvedManagedAccessContext,
  DbExecutor,
  MatchedPaymentOwnerRow,
  MemberCodeLookupRow,
  ReferralAccountLinkRow,
  ReferralExistsRow,
  ReferralListRow,
  ReferralPaymentExistsRow,
  ReferralStatsRow,
  ReferralWritableAccount
} from './apiCredit.types'
import db from '@/db'
import { getDefaultChainName } from '@/services/payments/kirapay.helpers'
import {
  buildTelegramPhotoProxyUrl,
  refreshMemberTelegramProfile
} from '@/services/telegramProfile.service'
import { ApiError } from '@/utils/ApiError'

const REFERRAL_SCOPE_API_SERVICE = 'api_service'

const buildReferralLink = (baseUrl: string | null | undefined, referralCode: string | null) => {
  if (!referralCode) {
    return null
  }

  if (!baseUrl) {
    return `/?ref=${encodeURIComponent(referralCode)}`
  }

  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${normalizedBaseUrl}/?ref=${encodeURIComponent(referralCode)}`
}

const findMemberByReferralCode = async (
  executor: DbExecutor,
  referralCode: string
): Promise<MemberCodeLookupRow | null> => {
  const normalizedReferralCode = referralCode.trim().toLowerCase()
  const result = await executor.execute(sql`
    SELECT tg_id
    FROM members
    WHERE LOWER(referral_code) = ${normalizedReferralCode}
    LIMIT 1
  `)
  return (result[0] as MemberCodeLookupRow | undefined) || null
}

const findReferralAccountLinkByTelegramId = async (
  executor: DbExecutor,
  telegramId: string
): Promise<ReferralAccountLinkRow | null> => {
  const result = await executor.execute(sql`
    SELECT id, invited_by_tg_id
    FROM api_credit_accounts
    WHERE member_tg_id = ${telegramId}
    LIMIT 1
  `)
  return (result[0] as ReferralAccountLinkRow | undefined) || null
}

const findReferralExists = async (
  executor: DbExecutor,
  referrerTelegramId: string,
  referreeTelegramId: string,
  referralScope: string
): Promise<boolean> => {
  const result = await executor.execute(sql`
    SELECT referrer_id
    FROM referrals
    WHERE referrer_id = ${referrerTelegramId}
      AND referree_id = ${referreeTelegramId}
      AND referral_scope = ${referralScope}
    LIMIT 1
  `)
  return Boolean((result[0] as ReferralExistsRow | undefined)?.referrer_id)
}

const findMatchedPaymentByOwner = async (
  executor: DbExecutor,
  paymentId: string,
  referreeTelegramId: string
): Promise<MatchedPaymentOwnerRow | null> => {
  const result = await executor.execute(sql`
    SELECT
      p.id AS payment_id,
      COALESCE(p.amount, i.amount)::numeric(20, 8)::text AS claimable_amount_in_usd
    FROM payments p
    JOIN invoices i ON i.id = p.matched_invoice_id
    WHERE p.id = ${paymentId}
      AND i.user_id = ${referreeTelegramId}
    LIMIT 1
  `)
  return (result[0] as MatchedPaymentOwnerRow | undefined) || null
}

const findReferralPaymentExists = async (
  executor: DbExecutor,
  referrerTelegramId: string,
  referreeTelegramId: string,
  paymentId: string
): Promise<boolean> => {
  const result = await executor.execute(sql`
    SELECT payment_id
    FROM referral_payment
    WHERE referrer_id = ${referrerTelegramId}
      AND referree_id = ${referreeTelegramId}
      AND payment_id = ${paymentId}
    LIMIT 1
  `)
  return Boolean((result[0] as ReferralPaymentExistsRow | undefined)?.payment_id)
}

export const getTelegramReferralProfilePayload = async (
  access: ApiCreditAccessContext,
  frontendBaseUrl?: string | null,
  backendBaseUrl?: string | null
) => {
  const emptyStats = {
    claimableAmountUsd: '0.00000000',
    creditsEarned: 0,
    paidReferrals: 0,
    peopleReferred: 0,
    referralPaymentCount: 0
  }

  if (access.apiKeyType === 'legacy') {
    return {
      apiKeyType: access.apiKeyType,
      twitterId: null,
      telegramId: null,
      referralCode: null,
      referralLink: null,
      invitedByTgId: null,
      ...emptyStats,
      stats: emptyStats,
      referrals: []
    }
  }

  if (access.authSource === 'session' && !access.account) {
    return {
      apiKeyType: access.apiKeyType,
      twitterId: access.sessionTwitterId,
      telegramId: null,
      referralCode: null,
      referralLink: null,
      invitedByTgId: null,
      ...emptyStats,
      stats: emptyStats,
      referrals: []
    }
  }

  const managedAccount = resolveManagedAccountSnapshot(
    access as ApiCreditResolvedManagedAccessContext
  )
  const { account, twitterId, telegramId } = managedAccount
  const memberProfile = account.member_tg_id
    ? await findMemberProfileByTelegramId(db('primary'), account.member_tg_id)
    : null

  const statsRows = account.member_tg_id
    ? await db('primary').execute(sql`
        SELECT
          COALESCE(referral_counts.people_referred, 0)::int AS people_referred,
          COALESCE(credit_totals.credits_earned, 0)::int AS credits_earned,
          COALESCE(payment_totals.paid_referrals, 0)::int AS paid_referrals,
          COALESCE(payment_totals.referral_payment_count, 0)::int AS referral_payment_count,
          COALESCE(payment_totals.claimable_amount_in_usd, 0)::numeric(20, 8)::text AS claimable_amount_in_usd
        FROM (
          SELECT COUNT(referree_id) AS people_referred
          FROM referrals
          WHERE referrer_id = ${account.member_tg_id}
            AND referral_scope = ${REFERRAL_SCOPE_API_SERVICE}
        ) AS referral_counts,
        (
          SELECT COALESCE(SUM(delta), 0) AS credits_earned
          FROM api_credit_ledger
          WHERE api_credit_account_id = ${'account_id' in account ? account.account_id : account.id}
            AND event_type = 'referral_bonus'
        ) AS credit_totals,
        (
          SELECT
            COUNT(DISTINCT referree_id) AS paid_referrals,
            COUNT(*) AS referral_payment_count,
            COALESCE(SUM(claimable_amount_in_usd), 0) AS claimable_amount_in_usd
          FROM referral_payment
          WHERE referrer_id = ${account.member_tg_id}
            AND referral_scope = ${REFERRAL_SCOPE_API_SERVICE}
        ) AS payment_totals
      `)
    : []
  const statsRow = statsRows[0] as ReferralStatsRow | undefined
  const stats = {
    claimableAmountUsd:
      typeof statsRow?.claimable_amount_in_usd === 'string'
        ? statsRow.claimable_amount_in_usd
        : Number(statsRow?.claimable_amount_in_usd ?? 0).toFixed(8),
    creditsEarned: Number(statsRow?.credits_earned ?? 0),
    paidReferrals: Number(statsRow?.paid_referrals ?? 0),
    peopleReferred: Number(statsRow?.people_referred ?? 0),
    referralPaymentCount: Number(statsRow?.referral_payment_count ?? 0)
  }

  const referralRows = account.member_tg_id
    ? await db('primary').execute(sql`
        SELECT
          r.referree_id,
          r.created_at,
          m.tg_meta,
          m.updated_at,
          COALESCE(payment_totals.payment_count, 0)::int AS payment_count,
          COALESCE(payment_totals.claimable_amount_in_usd, 0)::numeric(20, 8)::text AS claimable_amount_in_usd,
          payment_totals.latest_paid_at
        FROM referrals r
        LEFT JOIN members m ON m.tg_id = r.referree_id
        LEFT JOIN (
          SELECT
            referree_id,
            COUNT(*) AS payment_count,
            COALESCE(SUM(claimable_amount_in_usd), 0) AS claimable_amount_in_usd,
            MAX(created_at) AS latest_paid_at
          FROM referral_payment
          WHERE referrer_id = ${account.member_tg_id}
            AND referral_scope = ${REFERRAL_SCOPE_API_SERVICE}
          GROUP BY referree_id
        ) AS payment_totals ON payment_totals.referree_id = r.referree_id
        WHERE r.referrer_id = ${account.member_tg_id}
          AND r.referral_scope = ${REFERRAL_SCOPE_API_SERVICE}
        ORDER BY r.created_at DESC
        LIMIT 100
      `)
    : []

  const referralCode =
    typeof memberProfile?.referral_code === 'string' ? memberProfile.referral_code : null

  const enrichedReferralRows = await Promise.all(
    (referralRows as ReferralListRow[]).map(async (row) => {
      const refreshedTgMeta = await refreshMemberTelegramProfile(
        row.referree_id,
        row.tg_meta ?? null,
        {
          memberUpdatedAt: row.updated_at
        }
      )
      return refreshedTgMeta === row.tg_meta ? row : { ...row, tg_meta: refreshedTgMeta }
    })
  )

  const referrals = enrichedReferralRows.map((referralRow) => {
    return {
      telegramId: referralRow.referree_id,
      telegramUsername:
        typeof referralRow.tg_meta?.username === 'string'
          ? referralRow.tg_meta.username
          : typeof referralRow.tg_meta?.tgUsername === 'string'
            ? referralRow.tg_meta.tgUsername
            : null,
      telegramFirstName:
        typeof referralRow.tg_meta?.first_name === 'string' ? referralRow.tg_meta.first_name : null,
      telegramPhotoUrl: buildTelegramPhotoProxyUrl(referralRow.referree_id, {
        baseUrl: backendBaseUrl,
        tgMeta: referralRow.tg_meta,
        memberUpdatedAt: referralRow.updated_at
      }),
      paymentCount: Number(referralRow.payment_count ?? 0),
      hasPaid: Number(referralRow.payment_count ?? 0) > 0,
      claimableAmountUsd:
        typeof referralRow.claimable_amount_in_usd === 'string'
          ? referralRow.claimable_amount_in_usd
          : Number(referralRow.claimable_amount_in_usd ?? 0).toFixed(8),
      latestPaidAt:
        referralRow.latest_paid_at === null
          ? null
          : typeof referralRow.latest_paid_at === 'string'
            ? referralRow.latest_paid_at
            : referralRow.latest_paid_at.toISOString(),
      createdAt:
        typeof referralRow.created_at === 'string'
          ? referralRow.created_at
          : referralRow.created_at.toISOString()
    }
  })

  return {
    apiKeyType: access.apiKeyType,
    twitterId,
    telegramId,
    referralCode,
    referralLink: buildReferralLink(frontendBaseUrl, referralCode),
    invitedByTgId: account.invited_by_tg_id,
    claimableAmountUsd: stats.claimableAmountUsd,
    creditsEarned: stats.creditsEarned,
    paidReferrals: stats.paidReferrals,
    peopleReferred: stats.peopleReferred,
    referralPaymentCount: stats.referralPaymentCount,
    stats,
    referrals
  }
}

export const resolveTelegramReferralCodeResult = async (query: ReferralResolveQuery) => {
  const normalizedReferralCode = query.ref.trim()
  const inviter = await findMemberByReferralCode(db('primary'), query.ref)

  if (!inviter) {
    return {
      body: {
        valid: false,
        referralCode: normalizedReferralCode
      },
      status: httpStatus.OK
    }
  }

  const memberProfile = await findMemberProfileByTelegramId(db('primary'), inviter.tg_id)

  const rawTgMeta = memberProfile?.tg_meta ?? null
  const tgMeta =
    (await refreshMemberTelegramProfile(inviter.tg_id, rawTgMeta, {
      memberUpdatedAt: memberProfile?.updated_at
    })) ?? rawTgMeta

  const legacyUsername = typeof tgMeta?.tgUsername === 'string' ? tgMeta.tgUsername : null
  const firstName = typeof tgMeta?.first_name === 'string' ? tgMeta.first_name : ''
  const lastName = typeof tgMeta?.last_name === 'string' ? tgMeta.last_name : ''
  const inviterName = [firstName, lastName].filter(Boolean).join(' ') || legacyUsername || null
  const inviterHandle =
    typeof tgMeta?.username === 'string' ? tgMeta.username : (legacyUsername ?? null)

  return {
    body: {
      valid: true,
      referralCode: normalizedReferralCode,
      referrerTelegramId: inviter.tg_id,
      inviterName,
      inviterHandle,
      referrerPhotoUrl: buildTelegramPhotoProxyUrl(inviter.tg_id, {
        tgMeta,
        memberUpdatedAt: memberProfile?.updated_at
      })
    },
    status: httpStatus.OK
  }
}

export const createTelegramReferralResult = async (
  account: ReferralWritableAccount,
  body: CreateReferralBody
) => {
  const referrerTelegramId = account.member_tg_id
  const referreeTelegramId = body.referreeTelegramId
  const referralScope = body.referralScope

  if (referrerTelegramId === referreeTelegramId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Referrer and referree cannot be the same Telegram ID'
    )
  }

  const referrerMember = await findMemberProfileByTelegramId(db('primary'), referrerTelegramId)
  if (!referrerMember) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Referrer member profile not found')
  }

  const referreeMember = await findMemberProfileByTelegramId(db('primary'), referreeTelegramId)
  if (!referreeMember) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Referree member profile not found')
  }

  return db('primary').transaction(async (tx) => {
    const referreeAccount = await findReferralAccountLinkByTelegramId(tx, referreeTelegramId)

    if (
      referreeAccount?.invited_by_tg_id &&
      referreeAccount.invited_by_tg_id !== referrerTelegramId
    ) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Referree account is already linked to another referrer'
      )
    }

    const alreadyExists = await findReferralExists(
      tx,
      referrerTelegramId,
      referreeTelegramId,
      referralScope
    )

    if (!alreadyExists) {
      await tx.execute(sql`
        INSERT INTO referrals (referrer_id, referree_id, referral_scope, created_at, updated_at)
        VALUES (
          ${referrerTelegramId},
          ${referreeTelegramId},
          ${referralScope},
          NOW(),
          NOW()
        )
      `)
    }

    if (referreeAccount && referreeAccount.invited_by_tg_id !== referrerTelegramId) {
      await tx.execute(sql`
        UPDATE api_credit_accounts
        SET invited_by_tg_id = ${referrerTelegramId}, updated_at = NOW()
        WHERE id = ${referreeAccount.id}
      `)
    }

    return {
      created: !alreadyExists,
      referrerTelegramId,
      referreeTelegramId,
      referralScope
    }
  })
}

export const createReferralPaymentResult = async (
  account: ReferralWritableAccount,
  body: CreateReferralPaymentBody
) => {
  const referrerTelegramId = account.member_tg_id
  const referreeTelegramId = body.referreeTelegramId
  const referralScope = body.referralScope

  if (referrerTelegramId === referreeTelegramId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Referrer and referree cannot be the same Telegram ID'
    )
  }

  const referralExists = await findReferralExists(
    db('primary'),
    referrerTelegramId,
    referreeTelegramId,
    referralScope
  )
  if (!referralExists) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Referral relationship not found')
  }

  const matchedPayment = await findMatchedPaymentByOwner(
    db('primary'),
    body.paymentId,
    referreeTelegramId
  )
  if (!matchedPayment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Matched payment for referree was not found')
  }

  const claimableAmountUsd =
    typeof matchedPayment.claimable_amount_in_usd === 'string'
      ? matchedPayment.claimable_amount_in_usd
      : Number(matchedPayment.claimable_amount_in_usd).toFixed(8)
  const claimStatus = 'unclaimable'
  const claimedChain = getDefaultChainName()

  return db('primary').transaction(async (tx) => {
    const alreadyExists = await findReferralPaymentExists(
      tx,
      referrerTelegramId,
      referreeTelegramId,
      body.paymentId
    )

    if (alreadyExists) {
      await tx.execute(sql`
        UPDATE referral_payment
        SET
          claimable_amount_in_usd = ${claimableAmountUsd},
          claim_status = ${claimStatus},
          claimed_chain = ${claimedChain},
          referral_scope = ${referralScope},
          updated_at = NOW()
        WHERE referrer_id = ${referrerTelegramId}
          AND referree_id = ${referreeTelegramId}
          AND payment_id = ${body.paymentId}
      `)
    } else {
      await tx.execute(sql`
        INSERT INTO referral_payment (
          referrer_id,
          referree_id,
          payment_id,
          claimable_amount_in_usd,
          claim_status,
          claimed_chain,
          referral_scope,
          created_at,
          updated_at
        )
        VALUES (
          ${referrerTelegramId},
          ${referreeTelegramId},
          ${body.paymentId},
          ${claimableAmountUsd},
          ${claimStatus},
          ${claimedChain},
          ${referralScope},
          NOW(),
          NOW()
        )
      `)
    }

    return {
      created: !alreadyExists,
      referrerTelegramId,
      referreeTelegramId,
      paymentId: body.paymentId,
      claimableAmountUsd,
      claimStatus,
      claimedChain,
      referralScope
    }
  })
}
