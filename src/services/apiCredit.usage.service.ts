import { sql } from 'drizzle-orm'
import type {
  CreditEventsQuery,
  CreditIncreaseHistoryQuery,
  UsageQuery
} from '../validations/apiCredit.validation'
import { resolveManagedAccountSnapshot } from './apiCredit.account.service'
import type {
  ApiCreditAccessContext,
  ApiCreditResolvedManagedAccessContext,
  CountRow,
  CreditIncreaseHistoryRow,
  CreditIncreaseSummaryRow,
  CreditLedgerChartRow,
  CreditLedgerEventRow,
  DailyUsageRow
} from './apiCredit.types'
import db from '@/db'

const TELEGRAM_BIND_LEDGER_EVENT_TYPE = 'telegram_bind_bonus'
const TOP_UP_LEDGER_EVENT_TYPES = [
  'topup',
  'starter_topup',
  'standard_topup',
  'advanced_topup'
] as const
const CREDIT_INCREASE_LEDGER_EVENT_TYPES = [
  ...TOP_UP_LEDGER_EVENT_TYPES,
  'signup_bonus',
  TELEGRAM_BIND_LEDGER_EVENT_TYPE,
  'referral_bonus'
] as const

const formatDateOnly = (value: string | Date) =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)

const mapCreditIncreaseEventTypeToSource = (eventType: string) => {
  if (eventType === 'signup_bonus' || eventType === TELEGRAM_BIND_LEDGER_EVENT_TYPE) {
    return 'signup' as const
  }

  if (eventType === 'referral_bonus') {
    return 'referral' as const
  }

  if (TOP_UP_LEDGER_EVENT_TYPES.includes(eventType as (typeof TOP_UP_LEDGER_EVENT_TYPES)[number])) {
    return 'topup' as const
  }

  return 'other' as const
}

const mapCreditLedgerEventTypeToSource = (eventType: string) => {
  if (eventType === 'signup_bonus') {
    return 'signup' as const
  }

  if (eventType === TELEGRAM_BIND_LEDGER_EVENT_TYPE) {
    return 'telegram' as const
  }

  if (eventType === 'referral_bonus') {
    return 'referral' as const
  }

  if (TOP_UP_LEDGER_EVENT_TYPES.includes(eventType as (typeof TOP_UP_LEDGER_EVENT_TYPES)[number])) {
    return 'topup' as const
  }

  return 'other' as const
}

const CREDIT_LEDGER_SOURCE_LABELS = {
  other: 'Other',
  referral: 'Referral',
  signup: 'Signup',
  telegram: 'Telegram',
  topup: 'Top Up'
} as const satisfies Record<ReturnType<typeof mapCreditLedgerEventTypeToSource>, string>

const mapCreditLedgerSourceLabel = (source: ReturnType<typeof mapCreditLedgerEventTypeToSource>) =>
  CREDIT_LEDGER_SOURCE_LABELS[source]

const getCreditLedgerSourceCondition = (
  source: 'all' | 'topup' | 'signup' | 'telegram' | 'referral' | 'other'
) => {
  if (source === 'topup') {
    return sql`event_type IN (${sql.join(
      TOP_UP_LEDGER_EVENT_TYPES.map((eventType) => sql`${eventType}`),
      sql`, `
    )})`
  }

  if (source === 'signup') {
    return sql`event_type = ${'signup_bonus'}`
  }

  if (source === 'telegram') {
    return sql`event_type = ${TELEGRAM_BIND_LEDGER_EVENT_TYPE}`
  }

  if (source === 'referral') {
    return sql`event_type = ${'referral_bonus'}`
  }

  if (source === 'other') {
    return sql`event_type NOT IN (${sql.join(
      [
        ...TOP_UP_LEDGER_EVENT_TYPES,
        'signup_bonus',
        TELEGRAM_BIND_LEDGER_EVENT_TYPE,
        'referral_bonus'
      ].map((eventType) => sql`${eventType}`),
      sql`, `
    )})`
  }

  return sql`TRUE`
}

const getCreditLedgerDirectionCondition = (direction: 'all' | 'added' | 'deducted') => {
  if (direction === 'added') {
    return sql`delta > 0`
  }

  if (direction === 'deducted') {
    return sql`delta < 0`
  }

  return sql`TRUE`
}

