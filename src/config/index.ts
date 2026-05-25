import process from 'node:process'
import * as v from 'valibot'

const configSchema = v.pipe(
  v.object({
    debug: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.boolean()), 'false'),
    logLevel: v.optional(
      v.pipe(
        v.string(),
        v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      ),
      'info'
    ),
    nodeEnv: v.optional(v.picklist(['production', 'development', 'test']), 'development'),
    frontendUrl: v.optional(v.string()),
    appBaseUrl: v.optional(v.string()),
    turnstileSecretKey: v.string(),
    turnstileInvisibleSecretKey: v.string(),
    serverHost: v.optional(v.string(), '0.0.0.0'),
    serverPort: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '80'),
    port: v.optional(v.pipe(v.string(), v.transform(Number), v.number())),
    corsOrigin: v.optional(v.string()),
    xClientId: v.optional(v.string()),
    xClientSecret: v.optional(v.string()),
    xCallbackUrl: v.optional(v.string()),
    telegramBotToken: v.optional(v.string()),
    apiCreditTopUpSecret: v.optional(v.string()),
    kirapayApiKey: v.optional(v.string()),
    kirapayApiBaseUrl: v.optional(v.string()),
    kirapayCheckoutBaseUrl: v.optional(v.string()),
    kirapayReceiverAddress: v.string(),
    sessionSecret: v.optional(v.string()),
    cookieSecure: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.boolean()), 'false'),
    cookieSameSite: v.optional(v.picklist(['lax', 'strict', 'none']), 'lax'),
    env: v.optional(v.picklist(['production', 'development', 'test'])),
    databaseUrl: v.string(),
    // JWT secret key
    jwtSecret: v.string(),
    // Minutes after which access tokens expire
    jwtAccessExpirationMinutes: v.optional(
      v.pipe(v.string(), v.transform(Number), v.number()),
      '30'
    ),
    // Days after which refresh tokens expire
    jwtRefreshExpirationDays: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '30'),
    // Minutes after which reset password token expires
    jwtResetPasswordExpirationMinutes: v.optional(
      v.pipe(v.string(), v.transform(Number), v.number()),
      '10'
    ),
    // Minutes after which verify email token expires
    jwtVerifyEmailExpirationMinutes: v.optional(
      v.pipe(v.string(), v.transform(Number), v.number()),
      '10'
    ),

    sentryDsn: v.string(),

    awsAccessKeyId: v.string(),
    awsSecretAccessKey: v.string(),
    awsRegion: v.string(),
    emailSender: v.string(),

    // rapidapi
    rapidApiKey: v.string()
  }),
  v.transform((input) => ({
    ...input,
    env: input.env ?? input.nodeEnv,
    serverPort: input.port ?? input.serverPort,
    jwt: {
      secret: input.jwtSecret,
      accessExpirationMinutes: input.jwtAccessExpirationMinutes,
      refreshExpirationDays: input.jwtRefreshExpirationDays,
      resetPasswordExpirationMinutes: input.jwtResetPasswordExpirationMinutes,
      verifyEmailExpirationMinutes: input.jwtVerifyEmailExpirationMinutes
    },
    aws: {
      accessKeyId: input.awsAccessKeyId,
      secretAccessKey: input.awsSecretAccessKey,
      region: input.awsRegion
    },
    email: {
      sender: input.emailSender
    }
  }))
)

export type Config = v.InferOutput<typeof configSchema>

function toCamelCase(str: string): string {
  return str.toLowerCase().replace(/_([a-z])/g, (_match, p1) => p1.toUpperCase())
}

type CamelCase<S extends string> = S extends `${infer P1}_${infer P2}${infer P3}`
  ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
  : Lowercase<S>

type KeysToCamelCase<T> = {
  [K in keyof T as CamelCase<string & K>]: T[K] extends object ? KeysToCamelCase<T[K]> : T[K]
}

function convertKeysToCamelCase<T>(obj: T): KeysToCamelCase<T> {
  const result: any = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelCaseKey = toCamelCase(key)
      result[camelCaseKey] = obj[key]
    }
  }
  return result
}

let cachedConfig: v.InferOutput<typeof configSchema>

export function createConfig(env: NodeJS.ProcessEnv) {
  const input = convertKeysToCamelCase(env)
  cachedConfig = v.parse(configSchema, input)
  return cachedConfig
}

function createConfigFromEnvironment() {
  if (cachedConfig) {
    return cachedConfig
  }

  try {
    process.loadEnvFile()
  } catch {
    // No .env file found
  }

  try {
    const runtimeEnv =
      typeof Bun !== 'undefined' && Bun.env
        ? {
            ...Bun.env,
            ...process.env
          }
        : {
            ...process.env
          }
    const config = createConfig(runtimeEnv)

    return config
  } catch (error) {
    throw new Error('Invalid config', {
      cause: error
    })
  }
}

export const config = createConfigFromEnvironment()
