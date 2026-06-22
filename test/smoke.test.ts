/**
 * smoke.test.ts
 *
 * Baseline smoke tests for the public entry point and untested formatters.
 * Goals:
 *   1. Prove the main index exports are importable and don't throw at module load.
 *   2. Cover formatTargetLine / formatSummary (zero assertions in existing suite).
 *   3. Cover buildAssertions + terminalStateForAssertions directly.
 *   4. Cover writeJsonReport round-trip.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// --- 1. Main entry point imports without throwing ----------------------------

import {
  checkPixelDiff,
  checkHttpStatus,
  checkConsoleErrors,
  checkLoadTime,
  aggregateVerdict,
  buildTargetResult,
  V1_CHECK_MODES,
  diffPngs,
  fileExists,
  buildAssertions,
  terminalStateForAssertions,
  summarize,
  buildReport,
  writeJsonReport,
  formatTargetLine,
  formatSummary,
  renderHtmlReport,
  buildReceipt,
  nextActionFor,
  runPool,
} from '../src/index.js';

describe('index exports smoke', () => {
  it('exports all expected symbols without throwing', () => {
    // Just asserting that the named exports are functions/objects proves the
    // module loaded and tree-shaking did not strip public API.
    expect(typeof checkPixelDiff).toBe('function');
    expect(typeof checkHttpStatus).toBe('function');
    expect(typeof checkConsoleErrors).toBe('function');
    expect(typeof checkLoadTime).toBe('function');
    expect(typeof aggregateVerdict).toBe('function');
    expect(typeof buildTargetResult).toBe('function');
    expect(typeof V1_CHECK_MODES).toBe('object');
    expect(typeof diffPngs).toBe('function');
    expect(typeof fileExists).toBe('function');
    expect(typeof buildAssertions).toBe('function');
    expect(typeof terminalStateForAssertions).toBe('function');
    expect(typeof summarize).toBe('function');
    expect(typeof buildReport).toBe('function');
    expect(typeof writeJsonReport).toBe('function');
    expect(typeof formatTargetLine).toBe('function');
    expect(typeof formatSummary).toBe('function');
    expect(typeof renderHtmlReport).toBe('function');
    expect(typeof buildReceipt).toBe('function');
    expect(typeof nextActionFor).toBe('function');
    expect(typeof runPool).toBe('function');
  });
});

// --- Helpers -----------------------------------------------------------------

import { TargetResult, RunSummary, BaselineLane, ViewportSpec } from '../src/types.js';

function mkTarget(verdict: TargetResult['verdict']): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    verdict,
    pass: verdict === 'pass' || verdict === 'warn',
    status: 200,
    diff_percentage: 0,
    screenshot: '',
    baseline: null,
    diff_image: null,
    console_errors: 0,
    load_time_ms: 1234,
    reasons: verdict === 'fail' ? ['pixel diff 12%'] : [],
    checks: [],
  };
}

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const vps: ViewportSpec[] = [{ name: 'mobile', width: 390, height: 844 }];

// --- 2. formatTargetLine -----------------------------------------------------

describe('formatTargetLine', () => {
  it('includes PASS label and url for a passing target', () => {
    const line = formatTargetLine(mkTarget('pass'));
    expect(line).toContain('PASS');
    expect(line).toContain('https://example.com');
    expect(line).toContain('mobile');
    expect(line).toContain('1234ms');
  });

  it('includes FAIL label for a failing target', () => {
    const line = formatTargetLine(mkTarget('fail'));
    expect(line).toContain('FAIL');
    expect(line).toContain('pixel diff 12%');
  });

  it('includes WARN label for a warn target', () => {
    expect(formatTargetLine(mkTarget('warn'))).toContain('WARN');
  });

  it('includes ERROR label for an error target', () => {
    expect(formatTargetLine(mkTarget('error'))).toContain('ERROR');
  });

  it('includes NEEDS_BASELINE label for needs_baseline target', () => {
    expect(formatTargetLine(mkTarget('needs_baseline'))).toContain('NEEDS_BASELINE');
  });
});

// --- 3. formatSummary --------------------------------------------------------

describe('formatSummary', () => {
  it('formats all summary fields', () => {
    const s: RunSummary = {
      total: 6,
      passed: 2,
      warnings: 1,
      failed: 1,
      errors: 1,
      needs_baseline: 1,
    };
    const out = formatSummary(s);
    expect(out).toContain('total:');
    expect(out).toContain('6');
    expect(out).toContain('passed:');
    expect(out).toContain('2');
    expect(out).toContain('warnings:');
    expect(out).toContain('failed:');
    expect(out).toContain('errors:');
    expect(out).toContain('needs_baseline:');
  });
});

// --- 4. buildAssertions + terminalStateForAssertions -------------------------

describe('buildAssertions', () => {
  it('all-pass when every target passes', () => {
    const results = [mkTarget('pass'), mkTarget('pass')];
    const summary = summarize(results);
    const assertions = buildAssertions(results, summary);
    expect(assertions.every((a) => a.status === 'pass')).toBe(true);
  });

  it('sets visual_diff_within_threshold to fail on pixel_diff fail', () => {
    const t = mkTarget('fail');
    t.checks = [
      { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12%', blocking: true },
    ];
    const summary = summarize([t]);
    const assertions = buildAssertions([t], summary);
    const visual = assertions.find((a) => a.name === 'visual_diff_within_threshold');
    expect(visual?.status).toBe('fail');
    expect(visual?.owner).toBe('review-owner');
  });

  it('sets baselines_present to fail when needs_baseline > 0', () => {
    const t = mkTarget('needs_baseline');
    const summary = summarize([t]);
    const assertions = buildAssertions([t], summary);
    const baseline = assertions.find((a) => a.name === 'baselines_present');
    expect(baseline?.status).toBe('fail');
    expect(baseline?.owner).toBe('review-owner');
  });
});

describe('terminalStateForAssertions', () => {
  it('returns SHIPPED_PROVEN when all assertions pass', () => {
    const assertions = [
      { name: 'capture_completed' as const, status: 'pass' as const, message: 'ok' },
      { name: 'http_healthy' as const, status: 'pass' as const, message: 'ok' },
      { name: 'baselines_present' as const, status: 'pass' as const, message: 'ok' },
      { name: 'visual_diff_within_threshold' as const, status: 'pass' as const, message: 'ok' },
      { name: 'nonblocking_checks_clean' as const, status: 'pass' as const, message: 'ok' },
    ];
    expect(terminalStateForAssertions(assertions)).toBe('SHIPPED_PROVEN');
  });

  it('returns BLOCKED_WITH_OWNER when http_healthy fails', () => {
    const assertions = [
      { name: 'capture_completed' as const, status: 'pass' as const, message: 'ok' },
      { name: 'http_healthy' as const, status: 'fail' as const, message: 'bad', owner: 'site-owner' as const },
      { name: 'baselines_present' as const, status: 'pass' as const, message: 'ok' },
      { name: 'visual_diff_within_threshold' as const, status: 'pass' as const, message: 'ok' },
      { name: 'nonblocking_checks_clean' as const, status: 'pass' as const, message: 'ok' },
    ];
    expect(terminalStateForAssertions(assertions)).toBe('BLOCKED_WITH_OWNER');
  });

  it('returns READY_TO_REVIEW when a non-blocking assertion fails', () => {
    const assertions = [
      { name: 'capture_completed' as const, status: 'pass' as const, message: 'ok' },
      { name: 'http_healthy' as const, status: 'pass' as const, message: 'ok' },
      { name: 'baselines_present' as const, status: 'fail' as const, message: 'missing', owner: 'review-owner' as const },
      { name: 'visual_diff_within_threshold' as const, status: 'pass' as const, message: 'ok' },
      { name: 'nonblocking_checks_clean' as const, status: 'pass' as const, message: 'ok' },
    ];
    expect(terminalStateForAssertions(assertions)).toBe('READY_TO_REVIEW');
  });
});

// --- 5. writeJsonReport round-trip -------------------------------------------

const tmpDir = path.resolve('/tmp/visual-check-smoke-test');

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('writeJsonReport', () => {
  it('writes a valid JSON file that round-trips back to the report', async () => {
    const report = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [mkTarget('pass')],
      lane,
    });

    const outPath = path.join(tmpDir, 'smoke-report.json');
    await writeJsonReport(report, outPath);

    const raw = await fs.readFile(outPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.schema_version).toBe(1);
    expect(parsed.pass).toBe(true);
    expect(parsed.terminal_state).toBe('SHIPPED_PROVEN');
    expect(parsed.run_id).toMatch(/^vc_/);
  });
});
