import { sql } from 'drizzle-orm'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { describe, expect, it, vi } from 'vitest'
import { withDbError, withRawSqlError } from './db'

// Mock the db module first
vi.mock('@/db', () => {
  const mockExecute = vi.fn()
  const mockDb = {
    execute: mockExecute
  }
  return {
    default: mockDb
  }
})

// Get the mocked db instance
const mockDb = (await import('@/db')).default as unknown as { execute: ReturnType<typeof vi.fn> }

// Define custom error type for PostgreSQL errors
interface PostgresError extends Error {
  code?: string
  detail?: string
}

describe('withDbError', () => {
  it('should enhance error with stack trace and SQL info', async () => {
    // Create a mock query builder
    const mockQueryBuilder = {
      toSQL: () => ({
        sql: 'SELECT * FROM test',
        params: []
      }),
      execute: vi.fn().mockRejectedValue(new Error('Database error'))
    }

    // Mock the db.execute to throw an error
    mockDb.execute.mockRejectedValueOnce(new Error('Database error'))

    try {
      await withDbError(mockQueryBuilder)
      throw new Error('Expected error to be thrown')
    } catch (error: any) {
      // Verify the error is enhanced
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Database error')
      expect(error.stack).toContain('Database operation failed')
      expect(error.stack).toContain('SELECT * FROM test')
      expect(error.stack).toContain('Caused by: Error: Database error')
    }
  })

  it('should preserve original error properties', async () => {
    // Create a custom error with additional properties
    const customError = new Error('Custom database error') as PostgresError
    customError.code = '42P01' // Example PostgreSQL error code
    customError.detail = 'Table does not exist'

    const mockQueryBuilder = {
      toSQL: () => ({
        sql: 'SELECT * FROM nonexistent',
        params: []
      }),
      execute: vi.fn().mockRejectedValue(customError)
    }

    try {
      await withDbError(mockQueryBuilder)
      throw new Error('Expected error to be thrown')
    } catch (error: any) {
      // Verify original error properties are preserved
      expect(error.message).toBe('Custom database error')
      expect(error.code).toBe('42P01')
      expect(error.detail).toBe('Table does not exist')
      expect(error.stack).toContain('Database operation failed')
    }
  })
})

describe('withRawSqlError', () => {
  it.skip('should enhance error with stack trace and SQL info', async () => {
    const sqlQuery = sql.raw('SELECT * FROM test')
    const dbError = new Error('Raw SQL error')

    // Mock the db.execute to throw an error
    mockDb.execute.mockRejectedValueOnce(dbError)

    try {
      await withRawSqlError(sqlQuery)
      throw new Error('Expected error to be thrown')
    } catch (error: any) {
      // Verify the error is enhanced
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Raw SQL error')
      expect(error.stack).toContain('Raw SQL operation failed')
      expect(error.stack).toContain('Caused by: Error: Raw SQL error')
    }
  })

  it.skip('should preserve original error properties with raw SQL', async () => {
    const sqlQuery = sql.raw('SELECT * FROM nonexistent')
    const customError = new Error('Custom raw SQL error') as PostgresError
    customError.code = '42P01'
    customError.detail = 'Table does not exist'

    // Mock the db.execute to throw an error
    mockDb.execute.mockRejectedValueOnce(customError)

    try {
      await withRawSqlError(sqlQuery)
      throw new Error('Expected error to be thrown')
    } catch (error: any) {
      // Verify original error properties are preserved
      expect(error.message).toBe('Custom raw SQL error')
      expect(error.code).toBe('42P01')
      expect(error.detail).toBe('Table does not exist')
      expect(error.stack).toContain('Raw SQL operation failed')
    }
  })

  it('should work with transaction', async () => {
    const sqlQuery = sql.raw('SELECT * FROM test')
    const mockTx = {
      execute: vi.fn().mockRejectedValue(new Error('Transaction error'))
    } as unknown as PostgresJsDatabase

    try {
      await withRawSqlError(sqlQuery, mockTx)
      throw new Error('Expected error to be thrown')
    } catch (error: any) {
      expect(error.message).toBe('Transaction error')
      expect(error.stack).toContain('Raw SQL operation failed')
    }
  })
})
