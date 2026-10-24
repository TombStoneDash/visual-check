/**
 * Basic-auth staging URLs (`https://user:token@staging.example.com/`) are
 * navigated as given, but the `user:token@` part is a secret: it must never
 * reach console output, JSON/HTML reports, receipts, Supabase rows or
 * Telegram alerts. Every place that records or prints a target URL uses
 * `stripUrlCredentials(url)` as the target's identity instead.
 *
 * Only the userinfo is removed; a URL without credentials is returned
 * byte-for-byte unchanged (no `new URL().href` normalisation), so existing
 * report URLs, DB rows and baseline lookups keep matching.
 */
const USERINFO_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/?#\\]*@/;

export function hasUrlCredentials(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.username !== '' || u.password !== '';
  } catch {
    return USERINFO_RE.test(raw);
  }
}

export function stripUrlCredentials(raw: string): string {
  if (!hasUrlCredentials(raw)) return raw;
  // The greedy `[^/?#\\]*@` ends at the last '@' of the authority, the same
  // place the WHATWG parser splits userinfo from host.
  const stripped = raw.replace(USERINFO_RE, '$1');
  if (!hasUrlCredentials(stripped)) return stripped;
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    return u.href;
  } catch {
    return raw.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/).*@/, '$1');
  }
}
