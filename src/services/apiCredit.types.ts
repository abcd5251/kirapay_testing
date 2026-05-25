import { sql } from 'drizzle-orm'

export type DbRow = Record<string, unknown>

export type DbExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<DbRow[]>
}

export type ApiCreditAccountRow = {
  id: string
  member_tg_id: string | null
  twitter_id: string
  status: 'active' | 'inactive' | 'suspended'
  available_credits: number
  invited_by_tg_id: string | null
}

export type ApiKeyLookupRow = {
  account_id: string
  member_tg_id: string | null
  twitter_id: string
  account_status: 'active' | 'inactive' | 'suspended'
  available_credits: number
  invited_by_tg_id: string | null
  api_key_id: string
  key_status: 'active' | 'inactive' | 'revoked'
}

export type ActiveApiKeyRow = {
  id: string
  key_last4: string
}

export type MemberProfileRow = {
  tg_id: string
  tg_meta: Record<string, unknown> | null
  sub_limit: number | string | null
  referral_code: string | null
  updated_at?: string | Date | null
}

export type MemberCodeLookupRow = {
  tg_id: string
}

export type ReferralStatsRow = {
  claimable_amount_in_usd: number | string
  people_referred: number | string
  credits_earned: number | string
  paid_referrals: number | string
  referral_payment_count: number | string
}

export type ReferralListRow = {
  claimable_amount_in_usd: number | string
  referree_id: string
  created_at: string | Date
  latest_paid_at: string | Date | null
  payment_count: number | string
  tg_meta: Record<string, unknown> | null
  updated_at?: string | Date | null
}

export type ReferralAccountLinkRow = {
  id: string
  invited_by_tg_id: string | null
}

export type ReferralExistsRow = {
  referrer_id: string
}

export type MatchedPaymentOwnerRow = {
  payment_id: string
  claimable_amount_in_usd: number | string
}

export type ReferralPaymentExistsRow = {
  payment_id: string
}

export type DailyUsageRow = {
  day: string | Date
  consumed_credits: number | string
  request_count: number | string
}

export type CreditIncreaseHistoryRow = {
  balance_after: number | string
  created_at: string | Date
  delta: number | string
  event_type: string
}

export type CreditLedgerEventRow = {
  api_key_id: string | null
  balance_after: number | string
  created_at: string | Date
  delta: number | string
  event_type: string
  id: string
}

export type CreditLedgerChartRow = {
  added_credits: number | string
  day: string | Date
  deducted_credits: number | string
  entry_count: number | string
  net_credits: number | string
}

export type CountRow = {
  count: number | string
}

export type CreditIncreaseSummaryRow = {
  referral_credits: number | string
  signup_credits: number | string
  topup_credits: number | string
  total_added_credits: number | string
}

export type ApiCreditManagedAccount = ApiCreditAccountRow | ApiKeyLookupRow

export type ApiCreditLegacyAccessContext = {
  apiKeyType: 'legacy'
}

export type ApiCreditManagedApiKeyAccessContext = {
  apiKeyType: 'managed'
  authSource: 'apiKey'
  account: ApiKeyLookupRow
  sessionTwitterId: null
}

export type ApiCreditManagedSessionAccessContext = {
  apiKeyType: 'managed'
  authSource: 'session'
  account: ApiCreditAccountRow | null
  sessionTwitterId: string
}

export type ApiCreditResolvedManagedSessionAccessContext = ApiCreditManagedSessionAccessContext & {
  account: ApiCreditAccountRow
}

export type ApiCreditAccessContext =
  | ApiCreditLegacyAccessContext
  | ApiCreditManagedApiKeyAccessContext
  | ApiCreditManagedSessionAccessContext

export type ApiCreditResolvedManagedAccessContext =
  | ApiCreditManagedApiKeyAccessContext
  | ApiCreditResolvedManagedSessionAccessContext

export type ReferralWritableAccount = ApiCreditManagedAccount & {
  member_tg_id: string
}

export type ResolvedManagedAccountSnapshot = {
  account: ApiCreditManagedAccount
  accountId: string
  accountStatus: ApiCreditAccountRow['status'] | ApiKeyLookupRow['account_status']
  currentBalance: number
  telegramId: string | null
  twitterId: string
}
