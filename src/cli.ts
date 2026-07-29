#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { Capturer, sanitizeCaptureError, urlToSlug } from './capture.js';
import { diffPngs, fileExists } from './diff.js';
import { buildTargetResult } from './checks.js';
import {
  buildReport,
  formatSummary,
  formatTargetLine,
  writeJsonReport,
} from './report.js';
import { renderHtmlReport, htmlReportPathFor } from './html-report.js';
import { receiptPathFor, writeReceipt } from './receipt.js';
import { runPool } from './pool.js';
import {
  BaselineLane,
  CaptureArtifact,
  DEFAULT_VIEWPORTS,
  TargetResult,
  ViewportSpec,
} from './types.js';
import { runDeployGate } from './commands/deploy-gate.js';
import { runPromote } from './commands/promote.js';
import { runCompare } from './commands/compare.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseUrls(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^https?:\/\//.test(s) ? s : `https://${s}`));
}

function parseViewports(raw: string | undefined): ViewportSpec[] {
  if (!raw) return DEFAULT_VIEWPORTS;
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const picked = DEFAULT_VIEWPORTS.filter((v) => wanted.includes(v.name));
  if (picked.length === 0) {
    throw new Error(
      `No matching viewports. Valid names: ${DEFAULT_VIEWPORTS.map((v) => v.name).join(', ')}`,
    );
  }
  return picked;
}

