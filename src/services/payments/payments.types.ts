import type { sql } from 'drizzle-orm'

export type DbRow = Record<string, unknown>

export type DbExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<DbRow[]>
}

export type ManagedPaymentAccountRow = {
  account_id: string
  member_tg_id: string | null
  twitter_id: string
  account_status: 'active' | 'inactive' | 'suspended'
  available_credits: number | string
  invited_by_tg_id: string | null
}

export type ManagedPaymentAccessInput = {
  apiKey?: string
  sessionTwitterId?: string
}

export type InvoiceRow = {
  id: string
  user_id: string
  plan_id: string
  amount: number | string
  paid: boolean
  paid_at: string | Date | null
  created_at: string | Date
  expires_at: string | Date
  duration_days: number | string
  plan_limit: number | string
  identifier_in_usd: string
}

export type ApiCreditAccountRow = {
  id: string
  member_tg_id: string | null
  invited_by_tg_id: string | null
  available_credits: number | string
}

export type PaymentUpsertRow = {
  id: string
}

export type PaymentRecordRow = {
  id: string
  tx_hash: string
  chain: string | null
  amount: number | string | null
  token: string | null
  from_address: string | null
  to_address: string | null
  created_at: string | Date
}

export type KiraPayCreateLinkResponse =
  | {
      code?: number
      data?: {
        originalPrice?: number
        price?: number
        url?: string
      }
      message?: string
    }
  | {
      message?: string
      statusCode?: number
    }
  | null

export type KiraPayLinkItem = {
  _id: string
  code?: string
  customOrderId?: string
  url?: string
}

export type KiraPayLinksResponse = {
  data?: {
    links?: KiraPayLinkItem[]
    totalPages?: number
  }
}

export type KiraPayTransactionItem = {
  _id?: string
  paymentLinkId?: string
  linkId?: string
  linkCode?: string
  code?: string
  customOrderId?: string
  status?: string
  event?: string
  eventName?: string
  paymentStatus?: string
  type?: string
  updatedAt?: string
  createdAt?: string
  timestamp?: string
  txHash?: string
  tx_hash?: string
  transactionId?: string
  inputTransactionHash?: string
  outTxHash?: string
  transactionHash?: string
  transaction_hash?: string
  hash?: string
  chain?: string
  chainName?: string
  network?: string
  amount?: number | string
  paidAmount?: number | string
  price?: number | string
  settlementAmount?: number | string
  token?: string
  tokenSymbol?: string
  currency?: string
  asset?: string
  fromAddress?: string
  from?: string
  sender?: string
  payer?: string
  walletAddress?: string
  toAddress?: string
  to?: string
  receiver?: string
  recipient?: string
  merchantAddress?: string
}

export type KiraPayTransactionsResponse = {
  data?: {
    transactions?: KiraPayTransactionItem[]
    totalPages?: number
  }
}

export type KiraPayTransactionStatusResponse = {
  code?: number
  message?: string
  data?:
    | {
        status?: string
        transaction?: KiraPayTransactionItem
        details?: KiraPayTransactionItem
      }
    | KiraPayTransactionItem
    | null
}

export type KiraPayWebhookResponse = {
  code?: number
  message?: string
  data?: {
    url?: string
    secret?: string
    webhookEndpoint?: {
      url?: string
      secret?: string
    }
  }
}
