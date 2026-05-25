import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { LRUCache } from 'lru-cache'
import { logger } from './logger'
import db from '@/db'

type DrizzleQueryBuilder<T> = {
  toSQL(): { sql: string; params: unknown[] }
  execute(): Promise<T>
}

// Create an LRU cache to store recent queries
const recentQueriesCache = new LRUCache<
  string,
  {
    sql: string
    params: unknown[]
    timestamp: number
    pid?: number
  }
>({
  max: 1000, // Store up to 1000 recent queries
  ttl: 1000 * 5 // Keep queries for only 5 seconds
})

// Track query execution
export function trackQuery(sql: string, params: unknown[], pid?: number) {
  const timestamp = Date.now()
  const key = `${timestamp}-${Math.random().toString(36).substring(2, 9)}`
  recentQueriesCache.set(key, { sql, params, timestamp, pid })
}

// Get recent queries (within the last n milliseconds)
export function getRecentQueries(timeWindowMs: number = 5000) {
  const now = Date.now()
  const cutoff = now - timeWindowMs

  return Array.from(recentQueriesCache.entries())
    .filter(([_, value]) => value.timestamp >= cutoff)
    .map(([key, value]) => ({
      id: key,
      sql: value.sql,
      params: value.params,
      timestamp: new Date(value.timestamp),
      pid: value.pid,
      age: now - value.timestamp
    }))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}

// Add this function to monitor active transactions when deadlocks occur
export async function logActiveTransactions(db: PostgresJsDatabase) {
  try {
    const activeTransactions = await db.execute(
      sql.raw(`
      SELECT 
        blocked_locks.pid AS blocked_pid,
        blocked_activity.usename AS blocked_user,
        blocking_locks.pid AS blocking_pid,
        blocking_activity.usename AS blocking_user,
        blocked_activity.query AS blocked_query,
        blocking_activity.query AS blocking_query,
        blocked_locks.mode as blocked_mode,
        blocking_locks.mode as blocking_mode,
        blocked_locks.relation::regclass AS blocked_relation,
        blocking_locks.relation::regclass AS blocking_relation
      FROM pg_catalog.pg_locks blocked_locks
      JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_locks.pid = blocked_activity.pid
      JOIN pg_catalog.pg_locks blocking_locks ON 
        blocked_locks.transactionid = blocking_locks.transactionid AND
        blocked_locks.pid != blocking_locks.pid
      JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_locks.pid = blocking_activity.pid
      WHERE NOT blocked_locks.granted;
    `)
    )

    if (activeTransactions.length > 0) {
      logger().warn({
        activeTransactions,
        message: 'Current blocking transactions detected'
      })
    }

    return activeTransactions
  } catch (error) {
    logger().error(error, 'Failed to query active transactions')
    return []
  }
}

// Get detailed information about the indexes involved in deadlocks
export async function getDeadlockIndexInfo(dbInstance: PostgresJsDatabase, relation: string) {
  const targetRelation = relation

  try {
    // Query for active locks on the specified table
    const lockInfo = await dbInstance.execute(
      sql.raw(`
        SELECT 
          l.relation::regclass AS relation_name,
          l.locktype,
          l.mode,
          l.granted,
          l.pid,
          l.page,
          l.tuple,
          a.query,
          a.state,
          a.wait_event_type,
          a.wait_event,
          a.backend_type,
          a.backend_xid,
          a.backend_xmin
        FROM pg_locks l
        JOIN pg_stat_activity a ON l.pid = a.pid
        WHERE l.relation::regclass::text LIKE '%${targetRelation}%'
        ORDER BY l.relation, l.pid;
      `)
    )

    // Query for index information
    const indexInfo = await dbInstance.execute(
      sql.raw(`
        SELECT 
          i.relname AS index_name,
          a.attname AS column_name,
          ix.indisprimary AS is_primary,
          ix.indisunique AS is_unique,
          am.amname AS index_type
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_am am ON i.relam = am.oid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE t.relname = '${targetRelation}'
        ORDER BY i.relname, a.attnum;
      `)
    )

    return { lockInfo, indexInfo }
  } catch (error) {
    logger().error(error, `Failed to get index info for relation ${targetRelation}`)
    return { lockInfo: [], indexInfo: [] }
  }
}

