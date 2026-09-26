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
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Capturer, sanitizeCaptureError } from '../capture.js';
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
  /** Whether this target navigates to a URL or a local file. */
  kind?: 'url' | 'file';
  /** For `kind: 'file'` targets, whether a file/directory exists at the resolved path. */
  exists?: boolean;
}

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Extensions that keep a bare `label.ext` string a file path, never a guessed web address. */
const PAGE_FILE_EXTENSIONS = new Set([
  'html',
  'htm',
  'xhtml',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'md',
  'json',
  'xml',
  'js',
  'css',
]);

function splitHostAndRest(raw: string): { hostPort: string; rest: string } | null {
  const match = raw.match(/^([^/?#]+)([/?#].*)?$/);
  if (!match) return null;
  return { hostPort: match[1]!, rest: match[2] ?? '' };
}

/**
 * True when `raw` reads like something a person typed as a web address
 * (`example.com`, `staging.example.com/pricing?x=1`, `localhost:3000`) rather
 * than a local file path. Local-path markers (backslash, leading `.`/`/`/`~`,
 * a Windows drive letter) and bare `name.ext` strings whose extension is a
 * known page/file extension always win as file paths.
 */
export function looksLikeWebAddress(raw: string): boolean {
  if (!raw) return false;
  if (raw.includes('\\')) return false;
  if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('~')) return false;
  if (/^[A-Za-z]:/.test(raw)) return false;

  const split = splitHostAndRest(raw);
  if (!split) return false;
  const { hostPort } = split;

  if (LOCAL_HOST_RE.test(hostPort)) return true;

  const domainMatch = hostPort.match(/^([a-zA-Z0-9-]+\.)+([a-zA-Z]{2,})(:\d+)?$/);
  if (!domainMatch) return false;

  const lastLabel = domainMatch[2]!.toLowerCase();
  if (!raw.includes('/') && PAGE_FILE_EXTENSIONS.has(lastLabel)) return false;

  return true;
}

/** Resolve a `--baseline`/`--current` argument to a navigable target. */
export function resolveCompareTarget(raw: string, baseDir: string = process.cwd()): CompareTarget {
  if (/^(https?):\/\//i.test(raw)) {
    return { raw, url: raw, label: raw, kind: 'url' };
  }
  if (/^file:\/\//i.test(raw)) {
    let exists = false;
    try {
      exists = existsSync(fileURLToPath(raw));
    } catch {
      exists = false;
    }
    return { raw, url: raw, label: raw, kind: 'file', exists };
  }

  const abs = path.resolve(baseDir, raw);
  if (existsSync(abs)) {
    const label = path.relative(baseDir, abs) || abs;
    return { raw, url: pathToFileURL(abs).href, label, kind: 'file', exists: true };
  }

  if (looksLikeWebAddress(raw)) {
    const { hostPort } = splitHostAndRest(raw)!;
    const scheme = LOCAL_HOST_RE.test(hostPort) ? 'http' : 'https';
    const guessedUrl = `${scheme}://${raw}`;
    return { raw, url: guessedUrl, label: guessedUrl, kind: 'url' };
  }

  const label = path.relative(baseDir, abs) || abs;
  return { raw, url: pathToFileURL(abs).href, label, kind: 'file', exists: false };
}

/**
 * A baseline capture is only usable when Playwright produced a renderable
 * document with no navigation error and a final status in [200, 400).
 * Chromium aborts bare no-content/cache-only navigations (204, 205, 304)
 * before it can render a document, so those statuses are explicitly
 * ineligible. Local `file://` captures normalize to 200 and remain eligible.
 * An unusable baseline must never feed the pixel diff.
 */
export function isHealthyBaseline(cap: CaptureArtifact): boolean {
  const status = cap.httpStatus;
  return (
    !cap.error &&
    status !== null &&
    status >= 200 &&
    status < 400 &&
    status !== 204 &&
    status !== 205 &&
    status !== 304
  );
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
    result.reasons = [
      `baseline_capture: ${sanitizeCaptureError(baselineCap.error)}`,
      ...result.reasons,
    ];
  } else if (!baselineExists) {
    result.reasons = [`baseline_http_status: HTTP ${baselineCap.httpStatus}`, ...result.reasons];
  }
  if (!baselineExists) {
    // Baseline truth must remain visible even when the current side also has
    // a blocking HTTP/capture failure. The checks and reasons retain the
    // current-side failure, while the primary verdict drives the required
    // baseline-review workflow and keeps baselines_present truthful.
    result.verdict = 'needs_baseline';
    result.pass = false;
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

  // A missing local file is not guessed as a web address, and it does not
  // abort the run: capture fails, so the report records needs_baseline
  // (exit 2) or error (exit 3) as the exit-code contract requires. The
  // warning says why, even in quiet mode.
  const warn = opts.log ?? ((l: string) => console.error(l));
  const explicitSchemeRe = /^(https?|file):\/\//i;
  for (const [side, target] of [
    ['baseline', baseline],
    ['current', current],
  ] as const) {
    if (target.kind === 'file' && target.exists === false) {
      let abs: string;
      try {
        abs = fileURLToPath(target.url);
      } catch {
        abs = target.raw;
      }
      warn(
        `[visual-check] warning: compare: --${side} "${target.raw}" is not a web address and no file exists at ${abs}. Use a full URL (https://...) or an existing file path.`,
      );
    }
    if (target.kind === 'url' && !explicitSchemeRe.test(target.raw)) {
      log(`[visual-check] compare: reading "${target.raw}" as ${target.url}`);
    }
  }

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
        else
          log(
            `  ERROR         ${current.label} @ ${jobs[r.index]!.vp.name} — ${sanitizeCaptureError(r.error)}`,
          );
      },
    );
    for (const r of pooled) {
      if (r.ok) {
        results[r.index] = r.value;
      } else {
        const j = jobs[r.index]!;
        const boundedError = sanitizeCaptureError(r.error);
        results[r.index] = buildTargetResult({
          cap: {
            url: current.label,
            viewport: j.vp.name,
            screenshotPath: j.capPath,
            httpStatus: null,
            consoleErrors: [],
            loadTimeMs: 0,
            error: boundedError,
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
