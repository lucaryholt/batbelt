/** Exponential backoff in seconds: 1, 2, 4, ... capped at 60. */
export function backoffSeconds(retryCount: number): number {
  return Math.min(2 ** retryCount, 60);
}

/**
 * Whether another retry should be attempted.
 * maxRetries: -1 infinite, 0 none, N limited.
 * retryCount is the number of retries already performed.
 */
export function shouldRetry(manualStop: boolean, retryCount: number, maxRetries: number): boolean {
  if (manualStop) return false;
  if (maxRetries === 0) return false;
  if (maxRetries === -1) return true;
  return retryCount < maxRetries;
}
