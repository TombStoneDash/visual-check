#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Capturer, sanitizeCaptureError, urlToSlug } from './capture.js';
import { explainReport, speak } from './explain.js';
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
  RunReport,
  RunSummary,
  TargetResult,
  Verdict,
  ViewportSpec,
} from './types.js';
import { runDeployGate } from './commands/deploy-gate.js';
import { runPromote } from './commands/promote.js';
import { runCompare } from './commands/compare.js';
import { assertApprovableReport, parseApproveSelection, runApprove } from './commands/approve.js';
import { describeExitCode, exitCodeFor, USAGE_OR_FATAL_EXIT_CODE } from './exit-codes.js';
import { formatViewportToken, parseUrls, parseViewports, parseNumberOption, UsageError } from './cli-args.js';
import { loadProjectConfigFile, resolveConfigTargetsForCli } from './project-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Reduce a run's per-target verdicts to the single overall verdict the exit
 * code is derived from. Precedence: error > fail > needs_baseline > warn >
 * pass — mirrors the private deriveVerdict()/deriveRunVerdict() helpers in
 * alerts.ts/db.ts.
 */
function reportVerdict(summary: RunSummary): Verdict {
  if (summary.total === 0) return 'error';
  if (summary.errors > 0) return 'error';
  if (summary.failed > 0) return 'fail';
  if (summary.needs_baseline > 0) return 'needs_baseline';
  if (summary.warnings > 0) return 'warn';
  return 'pass';
}


/**
 * Resolve URLs and viewports for run / compare / deploy-gate.
 *
 * Without --config every command behaves as before: --urls is required
 * (same commander error) and --viewports parses as today. With --config the
 * project config supplies urls and viewports (custom sizes applied); an
 * explicit --urls / --viewports flag overrides the config value and says so
 * once on stderr. The URL list is the same one config-targets prints.
 */
interface ConfigFlags {
  config?: string;
  baseUrl?: string;
  urls?: string;
  viewports?: string;
}

async function resolveTargets(
  cmd: Command,
  opts: ConfigFlags,
  { urlsRequired }: { urlsRequired: boolean },
): Promise<{ urls: string[]; viewports: ViewportSpec[]; baseUrl?: string }> {
  const viewportsFromFlag = cmd.getOptionValueSource('viewports') === 'cli';
  if (opts.config === undefined) {
    if (opts.baseUrl !== undefined) {
      throw new UsageError('--base-url needs --config (it resolves the config routes against that URL)');
    }
    if (urlsRequired && opts.urls === undefined) {
      cmd.error("error: required option '--urls <urls>' not specified");
    }
    return {
      urls: opts.urls === undefined ? [] : parseUrls(opts.urls),
      viewports: parseViewports(opts.viewports),
    };
  }
  const config = await loadProjectConfigFile(opts.config);
  const resolved = resolveConfigTargetsForCli(config, opts.baseUrl);
  for (const warning of resolved.warnings) console.error(`[visual-check] warning: ${warning}`);
  let urls = resolved.urls;
  if (opts.urls !== undefined) {
    console.error('[visual-check] notice: --urls overrides config routes');
    urls = parseUrls(opts.urls);
  }
  let viewports = resolved.viewports;
  if (viewportsFromFlag) {
    console.error('[visual-check] notice: --viewports overrides config viewports');
    viewports = parseViewports(opts.viewports);
  }
  return { urls, viewports, baseUrl: resolved.baseUrl };
}

const VIEWPORTS_HELP = 'Comma-separated viewports: names (mobile,tablet,desktop) or name:WIDTHxHEIGHT (desktop:1280x800)';
const CONFIG_HELP = 'Project config (.json/.mjs/.js) supplying routes and viewports; see README "Project config"';
const BASE_URL_HELP = 'Absolute http(s) URL the config routes are resolved against (default: the config baseUrl)';

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();
program.exitOverride();

