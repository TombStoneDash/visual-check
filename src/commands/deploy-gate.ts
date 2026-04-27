/**
 * `visual-check deploy-gate` — Phase 2.
 *
 * Runs the existing capture+diff logic, but with baselines pulled from and
 * artifacts pushed to Supabase so any runner (Mac Mini, Lenovo, cloud)
 * sees the same truth. On a non-pass verdict, fires a Telegram alert
 * with a signed URL to the HTML report.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Capturer, urlToSlug } from '../capture.js';
import { diffPngs, fileExists } from '../diff.js';
import { buildTargetResult } from '../checks.js';
import { buildReport, formatSummary, formatTargetLine, writeJsonReport } from '../report.js';
import { renderHtmlReport, htmlReportPathFor } from '../html-report.js';
import { runPool } from '../pool.js';
import * as storage from '../storage.js';
import * as db from '../db.js';
import * as alerts from '../alerts.js';
import {
  BaselineLane,
  CaptureArtifact,
  RunReport,
  TargetResult,
  ViewportSpec,
} from '../types.js';

export interface DeployGateOptions {
  urls: string[];
  viewports: ViewportSpec[];
  outRoot: string;
  threshold: number;
  loadTimeWarnMs: number;
  concurrency: number;
  projectId: string;
  deploymentUrl: string;
  branch?: string;
  commitSha?: string;
  lane: BaselineLane;
  headless?: boolean;
  signedUrlTtlSeconds?: number;
  quiet?: boolean;
  jsonOutPath?: string;
  htmlOutPath?: string;
  log?: (line: string) => void;
}

export interface DeployGateResult {
  report: RunReport;
  signedReportUrl: string | null;
  alertSent: boolean;
}

const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days

export async function runDeployGate(opts: DeployGateOptions): Promise<DeployGateResult> {
  const log = opts.log ?? (opts.quiet ? () => {} : (l) => console.log(l));
  const root = path.resolve(opts.outRoot);
  const baselineRoot = path.join(root, 'baselines');
  const dateStr = new Date().toISOString().slice(0, 10);
  const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const captureRoot = path.join(root, 'captures', dateStr, timeStamp);
  const diffRoot = path.join(root, 'diffs', dateStr, timeStamp);
  const ttl = opts.signedUrlTtlSeconds ?? DEFAULT_TTL;

  log(
    `[visual-check] deploy-gate: project=${opts.projectId} urls=${opts.urls.length} viewports=${opts.viewports.length} lane=${opts.lane.os}/${opts.lane.runner}`,
  );

  // --- Step 1: pull baselines for each (url, viewport) from Supabase -------
  type Target = {
    url: string;
    vp: ViewportSpec;
    capPath: string;
    basePath: string;
    diffPath: string;
    hasBaseline: boolean;
  };
  const targets: Target[] = [];
  for (const url of opts.urls) {
    const slug = urlToSlug(url);
    for (const vp of opts.viewports) {
      const capPath = path.join(captureRoot, slug, `${vp.name}.png`);
      const basePath = path.join(baselineRoot, slug, `${vp.name}.png`);
      const diffPath = path.join(diffRoot, slug, `${vp.name}.png`);
      let hasBaseline = false;
      try {
        const resolved = await storage.downloadBaseline(
          opts.projectId,
          url,
          vp.name,
          opts.lane,
          basePath,
        );
        hasBaseline = resolved !== null;
      } catch (e) {
        log(
          `  [warn] baseline fetch failed for ${url} @ ${vp.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      targets.push({ url, vp, capPath, basePath, diffPath, hasBaseline });
    }
  }

  // --- Step 2: capture + diff (reuse V1 core, concurrency-pooled) ----------
  const capturer = new Capturer({ headless: opts.headless ?? true });
  await capturer.start();
  const results: TargetResult[] = new Array(targets.length);
  try {
    const runOne = async (t: Target): Promise<TargetResult> => {
      const cap: CaptureArtifact = await capturer.capture(t.url, t.vp, t.capPath);
      const baselineExists = !cap.error && t.hasBaseline && (await fileExists(t.basePath));
      let diff = null;
      if (!cap.error && baselineExists) {
        try {
          diff = await diffPngs(t.basePath, t.capPath, t.diffPath);
        } catch {
          diff = null;
        }
      }
      return buildTargetResult({
        cap,
        diff,
        baselineExists,
        baselinePath: t.basePath,
        pixelDiffThresholdPct: opts.threshold,
        loadTimeWarnMs: opts.loadTimeWarnMs,
      });
    };

    const pooled = await runPool(
      targets.map((t) => () => runOne(t)),
      opts.concurrency,
      (r) => {
        if (opts.quiet) return;
        if (r.ok) log('  ' + formatTargetLine(r.value));
        else
          log(
            `  ERROR         ${targets[r.index]!.url} @ ${targets[r.index]!.vp.name} — ${r.error.message}`,
          );
      },
    );
    for (const r of pooled) {
      if (r.ok) {
        results[r.index] = r.value;
      } else {
        const t = targets[r.index]!;
        results[r.index] = buildTargetResult({
          cap: {
            url: t.url,
            viewport: t.vp.name,
            screenshotPath: t.capPath,
            httpStatus: null,
            consoleErrors: [],
            loadTimeMs: 0,
            error: r.error.message,
          },
          diff: null,
          baselineExists: false,
          baselinePath: t.basePath,
          pixelDiffThresholdPct: opts.threshold,
          loadTimeWarnMs: opts.loadTimeWarnMs,
        });
      }
    }
  } finally {
    await capturer.stop();
  }

  // --- Step 3: assemble the report with Phase 2 context --------------------
  const report: RunReport = {
    ...buildReport({
      urls: opts.urls,
      viewports: opts.viewports,
      pixelDiffThreshold: opts.threshold,
      loadTimeWarnMs: opts.loadTimeWarnMs,
      results,
      lane: opts.lane,
    }),
    projectId: opts.projectId,
    deploymentUrl: opts.deploymentUrl,
    branch: opts.branch,
    commitSha: opts.commitSha,
  };

  // --- Step 4: write local JSON + HTML reports so CI can upload them too ---
  const jsonPath = opts.jsonOutPath ?? path.join(root, 'reports', `${report.run_id}.json`);
  await writeJsonReport(report, jsonPath);
  const htmlPath = opts.htmlOutPath ?? htmlReportPathFor(jsonPath);
  await renderHtmlReport(report, htmlPath);

  // --- Step 5: upload artifacts to Supabase Storage ------------------------
  const storageKeys: {
    htmlReport?: string;
    screenshots: Record<string, string>;
    diffs: Record<string, string>;
    baselines: Record<string, string>;
  } = { screenshots: {}, diffs: {}, baselines: {} };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const r = results[i]!;
    const k = `${t.url}|${t.vp.name}`;
    const keyBase = `${opts.projectId}/${report.run_id}/${urlToSlug(t.url)}/${t.vp.name}`;
    if (await fileExists(t.capPath)) {
      try {
        const k1 = await storage.uploadArtifact(
          t.capPath,
          'visual-check-screenshots',
          `${keyBase}.png`,
        );
        storageKeys.screenshots[k] = k1;
      } catch (e) {
        log(
          `  [warn] upload screenshot failed for ${t.url} @ ${t.vp.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (r.diff_image && (await fileExists(t.diffPath))) {
      try {
        const k2 = await storage.uploadArtifact(
          t.diffPath,
          'visual-check-diffs',
          `${keyBase}.png`,
        );
        storageKeys.diffs[k] = k2;
      } catch (e) {
        log(
          `  [warn] upload diff failed for ${t.url} @ ${t.vp.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (t.hasBaseline) {
      storageKeys.baselines[k] = `${opts.projectId}/${urlToSlug(t.url)}/${t.vp.name}.png`;
    }
  }

  let htmlReportKey: string | null = null;
  try {
    htmlReportKey = await storage.uploadArtifact(
      htmlPath,
      'visual-check-reports',
      `${opts.projectId}/${report.run_id}.html`,
    );
    storageKeys.htmlReport = htmlReportKey;
  } catch (e) {
    log(
      `  [warn] upload HTML report failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  report.storageKeys = storageKeys;

  // --- Step 6: persist run + results in Postgres ---------------------------
  try {
    await db.insertRun(report, opts.projectId, htmlReportKey);
    await db.insertResults(report.run_id, report.results, storageKeys);
  } catch (e) {
    log(`  [warn] db persist failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- Step 7: sign the HTML report URL and (maybe) alert ------------------
  let signedReportUrl: string | null = null;
  if (htmlReportKey) {
    try {
      signedReportUrl = await storage.signedUrl(
        'visual-check-reports',
        htmlReportKey,
        ttl,
      );
    } catch (e) {
      log(
        `  [warn] sign URL failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  let alertSent = false;
  if (!report.pass && signedReportUrl) {
    try {
      await alerts.sendTelegramAlert(report, signedReportUrl);
      alertSent = true;
    } catch (e) {
      log(
        `  [warn] Telegram alert failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // --- Step 8: log summary -------------------------------------------------
  if (!opts.quiet) {
    log('\n[visual-check] summary');
    log(formatSummary(report.summary));
    log(`\n[visual-check] overall: ${report.pass ? 'PASS' : 'FAIL'}`);
    if (signedReportUrl) log(`[visual-check] report → ${signedReportUrl}`);
  }

  return { report, signedReportUrl, alertSent };
}

/** Ensure the local workspace is bootstrapped so writes succeed. */
export async function ensureWorkspace(outRoot: string): Promise<void> {
  const root = path.resolve(outRoot);
  await fs.mkdir(path.join(root, 'baselines'), { recursive: true });
  await fs.mkdir(path.join(root, 'captures'), { recursive: true });
  await fs.mkdir(path.join(root, 'diffs'), { recursive: true });
  await fs.mkdir(path.join(root, 'reports'), { recursive: true });
}
