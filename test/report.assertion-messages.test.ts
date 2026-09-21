import { describe, it, expect } from 'vitest';
import { buildReport } from '../src/report.js';
import { BaselineLane, TargetResult, ViewportSpec } from '../src/types.js';

function mkTarget(checks: TargetResult['checks'], verdict: TargetResult['verdict']): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    verdict,
    pass: verdict === 'pass' || verdict === 'warn',
    status: 200,
    diff_percentage: null,
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

describe('visual_diff_within_threshold message honesty', () => {
  it('an uncomputed diff fails but does not claim the threshold was exceeded', () => {
    const target = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        {
          name: 'pixel_diff',
          mode: 'blocking',
          status: 'error',
          message: 'diff could not be computed',
          blocking: true,
        },
      ],
      'error',
    );
    const r = report([target]);
    const visual = r.assertions.find((a) => a.name === 'visual_diff_within_threshold');
    expect(visual?.status).toBe('fail');
    expect(visual?.message).toContain('could not be compared');
    expect(visual?.message).not.toContain('exceeded');
    expect(visual?.owner).toBe('runtime');
  });

  it('an exceeded diff reports the original message and owner', () => {
    const target = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12%', blocking: true },
      ],
      'fail',
    );
    const r = report([target]);
    const visual = r.assertions.find((a) => a.name === 'visual_diff_within_threshold');
    expect(visual?.status).toBe('fail');
    expect(visual?.message).toBe('1 target(s) exceeded the visual diff threshold.');
    expect(visual?.owner).toBe('review-owner');
  });

  it('combines exceeded and uncomputed counts honestly', () => {
    const exceeded = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12%', blocking: true },
      ],
      'fail',
    );
    const notComputed = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        {
          name: 'pixel_diff',
          mode: 'blocking',
          status: 'error',
          message: 'diff could not be computed',
          blocking: true,
        },
      ],
      'error',
    );
    const r = report([exceeded, notComputed]);
    const visual = r.assertions.find((a) => a.name === 'visual_diff_within_threshold');
    expect(visual?.status).toBe('fail');
    expect(visual?.message).toContain('1 target(s) exceeded');
    expect(visual?.message).toContain('1 more could not be compared');
    expect(visual?.owner).toBe('review-owner');
  });

  it('all passing targets report the unchanged pass message', () => {
    const target = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
      ],
      'pass',
    );
    const r = report([target]);
    const visual = r.assertions.find((a) => a.name === 'visual_diff_within_threshold');
    expect(visual?.status).toBe('pass');
    expect(visual?.message).toBe('All visual diffs were within threshold.');
    expect(visual?.owner).toBeUndefined();
  });

  it('an uncomputed diff is still treated as a visual problem, not an HTTP one', () => {
    const target = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        {
          name: 'pixel_diff',
          mode: 'blocking',
          status: 'error',
          message: 'diff could not be computed',
          blocking: true,
        },
      ],
      'error',
    );
    const r = report([target]);
    expect(r.assertions.find((a) => a.name === 'http_healthy')?.status).toBe('pass');
    expect(r.assertions.find((a) => a.name === 'capture_completed')?.status).toBe('fail');
    expect(r.terminal_state).toBe('BLOCKED_WITH_OWNER');
  });

  it('always produces exactly five assertions', () => {
    const passTarget = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
      ],
      'pass',
    );
    const errorTarget = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        {
          name: 'pixel_diff',
          mode: 'blocking',
          status: 'error',
          message: 'diff could not be computed',
          blocking: true,
        },
      ],
      'error',
    );
    const failTarget = mkTarget(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12%', blocking: true },
      ],
      'fail',
    );

    expect(report([passTarget]).assertions).toHaveLength(5);
    expect(report([errorTarget]).assertions).toHaveLength(5);
    expect(report([failTarget]).assertions).toHaveLength(5);
    expect(report([failTarget, errorTarget]).assertions).toHaveLength(5);
  });
});
