import { z } from 'zod'
import { roleRights, roles, type Permission, type Role } from '../config/roles'
import { tokenTypes, type TokenType } from '../config/tokens'

// Validation schemas
const roleSchema = z.enum(roles as [Role])
const tokenTypeSchema = z.enum(Object.values(tokenTypes) as [TokenType])

export const tokenPayloadSchema = z
  .object({
    sub: z.string().min(1, 'Subject (user ID) is required'),
    exp: z.number().positive('Expiration time must be positive'),
    iat: z.number().positive('Issued at time must be positive'),
    type: tokenTypeSchema,
    role: roleSchema
  })
  .refine(
    (data) => {
      // Check if token is not expired
      const now = Math.floor(Date.now() / 1000)
      return data.exp > now
    },
    {
      message: 'Token has expired'
    }
  )

export interface TokenPayload {
  sub: string
  exp: number
  iat: number
  type: TokenType
  role: Role
}

export const validateTokenPayload = (payload: any): TokenPayload | null => {
  try {
    return tokenPayloadSchema.parse(payload)
  } catch {
    return null
  }
}

// Re-export for convenience
export { roleRights, roles, tokenTypes, type Permission, type Role, type TokenType }
