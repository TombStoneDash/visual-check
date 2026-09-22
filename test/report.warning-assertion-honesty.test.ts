import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildReport } from '../src/report.js';
import { renderHtmlReport } from '../src/html-report.js';
import { BaselineLane, TargetResult, ViewportSpec } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const vps: ViewportSpec[] = [{ name: 'mobile', width: 390, height: 844 }];

function mkTarget(overrides: Partial<TargetResult> & Pick<TargetResult, 'verdict' | 'checks'>): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    pass: overrides.verdict === 'pass' || overrides.verdict === 'warn',
    status: 200,
    diff_percentage: 0,
    screenshot: '',
    baseline: null,
    diff_image: null,
    console_errors: 0,
    load_time_ms: 0,
    reasons: [],
    ...overrides,
  };
}

function report(results: TargetResult[]) {
  return buildReport({
    urls: ['https://example.com'],
    viewports: vps,
    pixelDiffThreshold: 5,
    loadTimeWarnMs: 3000,
    results,
    lane,
  });
}

describe('warning-only runs report a warning, not a failure', () => {
  it('a passing target with a warning check produces a warn assertion, not a fail', () => {
    const target = mkTarget({
      verdict: 'pass',
      checks: [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
        { name: 'load_time', mode: 'warn', status: 'warn', message: 'slow load', blocking: false },
      ],
    });
    const r = report([target]);
    const nonblocking = r.assertions.find((a) => a.name === 'nonblocking_checks_clean');
    expect(nonblocking?.status).toBe('warn');
    expect(nonblocking?.owner).toBe('review-owner');
    expect(r.assertions.some((a) => a.status === 'fail')).toBe(false);

    // (b) still passes and is ready for human review, not silently shipped
    expect(r.pass).toBe(true);
    expect(r.terminal_state).toBe('READY_TO_REVIEW');
  });

  it('a fully clean run reports pass and SHIPPED_PROVEN', () => {
    const target = mkTarget({
      verdict: 'pass',
      checks: [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
      ],
    });
    const r = report([target]);
    expect(r.assertions.find((a) => a.name === 'nonblocking_checks_clean')?.status).toBe('pass');
    expect(r.terminal_state).toBe('SHIPPED_PROVEN');
  });

  it('a capture error still blocks even alongside a warning', () => {
    const target = mkTarget({
      verdict: 'error',
      checks: [
        { name: 'http_status', mode: 'blocking', status: 'error', message: 'timeout', blocking: true },
        { name: 'load_time', mode: 'warn', status: 'warn', message: 'slow load', blocking: false },
      ],
    });
    const r = report([target]);
    expect(r.assertions.find((a) => a.name === 'capture_completed')?.status).toBe('fail');
    expect(r.terminal_state).toBe('BLOCKED_WITH_OWNER');
  });

  it('an exceeded pixel diff still fails and is ready for review', () => {
    const target = mkTarget({
      verdict: 'fail',
      checks: [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12%', blocking: true },
      ],
    });
    const r = report([target]);
    expect(r.assertions.find((a) => a.name === 'visual_diff_within_threshold')?.status).toBe('fail');
    expect(r.pass).toBe(false);
    expect(r.terminal_state).toBe('READY_TO_REVIEW');
  });

  describe('renderHtmlReport', () => {
    const tmp = path.resolve('test-tmp-html-warning-honesty');

    beforeAll(async () => {
      await fs.mkdir(tmp, { recursive: true });
    });

    afterAll(async () => {
      await fs.rm(tmp, { recursive: true, force: true });
    });

    it('renders the warning message without calling it a FAIL', async () => {
      const target = mkTarget({
        verdict: 'pass',
        checks: [
          { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
          { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
          { name: 'load_time', mode: 'warn', status: 'warn', message: 'slow load', blocking: false },
        ],
      });
      const r = report([target]);
      const out = path.join(tmp, 'warning-only.html');
      await renderHtmlReport(r, out);
      const html = await fs.readFile(out, 'utf8');

      const message = r.assertions.find((a) => a.name === 'nonblocking_checks_clean')?.message;
      expect(message).toBeTruthy();
      expect(html).toContain(message as string);
      expect(html).not.toContain('FAIL');
    });
  });
});
