import jwt from '@tsndr/cloudflare-worker-jwt'
import dayjs, { Dayjs } from 'dayjs'
import { type Config } from '../config'
import { type Role, type TokenType, tokenTypes } from '../validations/token'
import { validateTokenPayload } from '@/validations/token'

export const generateToken = async (
  userId: string,
  type: TokenType,
  role: Role,
  expires: Dayjs,
  secret: string
) => {
  const payload = {
    sub: userId,
    exp: expires.unix(),
    iat: dayjs().unix(),
    type,
    role
  }
  return jwt.sign(payload, secret)
}

type User = {
  id: string
  role: Role
}

export const generateAuthTokens = async (user: User, jwtConfig: Config['jwt']) => {
  const accessTokenExpires = dayjs().add(jwtConfig.accessExpirationMinutes, 'minutes')
  const accessToken = await generateToken(
    user.id,
    tokenTypes.ACCESS,
    user.role,
    accessTokenExpires,
    jwtConfig.secret
  )
  const refreshTokenExpires = dayjs().add(jwtConfig.refreshExpirationDays, 'days')
  const refreshToken = await generateToken(
    user.id,
    tokenTypes.REFRESH,
    user.role,
    refreshTokenExpires,
    jwtConfig.secret
  )
  return {
    access: {
      token: accessToken,
      expires: accessTokenExpires.toDate()
    },
    refresh: {
      token: refreshToken,
      expires: refreshTokenExpires.toDate()
    }
  }
}

export const verifyToken = async (token: string, type: TokenType, secret: string) => {
  const isValid = await jwt.verify(token, secret)
  if (!isValid) {
    throw new Error('Token not valid')
  }
  const decoded = jwt.decode(token)
  const payload = validateTokenPayload(decoded.payload)

  if (type !== payload?.type) {
    throw new Error('Token not valid')
  }
  return payload
}

export const generateVerifyEmailToken = async (user: User, jwtConfig: Config['jwt']) => {
  const expires = dayjs().add(jwtConfig.verifyEmailExpirationMinutes, 'minutes')
  const verifyEmailToken = await generateToken(
    user.id,
    tokenTypes.VERIFY_EMAIL,
    user.role,
    expires,
    jwtConfig.secret
  )
  return verifyEmailToken
}

export const generateResetPasswordToken = async (user: User, jwtConfig: Config['jwt']) => {
  const expires = dayjs().add(jwtConfig.resetPasswordExpirationMinutes, 'minutes')
  const resetPasswordToken = await generateToken(
    user.id,
    tokenTypes.RESET_PASSWORD,
    user.role,
    expires,
    jwtConfig.secret
  )
  return resetPasswordToken
}
