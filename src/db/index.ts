import process from 'node:process'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '@/config'
import { logger } from '@/utils/logger'

// Parse your connection string to create separate URLs
const parseConnectionString = (url: string) => {
  const [base, params] = url.split('?')
  const [protocol, rest] = base.split('://')
  const [credentials, hosts] = rest.split('@')
  const [hostsPart, database] = hosts.split('/')
  const hostList = hostsPart.split(',')

  // If only one host, use it for both primary and read
  const primaryHost = hostList[0]
  const readHost = hostList[1] || hostList[0] // Fallback to primary if no read replica

  return {
    primary: `${protocol}://${credentials}@${primaryHost}/${database}${params ? '?' + params : ''}`,
    read: `${protocol}://${credentials}@${readHost}/${database}${params ? '?' + params : ''}`
  }
}

const { primary: PRIMARY_URL, read: READ_URL } = parseConnectionString(config.databaseUrl)

const getConnectionTargetSummary = (url: string) => {
  try {
    const parsed = new URL(url)
    return {
      database: parsed.pathname.replace(/^\//u, ''),
      host: parsed.host
    }
  } catch {
    return {
      database: 'unknown',
      host: 'unknown'
    }
  }
}

export const getDatabaseTargetSummary = () => ({
  primary: getConnectionTargetSummary(PRIMARY_URL),
  read: getConnectionTargetSummary(READ_URL)
})

// Create singleton postgres clients to avoid connection exhaustion
let primaryClient: postgres.Sql | null = null
let readClient: postgres.Sql | null = null

export const clientPostgresPrimary = () => {
  if (!primaryClient) {
    logger().info({
      message: 'Initializing primary database client',
      target: getConnectionTargetSummary(PRIMARY_URL)
    })
    primaryClient = postgres(PRIMARY_URL, {
      // With 3 workers and 500 max connections, allocate ~20 per worker for writes
      // Total: 3 workers × 20 = 60 connections (leaves 440 for reads and other uses)
      max: 50,
      idle_timeout: 60, // Close connections after 60 seconds of inactivity (increased to prevent negative timeout warnings)
      connect_timeout: 10, // Timeout after 10 seconds when connecting
      // Disable automatic reconnection timeout to prevent negative timeout warnings
      // The library will handle reconnections automatically
      onnotice: () => {} // Suppress notices to reduce noise
    })
  }
  return primaryClient
}

export const clientPostgresRead = () => {
  if (!readClient) {
    logger().info({
      message: 'Initializing read database client',
      target: getConnectionTargetSummary(READ_URL)
    })
    readClient = postgres(READ_URL, {
      // With 3 workers and 500 max connections, allocate ~80 per worker for reads
      // Total: 3 workers × 80 = 240 connections (plus 60 primary = 300 total, leaves 200 for other uses)
      max: 100,
      idle_timeout: 60, // Close connections after 60 seconds of inactivity (increased to prevent negative timeout warnings)
      connect_timeout: 10, // Timeout after 10 seconds when connecting
      // Disable automatic reconnection timeout to prevent negative timeout warnings
      // The library will handle reconnections automatically
      onnotice: () => {} // Suppress notices to reduce noise
    })
  }
  return readClient
}

export const getClient = () => {
  return clientPostgresPrimary() // Default to primary for backwards compatibility
}

// Create singleton drizzle instances
let primaryDbInstance: ReturnType<typeof drizzlePostgres> | null = null
let readDbInstance: ReturnType<typeof drizzlePostgres> | null = null
let proxyDbInstance: ReturnType<typeof drizzlePostgres> | null = null

// Enhanced db function with automatic read/write routing
const db = (client?: 'primary' | 'read') => {
  // If 'primary' is specified, force primary connection
  if (client === 'primary') {
    if (!primaryDbInstance) {
      primaryDbInstance = drizzlePostgres(clientPostgresPrimary())
    }
    return primaryDbInstance
  }

  // If 'read' is specified, force read connection
  if (client === 'read') {
    if (!readDbInstance) {
      readDbInstance = drizzlePostgres(clientPostgresRead())
    }
    return readDbInstance
  }

  // Create a proxy that intercepts method calls (only once)
  if (!proxyDbInstance) {
    const primaryDb = drizzlePostgres(clientPostgresPrimary())
    const readDb = drizzlePostgres(clientPostgresRead())

    proxyDbInstance = new Proxy(primaryDb, {
      get(target, prop) {
        // Read operations - route to read replica
        if (prop === 'select' || prop === 'selectDistinct') {
          return (readDb as any)[prop].bind(readDb)
        }

        // Write operations - route to primary
        if (prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'execute') {
          return (target as any)[prop].bind(target)
        }

        // Everything else (transactions, etc.) - route to primary
        return (target as any)[prop]
      }
    }) as ReturnType<typeof drizzlePostgres>
  }

  return proxyDbInstance
}

export async function testConnection() {
  try {
    // Run a simple query to test the connection
    await (getClient() as postgres.Sql)`SELECT 1 AS connected`
  } catch (error) {
    logger().error({
      msg: 'Error connecting to the database',
      error
    })
    // Stop the process
    process.exit(1)
  }
}

/**
 * Close all database connections
 * Useful for scripts that need to clean up before exiting
 */
export async function closeConnections() {
  try {
    if (primaryClient) {
      await primaryClient.end()
      primaryClient = null
      primaryDbInstance = null
      proxyDbInstance = null
    }
    if (readClient) {
      await readClient.end()
      readClient = null
      readDbInstance = null
    }
    logger().info('All database connections closed')
  } catch (error) {
    logger().error({
      msg: 'Error closing database connections',
      error
    })
  }
}

export default db
