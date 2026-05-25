import { pino } from 'pino'
import { config } from '@/config'

let instance: pino.Logger
/* eslint no-console: "off" */

export const logger = () => {
  if (instance) {
    return instance
  }
  instance = pino({
    timestamp: pino.stdTimeFunctions.isoTime,
    // browser setting is for cf worker
    browser: {
      asObject: true,
      serialize: true,
      formatters: {
        level(label, _number) {
          return { level: label.toUpperCase() }
        }
      },
      write: (o: any) => {
        if (config.env === 'development') {
          const { time, level, msg, ...rest } = o
          const paddedLevel = level.padEnd(5, ' ')
          let logMessage = `[${time}] ${paddedLevel}: ${msg ? msg : ''}`

          // Check if rest has any properties
          if (Object.keys(rest).length > 0) {
            logMessage += `\n${JSON.stringify(rest, undefined, 2).replace(/\\n/g, '\n')}`
          }

          console.log(logMessage)
        } else if (config.env === 'production') {
          console.log(JSON.stringify(o))
        }
      }
    },

    level: config.logLevel,
    transport: {
      targets: [
        ...(config.env === 'development'
          ? [
              {
                target: 'pino-pretty',
                level: config.logLevel,
                options: {
                  ignore: 'pid,hostname',
                  colorize: true,
                  translateTime: true
                }
              }
            ]
          : [
              {
                target: 'pino/file',
                level: config.logLevel,
                options: {}
              }
            ])
      ]
    }
  })
  return instance
}

export type Logger = pino.Logger
