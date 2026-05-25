import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSmartRacer } from './apiWrappers'

// Mock the logger
vi.mock('@/utils/logger', () => ({
  logger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  })
}))

describe('createSmartRacer', () => {
  beforeEach(() => {
    // Reset mocks and timers before each test
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('should return the result of the fastest function', async () => {
    const racer = createSmartRacer(['slow', 'fast', 'medium'])

    const slowFn = () => new Promise((resolve) => setTimeout(() => resolve('slow result'), 300))
    const fastFn = () => new Promise((resolve) => setTimeout(() => resolve('fast result'), 100))
    const mediumFn = () => new Promise((resolve) => setTimeout(() => resolve('medium result'), 200))

    const promise = racer([slowFn, fastFn, mediumFn])

    // Advance timers to complete all promises
    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('fast result')
  })

  it('should throw an error when no functions are provided', async () => {
    const racer = createSmartRacer(['test'])
    await expect(racer([])).rejects.toThrow('No functions provided')
  })

  it('should throw an error when all functions fail', async () => {
    const racer = createSmartRacer(['fn1', 'fn2'])

    const fn1 = () => Promise.reject(new Error('fn1 error'))
    const fn2 = () => Promise.reject(new Error('fn2 error'))

    await expect(racer([fn1, fn2])).rejects.toThrow()
  })

  it('should use the cached winner without racing on subsequent calls', async () => {
    const racer = createSmartRacer(['slow', 'fast', 'medium'])

    // First call - should race and pick the fastest
    const slowFn = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('slow'), 300)))
    const fastFn = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('fast'), 100)))
    const mediumFn = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('medium'), 200)))

    let promise = racer([slowFn, fastFn, mediumFn])
    await vi.runAllTimersAsync()
    let result = await promise
    expect(result).toBe('fast')
    expect(fastFn).toHaveBeenCalledTimes(1)
    expect(slowFn).toHaveBeenCalledTimes(1)
    expect(mediumFn).toHaveBeenCalledTimes(1)

    // Reset call counts
    slowFn.mockClear()
    fastFn.mockClear()
    mediumFn.mockClear()

    // Second call - should use cached winner (fastFn) without racing
    promise = racer([slowFn, fastFn, mediumFn])
    await vi.runAllTimersAsync()
    result = await promise
    expect(result).toBe('fast')
    expect(fastFn).toHaveBeenCalledTimes(1)
    expect(slowFn).toHaveBeenCalledTimes(0)
    expect(mediumFn).toHaveBeenCalledTimes(0)
  })

  it('should fall back to other functions if the cached winner fails', async () => {
    const racer = createSmartRacer(['failing', 'working'])

    // First call - failingFn is faster
    const failingFn = vi.fn().mockImplementation(() => Promise.resolve('first result'))
    const workingFn = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('backup result'), 100))
      )

    // First call establishes failingFn as the winner
    let result = await racer([failingFn, workingFn])
    expect(result).toBe('first result')
    expect(failingFn).toHaveBeenCalledTimes(1)

    // Reset mocks
    failingFn.mockClear()
    workingFn.mockClear()

    // Second call - now the cached winner fails
    failingFn.mockImplementation(() => Promise.reject(new Error('now failing')))

    const promise = racer([failingFn, workingFn])
    // Advance timers to complete the setTimeout in workingFn
    await vi.runAllTimersAsync()

    result = await promise

    expect(result).toBe('backup result')
    expect(failingFn).toHaveBeenCalledTimes(1)
    expect(workingFn).toHaveBeenCalledTimes(1)
  })

  it('should race again after cache expires', async () => {
    const racer = createSmartRacer(['slow', 'fast'])

    // Make clear timing differences to ensure consistent results
    const slowFn = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('slow result'), 200))
      )
    const fastFn = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('fast result'), 10))
      )

    // First call - both get called in race
    let promise = racer([slowFn, fastFn])
    await vi.runAllTimersAsync()
    await promise

    expect(slowFn).toHaveBeenCalledTimes(1)
    expect(fastFn).toHaveBeenCalledTimes(1)

    // Reset mocks
    slowFn.mockClear()
    fastFn.mockClear()

    // Second call shortly after - should use cached winner (fastFn at index 1)
    promise = racer([slowFn, fastFn])
    await vi.runAllTimersAsync()
    await promise

    expect(fastFn).toHaveBeenCalledTimes(1)
    expect(slowFn).toHaveBeenCalledTimes(0)

    // Reset mocks
    slowFn.mockClear()
    fastFn.mockClear()

    // Advance time past cache expiration (10 minutes)
    vi.advanceTimersByTime(11 * 60 * 1000)

    // Third call after cache expired - should race again
    promise = racer([slowFn, fastFn])
    await vi.runAllTimersAsync()
    await promise

    expect(slowFn).toHaveBeenCalledTimes(1)
    expect(fastFn).toHaveBeenCalledTimes(1)
  })
})
