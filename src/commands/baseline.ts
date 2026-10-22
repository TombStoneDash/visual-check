/**
 * `visual-check baseline` — capture local baseline screenshots.
 *
 * A baseline is only saved when the capture finished and the page answered
 * with a healthy HTTP status (2xx/3xx), the same rule `compare` applies to
 * its baseline side. A 404/500 error page, a hosting "deployment not found"
 * page or a failed navigation is never written as the approved picture, and
 * an existing baseline for that target is left untouched: each capture goes
 * to a temporary sibling file and only replaces the baseline once it passes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Capturer, urlToSlug } from '../capture.js';
import { checkHttpStatus } from '../checks.js';
import { CaptureArtifact, ViewportSpec } from '../types.js';

/** The subset of Capturer that baseline capture needs (lets tests stub it). */
export interface BaselineCapturer {
  start(): Promise<void>;
  stop(): Promise<void>;
  capture(url: string, viewport: ViewportSpec, outputPath: string): Promise<CaptureArtifact>;
}

export interface BaselineOptions {
  urls: string[];
  viewports: ViewportSpec[];
  /** Workspace root; baselines land in `<root>/baselines/<slug>/<viewport>.png`. */
  root: string;
  headless?: boolean;
  capturer?: BaselineCapturer;
  log?: (line: string) => void;
}

export interface BaselineOutcome {
  url: string;
  viewport: string;
  path: string;
  saved: boolean;
  /** Why the capture was not saved; absent when saved. */
  reason?: string;
}

export interface BaselineResult {
  baselineRoot: string;
  outcomes: BaselineOutcome[];
  failures: number;
}

export function baselinePathFor(root: string, url: string, viewport: string): string {
  return path.join(root, 'baselines', urlToSlug(url), `${viewport}.png`);
}

/** Null when the capture is usable as a baseline, else the reason it is not. */
export function baselineRejectionReason(cap: CaptureArtifact): string | null {
  if (cap.error) return `capture error: ${cap.error}`;
  const http = checkHttpStatus(cap);
  if (http.status !== 'pass') return http.message;
  return null;
}

export async function runBaseline(opts: BaselineOptions): Promise<BaselineResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const baselineRoot = path.join(opts.root, 'baselines');
  const capturer = opts.capturer ?? new Capturer({ headless: opts.headless ?? true });

  log(
    `[visual-check] baseline: ${opts.urls.length} URL(s) × ${opts.viewports.length} viewport(s) → ${baselineRoot}`,
  );

  const outcomes: BaselineOutcome[] = [];
  await capturer.start();
  try {
    for (const url of opts.urls) {
      for (const vp of opts.viewports) {
        const outPath = baselinePathFor(opts.root, url, vp.name);
        const pendingPath = `${outPath.slice(0, -'.png'.length)}.pending-${process.pid}.png`;
        const cap = await capturer.capture(url, vp, pendingPath);
        const reason = baselineRejectionReason(cap);
        if (reason === null) {
          await fs.rename(pendingPath, outPath);
          outcomes.push({ url, viewport: vp.name, path: outPath, saved: true });
          log(
            `  ${url} @ ${vp.name} ... OK (HTTP ${cap.httpStatus}, ${cap.loadTimeMs}ms) → ${path.relative(opts.root, outPath)}`,
          );
        } else {
          await fs.rm(pendingPath, { force: true });
          // Drop the per-target folder the capture created if nothing else is in it.
          await fs.rmdir(path.dirname(outPath)).catch(() => {});
          outcomes.push({ url, viewport: vp.name, path: outPath, saved: false, reason });
          log(`  ${url} @ ${vp.name} ... NOT SAVED: ${reason}`);
        }
      }
    }
  } finally {
    await capturer.stop();
  }

  return {
    baselineRoot,
    outcomes,
    failures: outcomes.filter((o) => !o.saved).length,
  };
}
