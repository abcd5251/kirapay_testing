import { logger } from '@/utils/logger'

// Generic timeout wrapper
export async function withTimeout<T>(
  promise: Promise<T>,
  operationName: string,
  timeoutMs = 10000
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timeout: ${operationName} took longer than ${timeoutMs}ms`)),
        timeoutMs
      )
    })
  ])
}

// Generic retry wrapper
export async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1)
        logger().info(
          `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${error.message}`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

/**
 * A simpler function-based implementation of the smart racer
 */
export function createSmartRacer<T>(functionNames: string[]) {
  let lastWinner: number | null = null
  let lastWinnerTimestamp = 0
  const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

  return async function execute(functions: Array<() => Promise<T>>): Promise<T> {
    if (functions.length === 0) {
      throw new Error('No functions provided')
    }

    // Check if we need to race again (first run or cache expired)
    const shouldRace = lastWinner === null || Date.now() - lastWinnerTimestamp > CACHE_TTL_MS

    if (shouldRace) {
      // Track first function completion
      let firstFunctionResult: { result: T; duration: number } | undefined
      let firstFunctionResolved = false

      // Race all functions
      const wrappedFunctions = functions.map((fn, index) =>
        (async () => {
          const fnStart = Date.now()
          const result = await fn()
          const duration = Date.now() - fnStart

          // If this is the first function, store its result
          if (index === 0) {
            firstFunctionResult = { result, duration }
            firstFunctionResolved = true
          }

          logger().info(`[SmartRacer] ${functionNames[index]} resolved in ${duration}ms`)
          return { result, index, duration }
        })()
      )

      try {
        const { result, index, duration } = await Promise.any(wrappedFunctions)
        // If the first function won, use it immediately
        if (index === 0) {
          lastWinner = 0
          lastWinnerTimestamp = Date.now()
          logger().info(`[SmartRacer] Winner: ${functionNames[0]}, duration: ${duration}ms`)
          return result
        }

        // Another function won, but wait 500 ms to see if first function completes
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Check if first function resolved during the wait
        if (firstFunctionResolved && firstFunctionResult) {
          lastWinner = 0
          lastWinnerTimestamp = Date.now()
          logger().info(
            `[SmartRacer] Prioritizing first function: ${functionNames[0]}, duration: ${firstFunctionResult.duration}ms (waited 500ms)`
          )
          return firstFunctionResult.result
        } else {
          // First function didn't complete, use the original winner
          lastWinner = index
          lastWinnerTimestamp = Date.now()
          logger().info(`[SmartRacer] Winner: ${functionNames[index]}, duration: ${duration}ms`)
          return result
        }
      } catch (error) {
        logger().error(error, `[SmartRacer] All functions failed: ${functionNames.join(', ')}`)
        throw error
      }
    } else {
      // Try the previous winner first, fall back to others if it fails
      try {
        const result = await functions[lastWinner!]()
        return result
      } catch (error) {
        logger().warn(
          error,
          `[SmartRacer] Previous winner (${functionNames[lastWinner!]}) failed, trying others`
        )

        // Try remaining functions in order
        for (let i = 0; i < functions.length; i++) {
          if (i === lastWinner) continue

          try {
            const ret = await functions[i]()
            lastWinner = null
            return ret
          } catch {
            logger().warn(
              error,
              `[SmartRacer] Other function (${functionNames[lastWinner!]}) failed, trying next`
            )
          }
        }

        // If we get here, all functions failed
        const errorMsg = `[SmartRacer] All functions failed: ${functionNames.join(', ')}`
        logger().error(error, errorMsg)
        throw new Error(errorMsg)
      }
    }
  }
}
