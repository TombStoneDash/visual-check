import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BaselineLane,
  CheckName,
  CheckResult,
  RunAssertion,
  RunReport,
  RunSummary,
  TerminalState,
  TargetResult,
  ViewportSpec,
} from './types.js';

export function summarize(results: TargetResult[]): RunSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.verdict === 'pass').length,
    failed: results.filter((r) => r.verdict === 'fail').length,
    // Warnings and errors are independent check dimensions rather than
    // exclusive verdict buckets. A target can truthfully need a baseline and
    // also have a current-side warning or capture error.
    warnings: results.filter(
      (r) => r.verdict === 'warn' || r.checks.some((check) => check.status === 'warn'),
    ).length,
    errors: results.filter(
      (r) => r.verdict === 'error' || r.checks.some((check) => check.status === 'error'),
    ).length,
    needs_baseline: results.filter((r) => r.verdict === 'needs_baseline').length,
  };
}

function countCheckFailures(
  results: TargetResult[],
  name: CheckName,
  statuses: CheckResult['status'][],
): number {
  return results.reduce(
    (total, result) =>
      total +
      result.checks.filter((check) => check.name === name && statuses.includes(check.status)).length,
    0,
  );
}

export function buildAssertions(results: TargetResult[], summary: RunSummary): RunAssertion[] {
  const captureErrors = summary.errors;
  const httpFailures = countCheckFailures(results, 'http_status', ['fail', 'error']);
  const visualFailures = countCheckFailures(results, 'pixel_diff', ['fail', 'error']);
  const unspecifiedBlockingFailures =
    summary.failed > 0 && httpFailures === 0 && visualFailures === 0
      ? summary.failed
      : 0;

  return [
    {
      name: 'capture_completed',
      status: captureErrors === 0 ? 'pass' : 'fail',
      message:
        captureErrors === 0
          ? 'All targets produced a capture result.'
          : `${captureErrors} target(s) ended with capture/runtime errors.`,
      ...(captureErrors === 0 ? {} : { owner: 'runtime' as const }),
    },
    {
      name: 'http_healthy',
      status: httpFailures === 0 && unspecifiedBlockingFailures === 0 ? 'pass' : 'fail',
      message:
        httpFailures === 0 && unspecifiedBlockingFailures === 0
          ? 'All target HTTP checks were healthy.'
          : `${httpFailures + unspecifiedBlockingFailures} target(s) need site-owner investigation.`,
      ...(httpFailures === 0 && unspecifiedBlockingFailures === 0
        ? {}
        : { owner: 'site-owner' as const }),
    },
    {
      name: 'baselines_present',
      status: summary.needs_baseline === 0 ? 'pass' : 'fail',
      message:
        summary.needs_baseline === 0
          ? 'Every target had an approved baseline.'
          : `${summary.needs_baseline} target(s) need baseline review.`,
      ...(summary.needs_baseline === 0 ? {} : { owner: 'review-owner' as const }),
    },
    {
      name: 'visual_diff_within_threshold',
      status: visualFailures === 0 ? 'pass' : 'fail',
      message:
        visualFailures === 0
          ? 'All visual diffs were within threshold.'
          : `${visualFailures} target(s) exceeded the visual diff threshold.`,
      ...(visualFailures === 0 ? {} : { owner: 'review-owner' as const }),
    },
    {
      name: 'nonblocking_checks_clean',
      status: summary.warnings === 0 ? 'pass' : 'fail',
      message:
        summary.warnings === 0
          ? 'No warning-level checks fired.'
          : `${summary.warnings} target(s) have warning-level checks to review.`,
      ...(summary.warnings === 0 ? {} : { owner: 'review-owner' as const }),
    },
  ];
}

export function terminalStateForAssertions(assertions: RunAssertion[]): TerminalState {
  const blocked = assertions.some(
    (assertion) =>
      assertion.status === 'fail' &&
      (assertion.name === 'capture_completed' || assertion.name === 'http_healthy'),
  );
  if (blocked) return 'BLOCKED_WITH_OWNER';

  const needsReview = assertions.some((assertion) => assertion.status === 'fail');
  if (needsReview) return 'READY_TO_REVIEW';

  return 'SHIPPED_PROVEN';
}

export function buildReport(params: {
  urls: string[];
  viewports: ViewportSpec[];
  pixelDiffThreshold: number;
  loadTimeWarnMs: number;
  results: TargetResult[];
  lane: BaselineLane;
}): RunReport {
  const { urls, viewports, pixelDiffThreshold, loadTimeWarnMs, results, lane } = params;
  const summary = summarize(results);
  const assertions = buildAssertions(results, summary);
  const terminalState = terminalStateForAssertions(assertions);
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    run_id: `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    config: {
      urls,
      viewports: viewports.map((v) => v.name),
      pixel_diff_threshold: pixelDiffThreshold,
      load_time_warn_ms: loadTimeWarnMs,
      lane,
    },
    results,
    summary,
    assertions,
    terminal_state: terminalState,
    pass: summary.failed === 0 && summary.errors === 0 && summary.needs_baseline === 0,
  };
}

export async function writeJsonReport(report: RunReport, outPath: string): Promise<void> {
  const abs = path.resolve(outPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(report, null, 2));
}

const LABEL: Record<TargetResult['verdict'], string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  error: 'ERROR',
  needs_baseline: 'NEEDS_BASELINE',
};

export function formatTargetLine(r: TargetResult): string {
  const tail = r.reasons.length ? ` — ${r.reasons.join('; ')}` : '';
  return `${LABEL[r.verdict].padEnd(14)} ${r.url} @ ${r.viewport} (${r.load_time_ms}ms)${tail}`;
}

export function formatSummary(s: RunSummary): string {
  return [
    `  total:          ${s.total}`,
    `  passed:         ${s.passed}`,
    `  warnings:       ${s.warnings}`,
    `  failed:         ${s.failed}`,
    `  errors:         ${s.errors}`,
    `  needs_baseline: ${s.needs_baseline}`,
  ].join('\n');
}
