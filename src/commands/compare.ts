/**
 * `visual-check compare` — credential-free baseline-vs-current comparison.
 *
 * Unlike `run`/`deploy-gate`, this command needs no stored baseline and no
 * cloud service: it captures *both* sides (a baseline URL/page and a
 * current URL/page) in the same invocation, diffs them, and writes the
 * same JSON/HTML/receipt artifacts via the existing report pipeline.
 * Either side may be an http(s) URL or a local file path — local paths are
 * resolved to `file://` URLs so Playwright can capture them directly.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Capturer } from '../capture.js';
import { diffPngs, DiffResult } from '../diff.js';
import { buildTargetResult } from '../checks.js';
import { buildReport, formatSummary, formatTargetLine, writeJsonReport } from '../report.js';
import { renderHtmlReport, htmlReportPathFor } from '../html-report.js';
import { receiptPathFor, writeReceipt } from '../receipt.js';
import { runPool } from '../pool.js';
import { BaselineLane, CaptureArtifact, RunReport, TargetResult, ViewportSpec } from '../types.js';

export interface CompareTarget {
  /** The raw string passed on the command line. */
  raw: string;
  /** Navigable URL — http(s):// or file://. */
  url: string;
  /** Human-readable label used in reports (relative path for local files). */
  label: string;
}

/** Resolve a `--baseline`/`--current` argument to a navigable target. */
export function resolveCompareTarget(raw: string, baseDir: string = process.cwd()): CompareTarget {
  if (/^(https?|file):\/\//i.test(raw)) {
    return { raw, url: raw, label: raw };
  }
  const abs = path.resolve(baseDir, raw);
  const label = path.relative(baseDir, abs) || abs;
  return { raw, url: pathToFileURL(abs).href, label };
}

/**
 * A baseline capture is only usable when Playwright raised no navigation
 * error *and* the response was healthy (2xx/3xx). Local `file://` captures
 * normalize to httpStatus 200 in Capturer, so they are always eligible.
 * A baseline that 404s (or otherwise errors) must never feed the pixel
 * diff — that would silently compare against a broken page and report a
 * false green.
 */
export function isHealthyBaseline(cap: CaptureArtifact): boolean {
  return !cap.error && cap.httpStatus !== null && cap.httpStatus >= 200 && cap.httpStatus < 400;
}

/** Compose a TargetResult from a captured baseline + current pair (pure, testable). */
export function buildCompareTargetResult(params: {
  baselineCap: CaptureArtifact;
  currentCap: CaptureArtifact;
  currentLabel: string;
  diff: DiffResult | null;
  pixelDiffThresholdPct: number;
  loadTimeWarnMs: number;
}): TargetResult {
  const { baselineCap, currentCap, currentLabel, diff, pixelDiffThresholdPct, loadTimeWarnMs } = params;
  const baselineExists = isHealthyBaseline(baselineCap);
  const cap: CaptureArtifact = { ...currentCap, url: currentLabel };

  const result = buildTargetResult({
    cap,
    diff: baselineExists ? diff : null,
    baselineExists,
    baselinePath: baselineCap.screenshotPath,
    pixelDiffThresholdPct,
    loadTimeWarnMs,
  });

  if (baselineCap.error) {
    result.reasons = [`baseline_capture: ${baselineCap.error}`, ...result.reasons];
  } else if (!baselineExists) {
    result.reasons = [`baseline_http_status: HTTP ${baselineCap.httpStatus}`, ...result.reasons];
  }
  return result;
}

export interface CompareOptions {
  baseline: string;
  current: string;
  viewports: ViewportSpec[];
  outRoot: string;
  threshold: number;
  loadTimeWarnMs: number;
  lane: BaselineLane;
  concurrency?: number;
  headless?: boolean;
  quiet?: boolean;
  jsonOutPath?: string;
  /** `false` disables HTML output entirely (mirrors `--no-html`). */
  htmlOutPath?: string | false;
  receiptOutPath?: string;
  log?: (line: string) => void;
}

export interface CompareRunResult {
  report: RunReport;
  jsonPath: string | null;
  htmlPath: string | null;
  receiptPath: string | null;
}

