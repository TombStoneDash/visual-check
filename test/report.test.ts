import { describe, it, expect } from 'vitest';
import { buildReport, summarize } from '../src/report.js';
import { BaselineLane, TargetResult, Verdict, ViewportSpec } from '../src/types.js';

function mkTarget(verdict: Verdict): TargetResult {
  const checks: TargetResult['checks'] =
    verdict === 'pass'
      ? [
          { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
          { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
        ]
      : verdict === 'warn'
        ? [
            { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
            { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
            { name: 'load_time', mode: 'warn', status: 'warn', message: 'slow', blocking: false },
          ]
        : verdict === 'fail'
          ? [
              { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
              { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12%', blocking: true },
            ]
          : verdict === 'needs_baseline'
            ? [
                { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
                { name: 'pixel_diff', mode: 'blocking', status: 'skip', message: 'no baseline', blocking: false },
              ]
            : [
                { name: 'http_status', mode: 'blocking', status: 'error', message: 'timeout', blocking: true },
              ];
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
    load_time_ms: 0,
    reasons: [],
    checks,
  };
}

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const vps: ViewportSpec[] = [{ name: 'mobile', width: 390, height: 844 }];

describe('summarize', () => {
  it('counts each verdict', () => {
    const s = summarize([
      mkTarget('pass'),
      mkTarget('pass'),
      mkTarget('warn'),
      mkTarget('fail'),
      mkTarget('error'),
      mkTarget('needs_baseline'),
    ]);
    expect(s).toEqual({
      total: 6,
      passed: 2,
      warnings: 1,
      failed: 1,
      errors: 1,
      needs_baseline: 1,
    });
  });
});

describe('buildReport.pass', () => {
  it('is true when all targets pass or warn', () => {
    const r = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [mkTarget('pass'), mkTarget('warn')],
      lane,
    });
    expect(r.pass).toBe(true);
    expect(r.summary.total).toBe(2);
    expect(r.terminal_state).toBe('READY_TO_REVIEW');
  });

  it('is false when any target fails', () => {
    const r = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [mkTarget('pass'), mkTarget('fail')],
      lane,
    });
    expect(r.pass).toBe(false);
    expect(r.terminal_state).toBe('READY_TO_REVIEW');
  });

  it('is false when any target errors', () => {
    const r = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [mkTarget('pass'), mkTarget('error')],
      lane,
    });
    expect(r.pass).toBe(false);
    expect(r.terminal_state).toBe('BLOCKED_WITH_OWNER');
  });

  it('is false when any target needs_baseline', () => {
    const r = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [mkTarget('pass'), mkTarget('needs_baseline')],
      lane,
    });
    expect(r.pass).toBe(false);
    expect(r.terminal_state).toBe('READY_TO_REVIEW');
  });

  it('attaches lane, schema version, and run_id', () => {
    const r = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [mkTarget('pass')],
      lane,
    });
    expect(r.schema_version).toBe(1);
    expect(r.run_id).toMatch(/^vc_/);
    expect(r.config.lane).toEqual(lane);
    expect(r.assertions.every((assertion) => assertion.status === 'pass')).toBe(true);
    expect(r.terminal_state).toBe('SHIPPED_PROVEN');
  });

  it('blocks with owner on unhealthy HTTP even when the capture produced a report', () => {
    const target = mkTarget('fail');
    target.checks = [
      { name: 'http_status', mode: 'blocking', status: 'fail', message: 'HTTP 500', blocking: true },
      { name: 'pixel_diff', mode: 'blocking', status: 'skip', message: 'no baseline', blocking: false },
    ];
    const r = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [target],
      lane,
    });
    expect(r.terminal_state).toBe('BLOCKED_WITH_OWNER');
    expect(r.assertions.find((assertion) => assertion.name === 'http_healthy')?.owner).toBe('site-owner');
  });
});