function localLane(): BaselineLane {
  const platform = process.platform;
  let os: BaselineLane['os'];
  if (platform === 'darwin') os = 'macos';
  else if (platform === 'win32') os = 'windows';
  else os = 'linux';

  const runner: BaselineLane['runner'] =
    os === 'macos' ? 'macmini-local' : os === 'windows' ? 'lenovo-local' : 'thinkcentre-local';

  return { browser: 'chromium', os, runner };
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('visual-check')
  .description(
    "Deploy-time visual verification for AI agents. Don't let your agent say 'done' until it has shown its work.",
  )
  .version('0.1.0');

// ---------------------------------------------------------------------------
// baseline
// ---------------------------------------------------------------------------

program
  .command('baseline')
  .description('Capture baseline screenshots for the given URLs × viewports')
  .requiredOption('--urls <urls>', 'Comma-separated URLs')
  .option(
    '--viewports <list>',
    'Comma-separated viewport names (mobile,tablet,desktop)',
    'mobile,tablet,desktop',
  )
  .option('--out <dir>', 'Workspace root directory', '.')
  .option('--headed', 'Run Chromium headed (for debugging)', false)
  .action(async (opts: { urls: string; viewports?: string; out: string; headed?: boolean }) => {
    const urls = parseUrls(opts.urls);
    const viewports = parseViewports(opts.viewports);
    const root = path.resolve(opts.out);
    const baselineRoot = path.join(root, 'baselines');

    console.log(
      `[visual-check] baseline: ${urls.length} URL(s) × ${viewports.length} viewport(s) → ${baselineRoot}`,
    );

    const capturer = new Capturer({ headless: !opts.headed });
    await capturer.start();

    let failures = 0;
    try {
      for (const url of urls) {
        const slug = urlToSlug(url);
        for (const vp of viewports) {
          const outPath = path.join(baselineRoot, slug, `${vp.name}.png`);
          process.stdout.write(`  ${url} @ ${vp.name} ... `);
          const cap = await capturer.capture(url, vp, outPath);
          if (cap.error) {
            console.log(`ERROR: ${cap.error}`);
            failures++;
          } else {
            console.log(
              `OK (HTTP ${cap.httpStatus ?? '—'}, ${cap.loadTimeMs}ms) → ${path.relative(root, outPath)}`,
            );
          }
        }
      }
    } finally {
      await capturer.stop();
    }

    if (failures > 0) {
      console.error(`\n[visual-check] ${failures} baseline capture(s) failed.`);
      process.exit(1);
    }
    console.log(`\n[visual-check] Baselines saved to ${baselineRoot}`);
  });

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

program
  .command('run')
  .description('Capture current screenshots and compare against baselines')
  .requiredOption('--urls <urls>', 'Comma-separated URLs')
  .option(
    '--viewports <list>',
    'Comma-separated viewport names (mobile,tablet,desktop)',
    'mobile,tablet,desktop',
  )
  .option('--out <dir>', 'Workspace root directory', '.')
  .option('--threshold <pct>', 'Pixel diff threshold (% of pixels changed)', '5')
  .option('--load-time-warn <ms>', 'Load time warning threshold (ms)', '3000')
  .option('--concurrency <n>', 'Parallel captures per browser', '3')
  .option('--json <path>', 'Write JSON report to this path')
  .option('--html <path>', 'Write HTML report to this path (also emitted alongside --json by default)')
  .option('--receipt <path>', 'Write terminal-state receipt to this path (defaults alongside --json)')
  .option('--no-html', 'Skip HTML report even when --json is set')
  .option('--quiet', 'Suppress per-target console output', false)
  .option('--headed', 'Run Chromium headed (for debugging)', false)
  .action(
    async (opts: {
      urls: string;
      viewports?: string;
      out: string;
      threshold: string;
      loadTimeWarn: string;
      concurrency: string;
      json?: string;
      html?: string;
      receipt?: string;
      quiet?: boolean;
      headed?: boolean;
    }) => {
      const urls = parseUrls(opts.urls);
      const viewports = parseViewports(opts.viewports);
      const root = path.resolve(opts.out);
      const baselineRoot = path.join(root, 'baselines');
      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const captureRoot = path.join(root, 'captures', dateStr, timeStamp);
      const diffRoot = path.join(root, 'diffs', dateStr, timeStamp);
      const threshold = parseFloat(opts.threshold);
      const loadTimeWarnMs = parseInt(opts.loadTimeWarn, 10);
      const concurrency = parseInt(opts.concurrency, 10);

      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        throw new Error(`Invalid --threshold: ${opts.threshold}`);
      }
      if (Number.isNaN(loadTimeWarnMs) || loadTimeWarnMs <= 0) {
        throw new Error(`Invalid --load-time-warn: ${opts.loadTimeWarn}`);
      }
      if (Number.isNaN(concurrency) || concurrency < 1 || concurrency > 16) {
        throw new Error(`Invalid --concurrency: ${opts.concurrency} (expected 1..16)`);
      }

      if (!opts.quiet) {
        console.log(
          `[visual-check] run: ${urls.length} URL(s) × ${viewports.length} viewport(s) = ${urls.length * viewports.length} target(s), concurrency ${concurrency}  (threshold ${threshold}%, load-time-warn ${loadTimeWarnMs}ms)`,
        );
      }

      const capturer = new Capturer({ headless: !opts.headed });
      await capturer.start();

      // Build flat task list: each target is one capture+diff job
      type Target = { url: string; vp: ViewportSpec; capPath: string; basePath: string; diffPath: string };
      const targets: Target[] = [];
      for (const url of urls) {
        const slug = urlToSlug(url);
        for (const vp of viewports) {
          targets.push({
            url,
            vp,
            capPath: path.join(captureRoot, slug, `${vp.name}.png`),
            basePath: path.join(baselineRoot, slug, `${vp.name}.png`),
            diffPath: path.join(diffRoot, slug, `${vp.name}.png`),
          });
        }
      }

      const runOne = async (t: Target): Promise<TargetResult> => {
        const cap: CaptureArtifact = await capturer.capture(t.url, t.vp, t.capPath);
        const baselineExists = !cap.error && (await fileExists(t.basePath));
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
          pixelDiffThresholdPct: threshold,
          loadTimeWarnMs,
        });
      };

      const results: TargetResult[] = new Array(targets.length);
      try {
        const pooled = await runPool(
          targets.map((t) => () => runOne(t)),
          concurrency,
          (r) => {
            if (opts.quiet) return;
            if (r.ok) {
              console.log('  ' + formatTargetLine(r.value));
            } else {
              console.log(
                `  ERROR         ${targets[r.index]!.url} @ ${targets[r.index]!.vp.name} — ${sanitizeCaptureError(r.error)}`,
              );
            }
          },
        );
        for (const r of pooled) {
          if (r.ok) {
            results[r.index] = r.value;
          } else {
            // Synthesize an error TargetResult so the report shape is always complete
            const t = targets[r.index]!;
            const boundedError = sanitizeCaptureError(r.error);
            results[r.index] = buildTargetResult({
              cap: {
                url: t.url,
                viewport: t.vp.name,
                screenshotPath: t.capPath,
                httpStatus: null,
                consoleErrors: [],
                loadTimeMs: 0,
                error: boundedError,
              },
              diff: null,
              baselineExists: false,
              baselinePath: t.basePath,
              pixelDiffThresholdPct: threshold,
              loadTimeWarnMs,
            });
          }
        }
      } finally {
        await capturer.stop();
      }

      const report = buildReport({
        urls,
        viewports,
        pixelDiffThreshold: threshold,
        loadTimeWarnMs,
        results,
        lane: localLane(),
      });

      if (!opts.quiet) {
        console.log('\n[visual-check] summary');
        console.log(formatSummary(report.summary));
        console.log(`\n[visual-check] overall: ${report.pass ? 'PASS' : 'FAIL'}`);
      }

      if (opts.json) {
        await writeJsonReport(report, opts.json);
        if (!opts.quiet) {
          console.log(`[visual-check] JSON report → ${path.resolve(opts.json)}`);
        }
      } else if (opts.quiet) {
        // In quiet mode with no --json, emit the report to stdout for agents
        process.stdout.write(JSON.stringify(report));
      }

      // HTML report:
      //   --html <path>            → write there
      //   --json <path> (default)  → also write alongside as <path>.html
      //   --no-html                → disable
      //   (opts.html is undefined → default; 'false' → disabled by --no-html)
      const htmlEnabled = (opts as { html?: string | false }).html !== false;
      let htmlPath: string | null = null;
      if (htmlEnabled) {
        htmlPath =
          typeof opts.html === 'string'
            ? opts.html
            : opts.json
              ? htmlReportPathFor(opts.json)
              : null;
        if (htmlPath) {
          await renderHtmlReport(report, htmlPath);
          if (!opts.quiet) {
            console.log(`[visual-check] HTML report → ${path.resolve(htmlPath)}`);
          }
        }
      }

      const receiptPath = opts.receipt ?? (opts.json ? receiptPathFor(opts.json) : null);
      if (receiptPath) {
        await writeReceipt({
          report,
          receiptPath,
          jsonPath: opts.json,
          htmlPath: htmlPath ?? undefined,
        });
        if (!opts.quiet) {
          console.log(`[visual-check] receipt → ${path.resolve(receiptPath)}`);
        }
      }

      // Exit 0 on pass/warn, 1 on fail/error/needs_baseline
      process.exit(report.pass ? 0 : 1);
    },
  );

