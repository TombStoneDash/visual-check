import { urlToSlug } from './capture.js';
import type { BaselineLane } from './types.js';

/**
 * The URL slug as used inside a Supabase Storage object key.
 *
 * `urlToSlug` keeps `%` so local file names stay readable for percent-encoded
 * paths (`/caf%C3%A9`, `/100%25-off`). Storage decodes the request path, so
 * such a key would become `café` or `100%-off`, and Supabase rejects keys
 * with non-ASCII characters or `%` ("Invalid key"). `!` is a key-safe
 * character that `urlToSlug` never emits, so swapping it in keeps the key
 * unambiguous. Slugs without `%` are unchanged.
 */
export function storageSlug(url: string): string {
  return urlToSlug(url).replace(/%/g, '!');
}

/** Keep promoted images isolated by capture lane, just like baseline rows. */
export function baselineStorageKey(
  projectId: string,
  url: string,
  viewport: string,
  lane: BaselineLane,
): string {
  const laneSegment = `${lane.os}-${lane.runner}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${projectId}/${laneSegment}/${storageSlug(url)}/${viewport}.png`;
}
