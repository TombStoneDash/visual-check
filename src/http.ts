/**
 * fetch() with a deadline.
 *
 * Node's global fetch has no default timeout: a Supabase, Storage or
 * Telegram endpoint that accepts the connection and then never answers
 * would hang a deploy gate until the CI job is killed. Every outbound call
 * goes through here so a stalled service becomes a normal, catchable error.
 *
 * The deadline covers the whole exchange, including reading the body.
 * Override with VISUAL_CHECK_HTTP_TIMEOUT_MS (positive integer, ms).
 *
 * The timeout error names only the caller's label, never the URL: the
 * Telegram URL carries the bot token.
 */

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export function httpTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VISUAL_CHECK_HTTP_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_HTTP_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_HTTP_TIMEOUT_MS;
}

export class HttpTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms (set VISUAL_CHECK_HTTP_TIMEOUT_MS to change)`);
    this.name = 'HttpTimeoutError';
  }
}

function isTimeout(e: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Run `fetch(url, init)` and hand the response to `consume` (which should
 * read the body) under one deadline. Returns whatever `consume` returns.
 */
export async function fetchWithTimeout<T>(
  label: string,
  url: string,
  init: RequestInit,
  consume: (res: Response) => Promise<T>,
  timeoutMs: number = httpTimeoutMs(),
): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal });
    return await consume(res);
  } catch (e) {
    if (isTimeout(e, signal)) throw new HttpTimeoutError(label, timeoutMs);
    throw e;
  }
}