// ---------------------------------------------------------------------------
// compare — credential-free baseline-vs-current, no stored baselines
// ---------------------------------------------------------------------------

program
  .command('compare')
  .description(
    'Compare a baseline URL/page against a current URL/page — no stored baselines, no credentials, no cloud service',
  )
  .requiredOption('--baseline <target>', 'Baseline URL or local file path')
  .requiredOption('--current <target>', 'Current URL or local file path to compare against the baseline')
  .option(
    '--viewports <list>',
    'Comma-separated viewport names (mobile,tablet,desktop)',
    'mobile,desktop',
  )
  .option('--out <dir>', 'Workspace root directory', '.')
  .option('--threshold <pct>', 'Pixel diff threshold (% of pixels changed)', '5')
  .option('--load-time-warn <ms>', 'Load time warning threshold (ms)', '3000')
  .option('--concurrency <n>', 'Parallel viewport captures', '2')
  .option('--json <path>', 'Write JSON report to this path')
  .option(
    '--html <path>',
    'Write HTML report to this path (defaults alongside --json, or a timestamped path under --out)',
  )
  .option('--receipt <path>', 'Write terminal-state receipt to this path (defaults alongside --json)')
  .option('--no-html', 'Skip HTML report')
  .option('--quiet', 'Suppress per-target console output', false)
  .option('--headed', 'Run Chromium headed (for debugging)', false)
  .action(
    async (opts: {
      baseline: string;
      current: string;
      viewports?: string;
      out: string;
      threshold: string;
      loadTimeWarn: string;
      concurrency: string;
      json?: string;
      html?: string | false;
      receipt?: string;
      quiet?: boolean;
      headed?: boolean;
    }) => {
      const viewports = parseViewports(opts.viewports);
      const threshold = parseFloat(opts.threshold);
      const loadTimeWarnMs = parseInt(opts.loadTimeWarn, 10);
      const concurrency = parseInt(opts.concurrency, 10);

      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        throw new Error(`Invalid --threshold: ${opts.threshold}`);
      }
      if (Number.isNaN(loadTimeWarnMs) || loadTimeWarnMs <= 0) {
        throw new Error(`Invalid --load-time-warn: ${opts.loadTimeWarn}`);
      }
      if (Number.isNaN(concurrency) || concurrency < 1 || concurrency > 16) {
        throw new Error(`Invalid --concurrency: ${opts.concurrency} (expected 1..16)`);
      }

      const { report } = await runCompare({
        baseline: opts.baseline,
        current: opts.current,
        viewports,
        outRoot: opts.out,
        threshold,
        loadTimeWarnMs,
        concurrency,
        lane: localLane(),
        headless: !opts.headed,
        quiet: opts.quiet,
        jsonOutPath: opts.json,
        htmlOutPath: opts.html,
        receiptOutPath: opts.receipt,
      });

      process.exit(report.pass ? 0 : 1);
    },
  );

// ---------------------------------------------------------------------------
// deploy-gate  (Phase 2 — Daisy integration)
// ---------------------------------------------------------------------------

