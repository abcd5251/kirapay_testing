import { Handler } from 'hono'
import { env } from 'hono/adapter'
import httpStatus from 'http-status'
import { createConfig } from '../../config'
import * as authService from '../../services/auth.service'
import * as emailService from '../../services/email.service'
import * as tokenService from '../../services/token.service'
import * as userService from '../../services/user.service'
import {
  clearXAuthCookies,
  createXOAuthStartUrl,
  ensureXApiCreditAccount,
  exchangeXOAuthCode,
  fetchXUserProfile,
  getFrontendAuthErrorUrl,
  getFrontendAuthSuccessUrl,
  getFrontendRedirectUrlFromRequest,
  getXSession,
  setXSession,
  verifyXOAuthState
} from '../../services/xAuth.service'
import { logger } from '../../utils/logger'
import * as authValidation from '../../validations/auth.validation'

export const register: Handler = async (c) => {
  const config = createConfig(env(c))
  const bodyParse = await c.req.json()
  const body = await authValidation.register.parseAsync(bodyParse)
  const user = await authService.register(body)

  const tokens = await tokenService.generateAuthTokens(user, config.jwt)
  return c.json({ user, tokens }, httpStatus.CREATED)
}

export const login: Handler = async (c) => {
  const config = createConfig(env(c))
  const bodyParse = await c.req.json()
  const { email, password } = authValidation.login.parse(bodyParse)
  const user = await authService.loginUserWithEmailAndPassword(email, password)
  const tokens = await tokenService.generateAuthTokens(user, config.jwt)
  return c.json({ user, tokens }, httpStatus.OK)
}

export const codeLogin: Handler = async (c) => {
  const config = createConfig(env(c))
  const bodyParse = await c.req.json()
  const { id, code } = authValidation.codeLogin.parse(bodyParse)
  const user = await authService.loginUserWithIdAndCode(id, code)
  const tokens = await tokenService.generateAuthTokens(user, config.jwt)
  return c.json({ user, tokens }, httpStatus.OK)
}

export const refreshTokens: Handler = async (c) => {
  const config = createConfig(env(c))
  const bodyParse = await c.req.json()
  const { refresh_token } = authValidation.refreshTokens.parse(bodyParse)
  const tokens = await authService.refreshAuth(refresh_token, config)
  return c.json({ ...tokens }, httpStatus.OK)
}

export const forgotPassword: Handler = async (c) => {
  const bodyParse = await c.req.json()
  const config = createConfig(env(c))
  const { email } = authValidation.forgotPassword.parse(bodyParse)
  const user = await userService.getUserByEmail(email)
  // Don't let bad actors know if the email is registered by throwing if the user exists
  if (user) {
    const resetPasswordToken = await tokenService.generateResetPasswordToken(user, config.jwt)
    await emailService.sendResetPasswordEmail(
      user.email,
      { name: user.name || '', token: resetPasswordToken },
      config
    )
  }
  c.status(httpStatus.NO_CONTENT)
  return c.body(null)
}

export const resetPassword: Handler = async (c) => {
  const queryParse = c.req.query()
  const bodyParse = await c.req.json()
  const config = createConfig(env(c))
  const { query, body } = await authValidation.resetPassword.parseAsync({
    query: queryParse,
    body: bodyParse
  })
  await authService.resetPassword(query.token, body.password, config)
  c.status(httpStatus.NO_CONTENT)
  return c.body(null)
}

export const sendVerificationEmail: Handler = async (c) => {
  const config = createConfig(env(c))
  const payload = c.get('payload')
  const userId = payload.sub
  // Don't let bad actors know if the email is registered by returning an error if the email
  // is already verified
  try {
    const user = await userService.getUserById(userId)
    if (!user || user.is_email_verified) {
      throw new Error()
    }
    const verifyEmailToken = await tokenService.generateVerifyEmailToken(user, config.jwt)
    await emailService.sendVerificationEmail(
      user.email,
      { name: user.name || '', token: verifyEmailToken },
      config
    )
  } catch {}
  c.status(httpStatus.NO_CONTENT)
  return c.body(null)
}

