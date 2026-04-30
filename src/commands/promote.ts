/**
 * `visual-check promote` — Phase 2.
 *
 * Reads a stored run from Supabase, copies its passed-target screenshots
 * into the baselines bucket + table with `approved: true`, and deactivates
 * any prior active baselines for those (project, url, viewport, lane).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { urlToSlug } from '../capture.js';
import * as storage from '../storage.js';
import * as db from '../db.js';
import { BaselineLane } from '../types.js';

export interface PromoteOptions {
  runId: string;
  targets?: 'all' | 'selected';
  selected?: Array<{ url: string; viewport: string }>;
  approvedBy?: string;
  /**
   * Seed mode: also accept `needs_baseline` targets. Used for the first
   * run of a new project, before any baselines exist in the cloud.
   */
  seed?: boolean;
  /**
   * Accept-fail mode: also accept `fail` targets. Used to re-baseline
   * after an intentional UI change that the gate correctly caught.
   * `error` verdicts are still rejected — those are infrastructure
   * problems (capture failed), not approvable changes.
   */
  acceptFail?: boolean;
  log?: (line: string) => void;
}

export interface PromoteResult {
  promoted: Array<{ url: string; viewport: string; storageKey: string }>;
  skipped: Array<{ url: string; viewport: string; reason: string }>;
}

async function downloadScreenshotTo(
  sourceKey: string,
  targetPath: string,
): Promise<void> {
  // Round-trip through storage: download the existing screenshot, so the
  // baseline bucket gets its own copy (keeps baselines immutable against
  // screenshot-bucket garbage collection).
  const signed = await storage.signedUrl('visual-check-screenshots', sourceKey, 60);
  const res = await fetch(signed);
  if (!res.ok) {
    throw new Error(`download screenshot failed: ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buf);
}

export async function runPromote(opts: PromoteOptions): Promise<PromoteResult> {
  const log = opts.log ?? ((l) => console.log(l));
  log(`[visual-check] promote: run=${opts.runId}`);

  const runData = await db.getRun(opts.runId);
  if (!runData) throw new Error(`Run not found: ${opts.runId}`);
  const { run, results } = runData;
  const lane = run.config.lane as BaselineLane;

  const shouldInclude = (url: string, viewport: string): boolean => {
    if (!opts.targets || opts.targets === 'all') return true;
    return (opts.selected ?? []).some((s) => s.url === url && s.viewport === viewport);
  };

  const promoted: PromoteResult['promoted'] = [];
  const skipped: PromoteResult['skipped'] = [];
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-check-promote-'));

  try {
    for (const r of results) {
      if (!shouldInclude(r.url, r.viewport)) {
        skipped.push({ url: r.url, viewport: r.viewport, reason: 'not selected' });
        continue;
      }
      const accepted =
        r.verdict === 'pass' ||
        r.verdict === 'warn' ||
        (opts.seed === true && r.verdict === 'needs_baseline') ||
        (opts.acceptFail === true && r.verdict === 'fail');
      if (!accepted) {
        skipped.push({ url: r.url, viewport: r.viewport, reason: `verdict=${r.verdict}` });
        continue;
      }
      if (!r.screenshot_path) {
        skipped.push({ url: r.url, viewport: r.viewport, reason: 'no screenshot_path' });
        continue;
      }
      const local = path.join(workDir, `${urlToSlug(r.url)}-${r.viewport}.png`);
      try {
        await downloadScreenshotTo(r.screenshot_path, local);
        const baselineKey = `${run.project_id}/${urlToSlug(r.url)}/${r.viewport}.png`;
        await storage.uploadArtifact(local, 'visual-check-baselines', baselineKey);
        await db.upsertBaseline(
          run.project_id,
          r.url,
          r.viewport,
          lane,
          baselineKey,
          run.id,
          opts.approvedBy,
        );
        promoted.push({ url: r.url, viewport: r.viewport, storageKey: baselineKey });
        log(`  ✓ ${r.url} @ ${r.viewport}`);
      } catch (e) {
        skipped.push({
          url: r.url,
          viewport: r.viewport,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  log(`[visual-check] promote: ${promoted.length} promoted, ${skipped.length} skipped`);
  return { promoted, skipped };
}