program
  .command('deploy-gate')
  .description('Run Visual Check against a deploy URL, persist to Supabase, alert on failure')
  .requiredOption('--urls <urls>', 'Comma-separated URLs to check')
  .requiredOption('--project <id>', 'Project id (e.g. "trashalert")')
  .requiredOption('--deployment-url <url>', 'Deploy URL under test (for report context)')
  .option('--branch <name>', 'Git branch name')
  .option('--sha <commit>', 'Git commit SHA')
  .option(
    '--viewports <list>',
    'Comma-separated viewport names (mobile,tablet,desktop)',
    'mobile,tablet,desktop',
  )
  .option('--out <dir>', 'Workspace root directory', '.')
  .option('--threshold <pct>', 'Pixel diff threshold (% of pixels changed)', '5')
  .option('--load-time-warn <ms>', 'Load time warning threshold (ms)', '3000')
  .option('--concurrency <n>', 'Parallel captures per browser', '3')
  .option('--signed-url-ttl <s>', 'Signed URL TTL in seconds', String(60 * 60 * 24 * 7))
  .option('--json <path>', 'Local JSON report path (defaults to reports/<run-id>.json)')
  .option('--html <path>', 'Local HTML report path (defaults alongside JSON)')
  .option('--receipt <path>', 'Local terminal-state receipt path (defaults alongside JSON)')
  .option('--quiet', 'Suppress per-target console output', false)
  .option('--headed', 'Run Chromium headed (for debugging)', false)
  .action(
    async (opts: {
      urls: string;
      project: string;
      deploymentUrl: string;
      branch?: string;
      sha?: string;
      viewports?: string;
      out: string;
      threshold: string;
      loadTimeWarn: string;
      concurrency: string;
      signedUrlTtl: string;
      json?: string;
      html?: string;
      receipt?: string;
      quiet?: boolean;
      headed?: boolean;
    }) => {
      const urls = parseUrls(opts.urls);
      const viewports = parseViewports(opts.viewports);
      const threshold = parseFloat(opts.threshold);
      const loadTimeWarnMs = parseInt(opts.loadTimeWarn, 10);
      const concurrency = parseInt(opts.concurrency, 10);
      const ttl = parseInt(opts.signedUrlTtl, 10);
      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        throw new Error(`Invalid --threshold: ${opts.threshold}`);
      }
      if (Number.isNaN(loadTimeWarnMs) || loadTimeWarnMs <= 0) {
        throw new Error(`Invalid --load-time-warn: ${opts.loadTimeWarn}`);
      }
      if (Number.isNaN(concurrency) || concurrency < 1 || concurrency > 16) {
        throw new Error(`Invalid --concurrency: ${opts.concurrency} (expected 1..16)`);
      }

      const { report } = await runDeployGate({
        urls,
        viewports,
        outRoot: opts.out,
        threshold,
        loadTimeWarnMs,
        concurrency,
        projectId: opts.project,
        deploymentUrl: opts.deploymentUrl,
        branch: opts.branch,
        commitSha: opts.sha,
        lane: localLane(),
        headless: !opts.headed,
        signedUrlTtlSeconds: ttl,
        quiet: opts.quiet,
        jsonOutPath: opts.json,
        htmlOutPath: opts.html,
        receiptOutPath: opts.receipt,
      });

      process.exit(report.pass ? 0 : 1);
    },
  );

// ---------------------------------------------------------------------------
// promote  (Phase 2 — Daisy integration)
// ---------------------------------------------------------------------------

program
  .command('promote')
  .description('Promote passed targets from a stored run to become the approved baseline')
  .requiredOption('--run-id <id>', 'Run id to promote (e.g. vc_xxx)')
  .option('--targets <mode>', 'all | selected (requires --select)', 'all')
  .option(
    '--select <list>',
    'Comma-separated "url@viewport" pairs when --targets=selected',
  )
  .option('--approved-by <name>', 'Name/identifier of the approver')
  .option(
    '--seed',
    'Also accept needs_baseline targets — for first-run seeding of a new project',
    false,
  )
  .option(
    '--accept-fail',
    'Also accept fail targets — for re-baselining after an intentional UI change',
    false,
  )
  .action(
    async (opts: {
      runId: string;
      targets?: 'all' | 'selected';
      select?: string;
      approvedBy?: string;
      seed?: boolean;
      acceptFail?: boolean;
    }) => {
      const selected =
        opts.targets === 'selected' && opts.select
          ? opts.select
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => {
                const at = s.lastIndexOf('@');
                if (at < 0) throw new Error(`Invalid --select entry (want "url@viewport"): ${s}`);
                return { url: s.slice(0, at), viewport: s.slice(at + 1) };
              })
          : undefined;

      const { promoted, skipped } = await runPromote({
        runId: opts.runId,
        targets: opts.targets,
        selected,
        approvedBy: opts.approvedBy,
        seed: opts.seed === true,
        acceptFail: opts.acceptFail === true,
      });

      if (promoted.length === 0) {
        console.error(`[visual-check] promote: nothing promoted (${skipped.length} skipped)`);
        process.exit(1);
      }
      process.exit(0);
    },
  );

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err) => {
  console.error(`[visual-check] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
