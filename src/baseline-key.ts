import { urlToSlug } from './capture.js';
import type { BaselineLane } from './types.js';

/** Keep promoted images isolated by capture lane, just like baseline rows. */
export function baselineStorageKey(
  projectId: string,
  url: string,
  viewport: string,
  lane: BaselineLane,
): string {
  const laneSegment = `${lane.os}-${lane.runner}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${projectId}/${laneSegment}/${urlToSlug(url)}/${viewport}.png`;
}