const getCreditIncreaseEventTypesBySource = (source: 'all' | 'topup' | 'signup' | 'referral') => {
  if (source === 'topup') {
    return [...TOP_UP_LEDGER_EVENT_TYPES]
  }

  if (source === 'signup') {
    return ['signup_bonus', TELEGRAM_BIND_LEDGER_EVENT_TYPE]
  }

  if (source === 'referral') {
    return ['referral_bonus']
  }

  return [...CREDIT_INCREASE_LEDGER_EVENT_TYPES]
}

const buildZeroDailyUsage = (rangeDays: number) => {
  const dailyUsage = []

  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const day = new Date()
    day.setUTCHours(0, 0, 0, 0)
    day.setUTCDate(day.getUTCDate() - offset)

    dailyUsage.push({
      date: day.toISOString().slice(0, 10),
      consumedCredits: 0,
      requestCount: 0
    })
  }

  return dailyUsage
}

export const getApiKeyUsagePayload = async (access: ApiCreditAccessContext, query: UsageQuery) => {
  const { range, rangeDays } = query

  if (access.apiKeyType === 'legacy') {
    return {
      apiKeyType: 'legacy',
      range,
      rangeDays,
      twitterId: null,
      telegramId: null,
      accountStatus: 'active',
      currentBalance: null,
      totalConsumedCredits: 0,
      totalRequests: 0,
      dailyUsage: buildZeroDailyUsage(rangeDays)
    }
  }

  let accountId: string | null = null
  let twitterId: string | null = null
  let telegramId: string | null = null
  let accountStatus: 'active' | 'inactive' | 'suspended' = 'active'
  let currentBalance = 0

  if (access.authSource === 'apiKey') {
    const account = access.account
    accountId = account.account_id
    twitterId = account.twitter_id
    telegramId = account.member_tg_id
    accountStatus = account.account_status
    currentBalance = Number(account.available_credits)
  } else {
    if (!access.account) {
      return {
        apiKeyType: 'managed',
        range,
        rangeDays,
        twitterId: access.sessionTwitterId,
        telegramId: null,
        accountStatus: 'active',
        currentBalance: 0,
        totalConsumedCredits: 0,
        totalRequests: 0,
        dailyUsage: buildZeroDailyUsage(rangeDays)
      }
    }

    const account = access.account
    accountId = account.id
    twitterId = account.twitter_id
    telegramId = account.member_tg_id
    accountStatus = account.status
    currentBalance = Number(account.available_credits)
  }

  const rangeStartOffset = rangeDays - 1
  const usageRows = accountId
    ? await db('primary').execute(sql`
        WITH series AS (
          SELECT generate_series(
            date_trunc('day', NOW()) - (${rangeStartOffset} * interval '1 day'),
            date_trunc('day', NOW()),
            interval '1 day'
          )::date AS day
        ),
        usage AS (
          SELECT
            date_trunc('day', created_at)::date AS day,
            SUM(ABS(delta))::int AS consumed_credits,
            COUNT(*)::int AS request_count
          FROM api_credit_ledger
          WHERE api_credit_account_id = ${accountId}
            AND event_type = 'api_call'
            AND created_at >= date_trunc('day', NOW()) - (${rangeStartOffset} * interval '1 day')
            AND created_at < date_trunc('day', NOW()) + interval '1 day'
          GROUP BY 1
        )
        SELECT
          s.day,
          COALESCE(u.consumed_credits, 0) AS consumed_credits,
          COALESCE(u.request_count, 0) AS request_count
        FROM series s
        LEFT JOIN usage u ON u.day = s.day
        ORDER BY s.day ASC
      `)
    : []

  const dailyUsage = usageRows.map((row) => {
    const usageRow = row as DailyUsageRow

    return {
      date: formatDateOnly(usageRow.day),
      consumedCredits: Number(usageRow.consumed_credits),
      requestCount: Number(usageRow.request_count)
    }
  })

  const totalConsumedCredits = dailyUsage.reduce((sum, row) => sum + row.consumedCredits, 0)
  const totalRequests = dailyUsage.reduce((sum, row) => sum + row.requestCount, 0)

  return {
    apiKeyType: 'managed',
    range,
    rangeDays,
    twitterId,
    telegramId,
    accountStatus,
    currentBalance,
    totalConsumedCredits,
    totalRequests,
    dailyUsage
  }
}

