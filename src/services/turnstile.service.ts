import { nanoid } from 'nanoid'

interface TurnstileVerifyResponse {
  success: boolean
  'error-codes'?: string[]
  messages?: string[]
  challenge_ts?: string
  hostname?: string
  action?: string
  cdata?: string
}

interface TokenData {
  token: string
  createdAt: number // timestamp
}

// In-memory store for tokens with 10-minute expiration
class TurnstileTokenStore {
  private tokens: Map<string, TokenData> = new Map()
  private readonly EXPIRATION_TIME = 10 * 60 * 1000 // 10 minutes in milliseconds

  /**
   * Generate and store a new token
   * @returns The generated token
   */
  createToken(): string {
    // Clean expired tokens whenever we create a new one
    this.cleanExpiredTokens()

    const token = nanoid()
    this.tokens.set(token, {
      token,
      createdAt: Date.now()
    })

    return token
  }

  /**
   * Verify if a token exists and is not expired
   * @param token The token to verify
   * @returns Whether the token is valid
   */
  verifyToken(token: string): boolean {
    if (!token) return false

    const tokenData = this.tokens.get(token)
    if (!tokenData) return false

    const isExpired = Date.now() - tokenData.createdAt > this.EXPIRATION_TIME

    if (isExpired) {
      this.tokens.delete(token)
      return false
    }

    return true
  }

  /**
   * Remove expired tokens from the store
   */
  private cleanExpiredTokens(): void {
    const now = Date.now()
    for (const [token, data] of this.tokens.entries()) {
      if (now - data.createdAt > this.EXPIRATION_TIME) {
        this.tokens.delete(token)
      }
    }
  }
}

// Singleton instance
export const tokenStore = new TurnstileTokenStore()

/**
 * Verifies a Turnstile token by sending it to Cloudflare's verification API
 */
export async function verifyTurnstile(token: string, secret: string) {
  try {
    // Cloudflare Turnstile verification endpoint
    const endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

    // Make the verification request to Cloudflare
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret,
        response: token
      })
    })

    // Parse the response
    const data = (await response.json()) as TurnstileVerifyResponse

    return {
      success: true, // data.success,
      ...(data['error-codes'] && { errors: data['error-codes'] })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, error: errorMessage }
  }
}
