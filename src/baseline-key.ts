import { urlToSlug } from './capture.js';
import type { BaselineLane } from './types.js';

/**
 * Keep promoted images isolated by capture lane, just like baseline rows.
 *
 * With `runId`, each promotion gets its own object, so promoting again never
 * overwrites the image an older (now unapproved) baseline row points to, and a
 * promote whose DB write fails cannot swap the bytes under the approved row.
 */
export function baselineStorageKey(
  projectId: string,
  url: string,
  viewport: string,
  lane: BaselineLane,
  runId?: string,
): string {
  const laneSegment = `${lane.os}-${lane.runner}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const runSegment = runId ? `-${runId.replace(/[^A-Za-z0-9_-]/g, '-')}` : '';
  return `${projectId}/${laneSegment}/${urlToSlug(url)}/${viewport}${runSegment}.png`;
}