export const getApiCreditIncreaseHistoryPayload = async (
  access: ApiCreditAccessContext,
  query: CreditIncreaseHistoryQuery
) => {
  const { offset, page, pageSize, range, rangeDays, source } = query
  const emptySummary = {
    filteredCredits: 0,
    referralCredits: 0,
    signupCredits: 0,
    topupCredits: 0,
    totalAddedCredits: 0
  }

  if (access.apiKeyType === 'legacy') {
    return {
      apiKeyType: access.apiKeyType,
      twitterId: null,
      telegramId: null,
      accountStatus: 'active',
      currentBalance: null,
      filters: { page, pageSize, range, source },
      summary: emptySummary,
      history: [],
      items: [],
      pagination: {
        hasNextPage: false,
        page,
        pageSize,
        totalItems: 0,
        totalPages: 0
      }
    }
  }

  if (access.authSource === 'session' && !access.account) {
    return {
      apiKeyType: access.apiKeyType,
      twitterId: access.sessionTwitterId,
      telegramId: null,
      accountStatus: 'active',
      currentBalance: 0,
      filters: { page, pageSize, range, source },
      summary: emptySummary,
      history: [],
      items: [],
      pagination: {
        hasNextPage: false,
        page,
        pageSize,
        totalItems: 0,
        totalPages: 0
      }
    }
  }

  const managedAccount = resolveManagedAccountSnapshot(
    access as ApiCreditResolvedManagedAccessContext
  )
  const { accountId, accountStatus, currentBalance, telegramId, twitterId } = managedAccount
  const eventTypes = getCreditIncreaseEventTypesBySource(source)
  const eventTypeCondition =
    eventTypes.length === 1
      ? sql`event_type = ${eventTypes[0]}`
      : sql`event_type IN (${sql.join(
          eventTypes.map((eventType) => sql`${eventType}`),
          sql`, `
        )})`
  const rangeCondition =
    rangeDays === null ? sql`TRUE` : sql`created_at >= NOW() - (${rangeDays} * interval '1 day')`

  const summaryRows = await db('primary').execute(sql`
    SELECT
      COALESCE(SUM(delta), 0)::int AS total_added_credits,
      COALESCE(
        SUM(
          CASE
            WHEN event_type IN (${sql.join(
              TOP_UP_LEDGER_EVENT_TYPES.map((eventType) => sql`${eventType}`),
              sql`, `
            )}) THEN delta
            ELSE 0
          END
        ),
        0
      )::int AS topup_credits,
      COALESCE(
        SUM(CASE WHEN event_type IN ('signup_bonus', ${TELEGRAM_BIND_LEDGER_EVENT_TYPE}) THEN delta ELSE 0 END),
        0
      )::int AS signup_credits,
      COALESCE(SUM(CASE WHEN event_type = 'referral_bonus' THEN delta ELSE 0 END), 0)::int AS referral_credits
    FROM api_credit_ledger
    WHERE api_credit_account_id = ${accountId}
      AND delta > 0
      AND ${rangeCondition}
      AND event_type IN (${sql.join(
        CREDIT_INCREASE_LEDGER_EVENT_TYPES.map((eventType) => sql`${eventType}`),
        sql`, `
      )})
  `)
  const summaryRow = summaryRows[0] as CreditIncreaseSummaryRow | undefined
  const summary = {
    filteredCredits:
      source === 'topup'
        ? Number(summaryRow?.topup_credits ?? 0)
        : source === 'signup'
          ? Number(summaryRow?.signup_credits ?? 0)
          : source === 'referral'
            ? Number(summaryRow?.referral_credits ?? 0)
            : Number(summaryRow?.total_added_credits ?? 0),
    referralCredits: Number(summaryRow?.referral_credits ?? 0),
    signupCredits: Number(summaryRow?.signup_credits ?? 0),
    topupCredits: Number(summaryRow?.topup_credits ?? 0),
    totalAddedCredits: Number(summaryRow?.total_added_credits ?? 0)
  }

  const countRows = await db('primary').execute(sql`
    SELECT COUNT(*)::int AS count
    FROM api_credit_ledger
    WHERE api_credit_account_id = ${accountId}
      AND delta > 0
      AND ${eventTypeCondition}
      AND ${rangeCondition}
  `)
  const totalItems = Number((countRows[0] as CountRow | undefined)?.count ?? 0)

  const historyRows = await db('primary').execute(sql`
    SELECT
      event_type,
      delta,
      balance_after,
      created_at
    FROM api_credit_ledger
    WHERE api_credit_account_id = ${accountId}
      AND delta > 0
      AND ${eventTypeCondition}
      AND ${rangeCondition}
    ORDER BY created_at DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)

  const history = historyRows.map((row) => {
    const historyRow = row as CreditIncreaseHistoryRow
    const eventType = historyRow.event_type

    return {
      amount: Number(historyRow.delta),
      balanceAfter: Number(historyRow.balance_after),
      createdAt:
        typeof historyRow.created_at === 'string'
          ? historyRow.created_at
          : historyRow.created_at.toISOString(),
      eventType,
      source: mapCreditIncreaseEventTypeToSource(eventType)
    }
  })
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize)

  return {
    apiKeyType: access.apiKeyType,
    twitterId,
    telegramId,
    accountStatus,
    currentBalance,
    filters: { page, pageSize, range, source },
    summary,
    history,
    items: history,
    pagination: {
      hasNextPage: page < totalPages,
      page,
      pageSize,
      totalItems,
      totalPages
    }
  }
}

export const getApiCreditEventsPayload = async (
  access: ApiCreditAccessContext,
  query: CreditEventsQuery
) => {
  const { direction, offset, page, pageSize, range, rangeDays, source } = query
  const emptyCards = {
    referralBonus: 0,
    signupBonus: 0,
    telegramBonus: 0,
    topUpCredits: 0
  }
  const emptyFlowSummary = {
    currentBalance: access.apiKeyType === 'legacy' ? null : 0,
    visibleCreditsAdded: 0,
    visibleCreditsDeducted: 0,
    visibleEntries: 0
  }

  if (access.apiKeyType === 'legacy') {
    return {
      apiKeyType: access.apiKeyType,
      twitterId: null,
      telegramId: null,
      accountStatus: 'active',
      currentBalance: null,
      filters: { direction, page, pageSize, range, source },
      cards: emptyCards,
      flowSummary: emptyFlowSummary,
      chart: [],
      events: [],
      items: [],
      pagination: {
        hasNextPage: false,
        page,
        pageSize,
        totalItems: 0,
        totalPages: 0
      }
    }
  }

  if (access.authSource === 'session' && !access.account) {
    return {
      apiKeyType: access.apiKeyType,
      twitterId: access.sessionTwitterId,
      telegramId: null,
      accountStatus: 'active',
      currentBalance: 0,
      filters: { direction, page, pageSize, range, source },
      cards: emptyCards,
      flowSummary: emptyFlowSummary,
      chart: [],
      events: [],
      items: [],
      pagination: {
        hasNextPage: false,
        page,
        pageSize,
        totalItems: 0,
        totalPages: 0
      }
    }
  }

  const managedAccount = resolveManagedAccountSnapshot(
    access as ApiCreditResolvedManagedAccessContext
  )
  const { accountId, accountStatus, currentBalance, telegramId, twitterId } = managedAccount
  const rangeCondition =
    rangeDays === null ? sql`TRUE` : sql`created_at >= NOW() - (${rangeDays} * interval '1 day')`
  const sourceCondition = getCreditLedgerSourceCondition(source)
  const directionCondition = getCreditLedgerDirectionCondition(direction)

  const countRows = await db('primary').execute(sql`
    SELECT COUNT(*)::int AS count
    FROM api_credit_ledger
    WHERE api_credit_account_id = ${accountId}
      AND ${rangeCondition}
      AND ${sourceCondition}
      AND ${directionCondition}
  `)
  const totalItems = Number((countRows[0] as CountRow | undefined)?.count ?? 0)

  const summaryRows = await db('primary').execute(sql`
    SELECT
      COALESCE(
        SUM(CASE WHEN event_type IN (${sql.join(
          TOP_UP_LEDGER_EVENT_TYPES.map((eventType) => sql`${eventType}`),
          sql`, `
        )}) AND delta > 0 THEN delta ELSE 0 END),
        0
      )::int AS topup_credits,
      COALESCE(SUM(CASE WHEN event_type = 'signup_bonus' AND delta > 0 THEN delta ELSE 0 END), 0)::int AS signup_credits,
      COALESCE(
        SUM(CASE WHEN event_type = ${TELEGRAM_BIND_LEDGER_EVENT_TYPE} AND delta > 0 THEN delta ELSE 0 END),
        0
      )::int AS telegram_credits,
      COALESCE(SUM(CASE WHEN event_type = 'referral_bonus' AND delta > 0 THEN delta ELSE 0 END), 0)::int AS referral_credits,
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0)::int AS visible_added_credits,
      COALESCE(SUM(CASE WHEN delta < 0 THEN delta ELSE 0 END), 0)::int AS visible_deducted_credits
    FROM api_credit_ledger
    WHERE api_credit_account_id = ${accountId}
      AND ${rangeCondition}
      AND ${sourceCondition}
      AND ${directionCondition}
  `)
  const summaryRow = (summaryRows[0] ?? {}) as CreditIncreaseSummaryRow & {
    telegram_credits?: number | string
    visible_added_credits?: number | string
    visible_deducted_credits?: number | string
  }

  const eventRows = await db('primary').execute(sql`
    SELECT
      id,
      api_key_id,
      event_type,
      delta,
      balance_after,
      created_at
    FROM api_credit_ledger
    WHERE api_credit_account_id = ${accountId}
      AND ${rangeCondition}
      AND ${sourceCondition}
      AND ${directionCondition}
    ORDER BY created_at DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)

  const chartRows = await db('primary').execute(sql`
    SELECT
      date_trunc('day', created_at)::date AS day,
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0)::int AS added_credits,
      COALESCE(SUM(CASE WHEN delta < 0 THEN delta ELSE 0 END), 0)::int AS deducted_credits,
      COALESCE(SUM(delta), 0)::int AS net_credits,
      COUNT(*)::int AS entry_count
    FROM api_credit_ledger
    WHERE api_credit_account_id = ${accountId}
      AND ${rangeCondition}
      AND ${sourceCondition}
      AND ${directionCondition}
    GROUP BY 1
    ORDER BY 1 ASC
  `)

  const events = eventRows.map((row) => {
    const eventRow = row as CreditLedgerEventRow
    const normalizedSource = mapCreditLedgerEventTypeToSource(eventRow.event_type)

    return {
      id: eventRow.id,
      apiKeyId: eventRow.api_key_id,
      eventType: eventRow.event_type,
      source: normalizedSource,
      sourceLabel: mapCreditLedgerSourceLabel(normalizedSource),
      change: Number(eventRow.delta),
      balanceAfter: Number(eventRow.balance_after),
      createdAt:
        typeof eventRow.created_at === 'string'
          ? eventRow.created_at
          : eventRow.created_at.toISOString()
    }
  })

  const chart = chartRows.map((row) => {
    const chartRow = row as CreditLedgerChartRow

    return {
      date: formatDateOnly(chartRow.day),
      addedCredits: Number(chartRow.added_credits),
      deductedCredits: Number(chartRow.deducted_credits),
      entryCount: Number(chartRow.entry_count),
      netCredits: Number(chartRow.net_credits)
    }
  })

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize)

  return {
    apiKeyType: access.apiKeyType,
    twitterId,
    telegramId,
    accountStatus,
    currentBalance,
    filters: { direction, page, pageSize, range, source },
    cards: {
      topUpCredits: Number(summaryRow.topup_credits ?? 0),
      signupBonus: Number(summaryRow.signup_credits ?? 0),
      telegramBonus: Number(summaryRow.telegram_credits ?? 0),
      referralBonus: Number(summaryRow.referral_credits ?? 0)
    },
    flowSummary: {
      currentBalance,
      visibleCreditsAdded: Number(summaryRow.visible_added_credits ?? 0),
      visibleCreditsDeducted: Number(summaryRow.visible_deducted_credits ?? 0),
      visibleEntries: totalItems
    },
    chart,
    events,
    items: events,
    pagination: {
      hasNextPage: page < totalPages,
      page,
      pageSize,
      totalItems,
      totalPages
    }
  }
}
