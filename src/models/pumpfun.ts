export interface TokenInfo {
  mint: string
  name: string
  symbol: string
  description: string
  image_uri: string
  video_uri: string | null
  metadata_uri: string
  twitter: string | null
  telegram: string | null
  website: string | null
  bonding_curve: string
  associated_bonding_curve: string
  creator: string
  created_timestamp: number
  raydium_pool: string
  complete: boolean
  virtual_sol_reserves: number
  virtual_token_reserves: number
  total_supply: number
  show_name: boolean
  king_of_the_hill_timestamp: number
  market_cap: number
  reply_count: number
  last_reply: number
  nsfw: boolean
  market_id: string
  inverted: boolean
  is_currently_live: boolean
  hidden: null | boolean
  last_trade_timestamp: number
  real_sol_reserves: number
  real_token_reserves: number
  livestream_ban_expiry: number
  is_banned: boolean
  initialized: boolean
  updated_at: number
  pump_swap_pool: null | string
  ath_market_cap: null | number
  ath_market_cap_timestamp: null | number
}
