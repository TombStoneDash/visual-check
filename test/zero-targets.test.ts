import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/report.js';
import { TargetResult } from '../src/types.js';

function reportFor(results: TargetResult[]) {
  return buildReport({
    urls: ['https://example.com'],
    viewports: [{ name: 'mobile', width: 390, height: 844 }],
    pixelDiffThreshold: 5,
    loadTimeWarnMs: 3000,
    results,
    lane: { browser: 'chromium', os: 'macos', runner: 'macmini-local' },
  });
}

describe('zero-target report', () => {
  it('blocks with runtime ownership and keeps exactly five assertions', () => {
    const report = reportFor([]);
    expect(report.pass).toBe(false);
    expect(report.summary.total).toBe(0);
    expect(report.assertions).toHaveLength(5);
    expect(report.assertions.find((a) => a.name === 'capture_completed')).toEqual({
      name: 'capture_completed', status: 'fail', message: 'No targets were checked.', owner: 'runtime',
    });
    expect(report.terminal_state).toBe('BLOCKED_WITH_OWNER');
  });

  it('preserves a one-target passing report', () => {
    const target: TargetResult = {
      url: 'https://example.com', viewport: 'mobile', verdict: 'pass', pass: true,
      status: 200, diff_percentage: 0, screenshot: 'current.png', baseline: 'baseline.png',
      diff_image: null, console_errors: 0, load_time_ms: 100, reasons: [],
      checks: [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '0%', blocking: false },
      ],
    };
    const report = reportFor([target]);
    expect(report.pass).toBe(true);
    expect(report.summary.total).toBe(1);
    expect(report.results).toEqual([target]);
    expect(report.assertions).toHaveLength(5);
    expect(report.assertions.every((a) => a.status === 'pass')).toBe(true);
    expect(report.assertions[0]).toEqual({
      name: 'capture_completed', status: 'pass', message: 'All targets produced a capture result.',
    });
    expect(report.terminal_state).toBe('SHIPPED_PROVEN');
  });
});