program
  .name('visual-check')
  .description(
    "Deploy-time visual verification for AI agents. Don't let your agent say 'done' until it has shown its work.",
  )
  .version('0.1.0')
  .addHelpText(
    'after',
    `
Exit codes (run, compare):
  0    ${describeExitCode(0)}
  1    ${describeExitCode(1)}
  2    ${describeExitCode(2)}
  3    ${describeExitCode(3)}
  Usage errors and crashes exit 3 for every command.

  Pass --strict-warn to either command to treat a "warn" verdict as a
  failure (exit 1) instead of a success (exit 0).`,
  );

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
  .option('--urls <urls>', 'Comma-separated URLs (required unless --config is given)')
  .option('--config <path>', CONFIG_HELP)
  .option('--base-url <url>', BASE_URL_HELP)
  .option('--viewports <list>', VIEWPORTS_HELP, 'mobile,tablet,desktop')
  .option('--dry-run', 'Print the resolved targets (url @ viewport WxH) and exit 0 without a browser', false)
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
  .option(
    '--strict-warn',
    'Exit 1 (instead of 0) when the overall verdict is warn — see exit code contract below',
    false,
  )
  .action(
    async (opts: {
      urls?: string;
      config?: string;
      baseUrl?: string;
      viewports?: string;
      dryRun?: boolean;
      out: string;
      threshold: string;
      loadTimeWarn: string;
      concurrency: string;
      json?: string;
      html?: string;
      receipt?: string;
      quiet?: boolean;
      headed?: boolean;
      strictWarn?: boolean;
    }, cmd: Command) => {
      const { urls, viewports } = await resolveTargets(cmd, opts, { urlsRequired: true });
      const root = path.resolve(opts.out);
      const baselineRoot = path.join(root, 'baselines');
      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const captureRoot = path.join(root, 'captures', dateStr, timeStamp);
      const diffRoot = path.join(root, 'diffs', dateStr, timeStamp);
      const threshold = parseNumberOption('--threshold', opts.threshold, { min: 0, max: 100 });
      const loadTimeWarnMs = parseNumberOption('--load-time-warn', opts.loadTimeWarn, {
        min: 0, exclusiveMin: true, integer: true,
      });
      const concurrency = parseNumberOption('--concurrency', opts.concurrency, {
        min: 1, max: 16, integer: true,
      });

      if (opts.dryRun) {
        console.log(`[visual-check] run (dry run): ${urls.length} URL(s) × ${viewports.length} viewport(s)`);
        for (const url of urls) {
          for (const vp of viewports) console.log(`  ${url} @ ${vp.name} ${vp.width}x${vp.height}`);
        }
        process.exit(0);
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

      process.exit(exitCodeFor(reportVerdict(report.summary), { strictWarn: opts.strictWarn }));
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
  .option(
    '--current <target>',
    'Current URL or local file path to compare against the baseline (required unless --config is given: then the first config route)',
  )
  .option('--config <path>', CONFIG_HELP)
  .option('--base-url <url>', BASE_URL_HELP)
  .option('--viewports <list>', VIEWPORTS_HELP, 'mobile,desktop')
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
  .option(
    '--strict-warn',
    'Exit 1 (instead of 0) when the overall verdict is warn — see exit code contract below',
    false,
  )
  .action(
    async (opts: {
      baseline: string;
      current?: string;
      config?: string;
      baseUrl?: string;
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
      strictWarn?: boolean;
    }, cmd: Command) => {
      const resolved = await resolveTargets(cmd, { ...opts, urls: undefined }, { urlsRequired: false });
      const { viewports } = resolved;
      let current = opts.current;
      if (current === undefined) {
        if (opts.config === undefined || resolved.urls.length === 0) {
          cmd.error("error: required option '--current <target>' not specified");
        }
        current = resolved.urls[0]!;
        console.error(
          `[visual-check] notice: --current defaults to the first config route ${current}; compare checks one page per run`,
        );
      }
      const threshold = parseNumberOption('--threshold', opts.threshold, { min: 0, max: 100 });
      const loadTimeWarnMs = parseNumberOption('--load-time-warn', opts.loadTimeWarn, {
        min: 0, exclusiveMin: true, integer: true,
      });
      const concurrency = parseNumberOption('--concurrency', opts.concurrency, {
        min: 1, max: 16, integer: true,
      });

      const { report } = await runCompare({
        baseline: opts.baseline,
        current,
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

      process.exit(exitCodeFor(reportVerdict(report.summary), { strictWarn: opts.strictWarn }));
    },
  );

// ---------------------------------------------------------------------------
// deploy-gate  (Phase 2 — Daisy integration)
// ---------------------------------------------------------------------------

program
  .command('deploy-gate')
  .description('Run Visual Check against a deploy URL, persist to Supabase, alert on failure')
  .option('--urls <urls>', 'Comma-separated URLs to check (required unless --config is given)')
  .option('--config <path>', CONFIG_HELP)
  .option('--base-url <url>', BASE_URL_HELP)
  .requiredOption('--project <id>', 'Project id (e.g. "trashalert")')
  .requiredOption('--deployment-url <url>', 'Deploy URL under test (for report context)')
  .option('--branch <name>', 'Git branch name')
  .option('--sha <commit>', 'Git commit SHA')
  .option('--viewports <list>', VIEWPORTS_HELP, 'mobile,tablet,desktop')
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
      urls?: string;
      config?: string;
      baseUrl?: string;
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
    }, cmd: Command) => {
      const { urls, viewports } = await resolveTargets(cmd, opts, { urlsRequired: true });
      const threshold = parseNumberOption('--threshold', opts.threshold, { min: 0, max: 100 });
      const loadTimeWarnMs = parseNumberOption('--load-time-warn', opts.loadTimeWarn, {
        min: 0, exclusiveMin: true, integer: true,
      });
      const concurrency = parseNumberOption('--concurrency', opts.concurrency, {
        min: 1, max: 16, integer: true,
      });

      const ttl = parseNumberOption('--signed-url-ttl', opts.signedUrlTtl, {
        min: 0, exclusiveMin: true, integer: true,
      });

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
// approve  (local: reviewed run screenshots become baselines; no browser)
// ---------------------------------------------------------------------------

program
  .command('approve')
  .description(
    'Copy the screenshots from a reviewed run report into <out>/baselines/ (only needs_baseline targets unless --accept-fail)',
  )
  .requiredOption('--report <path>', 'JSON report from run, deploy-gate or compare (schema_version 1)')
  .option('--select <list>', 'Comma-separated "url@viewport" pairs to approve (default: every approvable target)')
  .option('--out <dir>', 'Workspace root directory', '.')
  .option(
    '--accept-fail',
    'Also accept fail targets whose only failing check is the pixel diff; the old baseline moves to baselines/.history/',
    false,
  )
  .option('--approved-by <name>', 'Name/identifier of the approver, recorded in baselines/approvals.jsonl')
  .option('--dry-run', 'Print what would be approved and write nothing', false)
  .action(
    async (opts: {
      report: string;
      select?: string;
      out: string;
      acceptFail?: boolean;
      approvedBy?: string;
      dryRun?: boolean;
    }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await fs.readFile(path.resolve(opts.report), 'utf-8'));
      } catch (err) {
        throw new Error(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? `--report ${opts.report} does not exist`
            : `--report ${opts.report} is not valid JSON`,
        );
      }
      assertApprovableReport(parsed, `--report ${opts.report}`);

      const { approved, skipped, log } = await runApprove({
        report: parsed,
        root: opts.out,
        selected: opts.select !== undefined ? parseApproveSelection(opts.select) : undefined,
        acceptFail: opts.acceptFail === true,
        approvedBy: opts.approvedBy,
        dryRun: opts.dryRun === true,
      });

      const root = path.resolve(opts.out);
      const verb = opts.dryRun ? 'would approve' : 'approved';
      for (const a of approved) {
        const replaced = a.previous ? ` (old baseline → ${path.relative(root, a.previous)})` : '';
        console.log(`  ${verb.padEnd(13)} ${a.url} @ ${a.viewport} → ${path.relative(root, a.baseline)}${replaced}`);
      }
      for (const s of skipped) console.log(`  skipped       ${s.url} @ ${s.viewport} — ${s.reason}`);
      console.log(
        `\n[visual-check] approve: ${approved.length} ${verb}, ${skipped.length} skipped` +
          (log ? `; logged to ${path.relative(root, log)}` : ''),
      );
      process.exit(approved.length > 0 ? 0 : 1);
    },
  );

// ---------------------------------------------------------------------------
// config-targets  (reads a project config; prints flags for the other commands)
// ---------------------------------------------------------------------------

program
  .command('config-targets')
  .description(
    'Read a project config (.json/.mjs/.js) and print the --urls and --viewports values for the other commands',
  )
  .requiredOption('--config <path>', 'Project config file (see visual-check.config.example.ts)')
  .option('--base-url <url>', BASE_URL_HELP)
  .action(async (opts: { config: string; baseUrl?: string }) => {
    try {
      const config = await loadProjectConfigFile(opts.config);
      const { urls, viewports, warnings } = resolveConfigTargetsForCli(config, opts.baseUrl);
      for (const warning of warnings) console.error(`[visual-check] warning: ${warning}`);
      console.log(`--urls=${urls.join(',')}`);
      console.log(`--viewports=${viewports.map(formatViewportToken).join(',')}`);
      process.exit(0);
    } catch (err) {
      console.error(`[visual-check] config-targets: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(USAGE_OR_FATAL_EXIT_CODE);
    }
  });

// ---------------------------------------------------------------------------
// explain  (reads a report file; no browser, no network)
// ---------------------------------------------------------------------------

program
  .command('explain')
  .description('Explain a Visual Check report in a few plain-words sentences')
  .requiredOption('--report <path>', 'Path to a JSON report file (schema_version 1)')
  .option('--say', 'Speak the explanation aloud (macOS only)', false)
  .option('--json', 'Print { headline, sentences, text } as JSON instead of text', false)
  .action(async (opts: { report: string; say?: boolean; json?: boolean }) => {
    const raw = await fs.readFile(path.resolve(opts.report), 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`--report ${opts.report} is not valid JSON`);
    }
    const looksLikeReport =
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { schema_version?: unknown }).schema_version === 1 &&
      Array.isArray((parsed as { results?: unknown }).results);
    if (!looksLikeReport) {
      throw new Error(
        `--report ${opts.report} is not a Visual Check report (expected schema_version 1 with a results array)`,
      );
    }

    const explanation = explainReport(parsed as RunReport);
    if (opts.json) {
      console.log(JSON.stringify(explanation));
    } else {
      console.log(explanation.text);
    }
    if (opts.say) {
      await speak(explanation.text);
    }
    process.exit(0);
  });

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CommanderError) {
    process.exit(err.exitCode === 0 ? 0 : USAGE_OR_FATAL_EXIT_CODE);
  }
  console.error(`[visual-check] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(USAGE_OR_FATAL_EXIT_CODE);
});
