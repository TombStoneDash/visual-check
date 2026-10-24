/**
 * `visual-check baseline` — capture local baselines.
 *
 * Each picture is captured to a temporary file next to its baseline and only
 * renamed into place when the capture completed and the page answered with a
 * healthy HTTP status (the same `http_status` check `run` applies). A 404
 * page, a navigation error or a crash mid-capture therefore never replaces —
 * or deletes — an approved baseline.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sanitizeCaptureError, urlToSlug } from '../capture.js';
import { checkHttpStatus } from '../checks.js';
import type { CaptureArtifact, ViewportSpec } from '../types.js';

export interface BaselineCapturer {
  capture(url: string, viewport: ViewportSpec, outputPath: string): Promise<CaptureArtifact>;
}

export interface BaselineOptions {
  urls: string[];
  viewports: ViewportSpec[];
  /** Workspace root; baselines go under `<root>/baselines/`. */
  root: string;
  capturer: BaselineCapturer;
  /** Called once per target with the progress line (no trailing newline). */
  log?: (line: string) => void;
}

export interface BaselineTargetResult {
  url: string;
  viewport: string;
  baseline: string;
  saved: boolean;
  /** Why the picture was not saved; null when saved. */
  reason: string | null;
  httpStatus: number | null;
  loadTimeMs: number;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function runBaseline(opts: BaselineOptions): Promise<BaselineTargetResult[]> {
  const log = opts.log ?? ((line) => console.log(line));
  const root = path.resolve(opts.root);
  const baselineRoot = path.join(root, 'baselines');
  const results: BaselineTargetResult[] = [];

  for (const url of opts.urls) {
    const slug = urlToSlug(url);
    for (const vp of opts.viewports) {
      const dest = path.join(baselineRoot, slug, `${vp.name}.png`);
      // Same directory as the baseline so the final rename is atomic.
      const tmp = path.join(
        baselineRoot,
        slug,
        `.${vp.name}.capturing-${process.pid}-${randomBytes(4).toString('hex')}.png`,
      );
      const hadBaseline = await exists(dest);
      const kept = hadBaseline ? ' — existing baseline kept' : '';

      let result: BaselineTargetResult;
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const cap = await opts.capturer.capture(url, vp, tmp);
        const http = checkHttpStatus(cap);
        const base = { url, viewport: vp.name, baseline: dest, httpStatus: cap.httpStatus, loadTimeMs: cap.loadTimeMs };

        if (http.status !== 'pass') {
          result = { ...base, saved: false, reason: cap.error ? `ERROR: ${sanitizeCaptureError(cap.error)}` : `NOT SAVED: ${http.message}` };
        } else if (!(await exists(tmp))) {
          result = { ...base, saved: false, reason: 'ERROR: the capture wrote no screenshot' };
        } else {
          await fs.rename(tmp, dest);
          result = { ...base, saved: true, reason: null };
        }
      } catch (err) {
        result = {
          url,
          viewport: vp.name,
          baseline: dest,
          saved: false,
          reason: `ERROR: ${sanitizeCaptureError(err instanceof Error ? err.message : String(err))}`,
          httpStatus: null,
          loadTimeMs: 0,
        };
      } finally {
        await fs.rm(tmp, { force: true });
      }
      // Don't leave an empty slug folder behind for a target that never got a baseline.
      if (!result.saved && !hadBaseline) await fs.rmdir(path.dirname(dest)).catch(() => {});

      log(
        result.saved
          ? `  ${url} @ ${vp.name} ... OK (HTTP ${result.httpStatus ?? '—'}, ${result.loadTimeMs}ms) → ${path.relative(root, dest)}`
          : `  ${url} @ ${vp.name} ... ${result.reason}${kept}`,
      );
      results.push(result);
    }
  }

  return results;
}
