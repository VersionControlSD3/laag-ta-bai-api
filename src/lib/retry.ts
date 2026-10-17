const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Retries a failing async call with exponential backoff (SRS 3.3.1.3: up to 3 attempts).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 300 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await sleep(baseDelayMs * 2 ** attempt)
    }
  }
  throw lastError
}
