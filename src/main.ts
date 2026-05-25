#!/usr/bin/env tsx

import process from 'node:process'
import { getDatabaseTargetSummary } from './db'

import { config } from '@/config'
import { createServer, createServerManager } from '@/server/index.js'
import { logger } from '@/utils/logger'

async function startServer() {
  const app = createServer()
  const serverManager = createServerManager(app, {
    host: config.serverHost,
    port: config.serverPort
  })

  // graceful shutdown
  onShutdown(async () => {
    logger().info('Shutdown')
    await serverManager.stop()
  })

  // start server
  const info = serverManager.start()
  logger().info({
    msg: 'Server started',
    dbTarget: getDatabaseTargetSummary(),
    url: info.url
  })
}

// Main execution
;(async () => {
  try {
    await startServer()
  } catch (error: any) {
    logger().error(error, 'Failed to start server')

    process.exit(1)
  }
})()

function onShutdown(cleanUp: () => Promise<void>) {
  let isShuttingDown = false
  const handleShutdown = async () => {
    if (isShuttingDown) return
    isShuttingDown = true
    try {
      await cleanUp()
    } catch (err) {
      logger().error(err, 'Error during shutdown')
    } finally {
      process.exit(0) // or Bun.exit(0) if you prefer
    }
  }
  process.on('SIGINT', handleShutdown)
  process.on('SIGTERM', handleShutdown)
}