export const verifyEmail: Handler = async (c) => {
  const config = createConfig(env(c))
  const queryParse = c.req.query()
  const { token } = authValidation.verifyEmail.parse(queryParse)
  await authService.verifyEmail(token, config)
  c.status(httpStatus.NO_CONTENT)
  return c.body(null)
}

export const getAuthorisations: Handler = async (c) => {
  const payload = c.get('payload')
  const userId = payload.sub
  const authorisations = await userService.getAuthorisations(userId)
  return c.json(authorisations, httpStatus.OK)
}

export const startXOAuth: Handler = async (c) => {
  const frontendRedirectUrl = getFrontendRedirectUrlFromRequest(c)
  const { url } = createXOAuthStartUrl(frontendRedirectUrl)

  logger().info(
    {
      frontendRedirectUrl,
      userAgent: c.req.header('user-agent'),
      referer: c.req.header('referer')
    },
    'X OAuth flow started'
  )

  return c.redirect(url, httpStatus.FOUND)
}

export const xOAuthCallback: Handler = async (c) => {
  const query = c.req.query()

  if (query.error) {
    logger().warn(
      { error: query.error, errorDescription: query.error_description },
      'X OAuth provider returned error'
    )
    return c.redirect(getFrontendAuthErrorUrl(query.error), httpStatus.FOUND)
  }

  try {
    const { code, state } = authValidation.oauthCallback.parse(query)
    const oauthState = verifyXOAuthState(state)

    if (!oauthState) {
      logger().warn(
        { statePreview: state.slice(0, 16), userAgent: c.req.header('user-agent') },
        'X OAuth callback rejected: invalid or expired state'
      )
      clearXAuthCookies(c)
      return c.redirect(getFrontendAuthErrorUrl('invalid_state'), httpStatus.FOUND)
    }

    logger().info(
      { frontendRedirectUrl: oauthState.frontendRedirectUrl },
      'X OAuth state verified, exchanging code'
    )

    const token = await exchangeXOAuthCode({
      code,
      codeVerifier: oauthState.codeVerifier
    })
    const profile = await fetchXUserProfile(token.access_token)
    await ensureXApiCreditAccount(profile.id)

    logger().info(
      { twitterId: profile.id, username: profile.username },
      'X OAuth profile fetched and account ensured'
    )

    clearXAuthCookies(c)
    setXSession(c, {
      twitterId: profile.id,
      username: profile.username,
      name: profile.name,
      avatarUrl: profile.profile_image_url ?? null,
      profileUrl: `https://x.com/${profile.username}`
    })
    const successUrl = new URL(getFrontendAuthSuccessUrl(oauthState.frontendRedirectUrl))

    logger().info(
      {
        twitterId: profile.id,
        redirectUrl: successUrl.toString(),
        frontendRedirectUrl: oauthState.frontendRedirectUrl
      },
      'X OAuth callback redirecting directly to frontend'
    )

    return c.redirect(successUrl.toString(), httpStatus.FOUND)
  } catch (err) {
    logger().error({ err }, 'X OAuth callback failed')
    clearXAuthCookies(c)
    return c.redirect(getFrontendAuthErrorUrl('callback_failed'), httpStatus.FOUND)
  }
}

export const getXOAuthSession: Handler = async (c) => {
  const session = getXSession(c)

  if (!session) {
    return c.json(
      {
        authenticated: false
      },
      httpStatus.UNAUTHORIZED
    )
  }

  return c.json(
    {
      authenticated: true,
      session: {
        twitterId: session.twitterId,
        username: session.username,
        name: session.name,
        avatarUrl: session.avatarUrl,
        profileUrl: session.profileUrl,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt
      }
    },
    httpStatus.OK
  )
}

export const logoutXOAuthSession: Handler = async (c) => {
  clearXAuthCookies(c)
  c.status(httpStatus.NO_CONTENT)
  return c.body(null)
}