export async function runCompare(opts: CompareOptions): Promise<CompareRunResult> {
  const log = opts.log ?? (opts.quiet ? () => {} : (l: string) => console.log(l));
  const root = path.resolve(opts.outRoot);
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const compareRoot = path.join(root, 'compare', runStamp);

  const baseline = resolveCompareTarget(opts.baseline);
  const current = resolveCompareTarget(opts.current);

  log(
    `[visual-check] compare: baseline="${baseline.label}" current="${current.label}" × ${opts.viewports.length} viewport(s) (threshold ${opts.threshold}%)`,
  );

  type Job = { vp: ViewportSpec; basePath: string; capPath: string; diffPath: string };
  const jobs: Job[] = opts.viewports.map((vp) => ({
    vp,
    basePath: path.join(compareRoot, 'baseline', `${vp.name}.png`),
    capPath: path.join(compareRoot, 'current', `${vp.name}.png`),
    diffPath: path.join(compareRoot, 'diff', `${vp.name}.png`),
  }));

  const capturer = new Capturer({ headless: opts.headless ?? true });
  await capturer.start();

  const results: TargetResult[] = new Array(jobs.length);
  try {
    const runOne = async (j: Job): Promise<TargetResult> => {
      const baselineCap = await capturer.capture(baseline.url, j.vp, j.basePath);
      const currentCap = await capturer.capture(current.url, j.vp, j.capPath);
      let diff: DiffResult | null = null;
      if (isHealthyBaseline(baselineCap) && !currentCap.error) {
        try {
          diff = await diffPngs(j.basePath, j.capPath, j.diffPath);
        } catch {
          diff = null;
        }
      }
      return buildCompareTargetResult({
        baselineCap,
        currentCap,
        currentLabel: current.label,
        diff,
        pixelDiffThresholdPct: opts.threshold,
        loadTimeWarnMs: opts.loadTimeWarnMs,
      });
    };

    const pooled = await runPool(
      jobs.map((j) => () => runOne(j)),
      opts.concurrency ?? 2,
      (r) => {
        if (opts.quiet) return;
        if (r.ok) log('  ' + formatTargetLine(r.value));
        else log(`  ERROR         ${current.label} @ ${jobs[r.index]!.vp.name} — ${r.error.message}`);
      },
    );
    for (const r of pooled) {
      if (r.ok) {
        results[r.index] = r.value;
      } else {
        const j = jobs[r.index]!;
        results[r.index] = buildTargetResult({
          cap: {
            url: current.label,
            viewport: j.vp.name,
            screenshotPath: j.capPath,
            httpStatus: null,
            consoleErrors: [],
            loadTimeMs: 0,
            error: r.error.message,
          },
          diff: null,
          baselineExists: false,
          baselinePath: j.basePath,
          pixelDiffThresholdPct: opts.threshold,
          loadTimeWarnMs: opts.loadTimeWarnMs,
        });
      }
    }
  } finally {
    await capturer.stop();
  }

  const report = buildReport({
    urls: [baseline.label, current.label],
    viewports: opts.viewports,
    pixelDiffThreshold: opts.threshold,
    loadTimeWarnMs: opts.loadTimeWarnMs,
    results,
    lane: opts.lane,
  });

  if (!opts.quiet) {
    log('\n[visual-check] summary');
    log(formatSummary(report.summary));
    log(`\n[visual-check] overall: ${report.pass ? 'PASS' : 'FAIL'}`);
  }

  let jsonPath: string | null = null;
  if (opts.jsonOutPath) {
    jsonPath = opts.jsonOutPath;
    await writeJsonReport(report, jsonPath);
    if (!opts.quiet) log(`[visual-check] JSON report → ${path.resolve(jsonPath)}`);
  }

  // HTML is the primary deliverable of `compare`, so it is written even
  // when --json is omitted (falls back to a timestamped path under --out).
  let htmlPath: string | null = null;
  const htmlEnabled = opts.htmlOutPath !== false;
  if (htmlEnabled) {
    htmlPath =
      typeof opts.htmlOutPath === 'string'
        ? opts.htmlOutPath
        : jsonPath
          ? htmlReportPathFor(jsonPath)
          : path.join(compareRoot, 'report.html');
    await renderHtmlReport(report, htmlPath);
    if (!opts.quiet) log(`[visual-check] HTML report → ${path.resolve(htmlPath)}`);
  }

  let receiptPath: string | null = null;
  if (opts.receiptOutPath || jsonPath) {
    receiptPath = opts.receiptOutPath ?? (jsonPath ? receiptPathFor(jsonPath) : null);
    if (receiptPath) {
      await writeReceipt({
        report,
        receiptPath,
        jsonPath: jsonPath ?? undefined,
        htmlPath: htmlPath ?? undefined,
      });
      if (!opts.quiet) log(`[visual-check] receipt → ${path.resolve(receiptPath)}`);
    }
  }

  return { report, jsonPath, htmlPath, receiptPath };
}