// Handle and log deadlock errors with comprehensive information
export async function handleDeadlockError(error: any, dbInstance: PostgresJsDatabase) {
  if (error.code === '40P01') {
    // Extract relation from error message if available
    const relationMatch = error.message?.match(/in relation "([^"]+)"/)

    // Log recent queries that might have contributed to the deadlock
    const recentQueries = getRecentQueries(5000) // Get queries from last 5 seconds

    logger().error({
      error: {
        code: error.code,
        message: error.message,
        detail: error.detail
      },
      recentQueries,
      message: 'Deadlock detected - Recent queries (last 5 seconds)'
    })

    // Get active transactions info
    const activeTransactions = await logActiveTransactions(dbInstance)

    // Only get index info if we have a relation match
    let lockInfo: any[] = []
    let indexInfo: any[] = []

    if (relationMatch) {
      const relation = relationMatch[1]
      const deadlockIndexData = await getDeadlockIndexInfo(dbInstance, relation)
      lockInfo = deadlockIndexData.lockInfo
      indexInfo = deadlockIndexData.indexInfo

      logger().error({
        lockInfo,
        indexInfo,
        message: `Deadlock details for relation: ${relation}`
      })
    } else {
      logger().error({
        message: 'Deadlock detected but relation name could not be determined from error message'
      })
    }

    // Return comprehensive information that can be used for debugging
    return {
      error,
      recentQueries,
      activeTransactions,
      ...(relationMatch ? { lockInfo, indexInfo } : {})
    }
  }

  // For non-deadlock errors, just return the error
  return { error }
}

/**
 * Wraps a database operation and preserves the stack trace if an error occurs.
 * Includes retry logic for recovery conflicts (error 40001) on read replicas.
 * @param operation - Description of the database operation for error context
 * @param dbCall - Either a Drizzle query builder or a function returning a Promise
 * @param maxRetries - Maximum number of retries for recovery conflicts (default: 3)
 * @returns The result of the database operation
 */
export async function withDbError<T>(
  dbCall: DrizzleQueryBuilder<T> | (() => Promise<T>),
  maxRetries: number = 3
): Promise<T> {
  if (!('toSQL' in dbCall)) {
    throw new Error('Invalid database call')
  }

  // Capture the stack trace at the point of calling withDbError
  const callerStack = new Error().stack?.split('\n').slice(2).join('\n') || ''

  let lastError: any
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      // Track this query before execution
      const sqlInfo = dbCall.toSQL()

      trackQuery(sqlInfo.sql, sqlInfo.params)

      return await dbCall.execute()
    } catch (error: any) {
      lastError = error

      // Retry on recovery conflict (error 40001) - happens on read replicas
      if (error.code === '40001' && attempt < maxRetries) {
        attempt++
        // Exponential backoff: 50ms, 100ms, 200ms
        const delay = Math.min(50 * Math.pow(2, attempt - 1), 500)
        logger().warn(
          {
            error: {
              code: error.code,
              message: error.message,
              detail: error.detail
            },
            attempt,
            maxRetries,
            delay
          },
          `Recovery conflict detected, retrying query (attempt ${attempt}/${maxRetries})`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      // Get the SQL that was being executed when the error occurred
      let sqlInfo = 'Unable to retrieve SQL query'
      try {
        const sql = dbCall.toSQL()
        sqlInfo = JSON.stringify(sql)
      } catch (sqlError) {
        sqlInfo = `Error retrieving SQL: ${(sqlError as Error).message}`
      }

      // Combine the stacks: caller stack first, then original error
      const enhancedError = Object.assign(new Error(error.message), error)
      enhancedError.stack = `Error: Database operation failed\n${callerStack}\nSQL: ${sqlInfo}\nCaused by: ${error.stack}`

      // Handle deadlock errors with detailed diagnostics
      if (error.code === '40P01') {
        handleDeadlockError(error, db() as PostgresJsDatabase)
      }

      // Log the error with operation context
      logger().error(
        {
          error: enhancedError,
          stack: enhancedError.stack,
          sqlInfo,
          attempts: attempt + 1
        },
        `Database operation failed`
      )

      throw enhancedError
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError
}

/**
 * Wraps a raw SQL query and preserves the stack trace if an error occurs.
 * @param sqlQuery - The raw SQL query from sql.raw()
 * @param tx - Optional transaction object
 * @returns The result of the database operation
 */
export async function withRawSqlError<T = Record<string, unknown>[]>(
  sqlQuery: ReturnType<typeof sql.raw>,
  tx?: PostgresJsDatabase
): Promise<T> {
  // Capture the stack trace at the point of calling withRawSqlError
  const callerStack = new Error().stack?.split('\n').slice(2).join('\n') || ''

  try {
    return (await (tx || db()).execute(sqlQuery)) as T
  } catch (error: any) {
    // Format the SQL query using pgDialect
    let sqlInfo = 'Unable to retrieve SQL query'
    try {
      const pgDialect = new PgDialect()
      const formattedSql = pgDialect.sqlToQuery(sqlQuery)
      sqlInfo = JSON.stringify(formattedSql)
    } catch (sqlError) {
      sqlInfo = `Error formatting SQL: ${(sqlError as Error).message}`
    }

    // Combine the stacks: caller stack first, then original error
    const enhancedError = Object.assign(new Error(error.message), error)
    enhancedError.stack = `Error: Raw SQL operation failed\n${callerStack}\nSQL: ${sqlInfo}\nCaused by: ${error.stack}`

    // Log the error with operation context
    logger().error(
      {
        error: enhancedError,
        stack: enhancedError.stack,
        sqlInfo
      },
      `Raw SQL operation failed`
    )

    throw enhancedError
  }
}
