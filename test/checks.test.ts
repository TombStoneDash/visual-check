import { describe, it, expect } from 'vitest';
import {
  aggregateVerdict,
  buildTargetResult,
  checkConsoleErrors,
  checkHttpStatus,
  checkLoadTime,
  checkPixelDiff,
} from '../src/checks.js';
import { CaptureArtifact } from '../src/types.js';
import { DiffResult } from '../src/diff.js';

function cap(overrides: Partial<CaptureArtifact> = {}): CaptureArtifact {
  return {
    url: 'https://trashalert.io',
    viewport: 'mobile',
    screenshotPath: '/tmp/shot.png',
    httpStatus: 200,
    consoleErrors: [],
    loadTimeMs: 1200,
    ...overrides,
  };
}

function diff(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    diffPercentage: 1.0,
    diffPixels: 100,
    totalPixels: 10_000,
    diffImagePath: '/tmp/diff.png',
    dimensionMismatch: false,
    baselineDimensions: { width: 390, height: 844 },
    actualDimensions: { width: 390, height: 844 },
    ...overrides,
  };
}

describe('checkHttpStatus', () => {
  it('passes on 200', () => {
    const r = checkHttpStatus(cap({ httpStatus: 200 }));
    expect(r.status).toBe('pass');
    expect(r.blocking).toBe(false);
  });

  it('passes on 3xx redirects', () => {
    expect(checkHttpStatus(cap({ httpStatus: 301 })).status).toBe('pass');
  });

  it('fails on 404', () => {
    const r = checkHttpStatus(cap({ httpStatus: 404 }));
    expect(r.status).toBe('fail');
    expect(r.blocking).toBe(true);
  });

  it('fails on 500', () => {
    expect(checkHttpStatus(cap({ httpStatus: 500 })).status).toBe('fail');
  });

  it('errors when navigation failed', () => {
    const r = checkHttpStatus(
      cap({
        error:
          'page.goto: net::ERR_NAME_NOT_RESOLVED at https://preview.invalid/?token=canary\nCall log: details',
        httpStatus: null,
      }),
    );
    expect(r.status).toBe('error');
    expect(r.blocking).toBe(true);
    expect(r.message).toBe('navigation error: name_resolution_failed');
    expect(r.message).not.toMatch(/https?:|token|canary|Call log/i);
  });

  it('fails when no HTTP response arrived', () => {
    const r = checkHttpStatus(cap({ httpStatus: null }));
    expect(r.status).toBe('fail');
  });
});

describe('checkPixelDiff', () => {
  it('skips when baseline missing', () => {
    expect(checkPixelDiff(null, 5, false).status).toBe('skip');
  });

  it('errors when diff computation failed but baseline exists', () => {
    expect(checkPixelDiff(null, 5, true).status).toBe('error');
  });

  it('passes when diff is under threshold', () => {
    const r = checkPixelDiff(diff({ diffPercentage: 2.5 }), 5, true);
    expect(r.status).toBe('pass');
    expect(r.metric).toBe(2.5);
  });

  it('fails when diff exceeds threshold', () => {
    const r = checkPixelDiff(diff({ diffPercentage: 12 }), 5, true);
    expect(r.status).toBe('fail');
    expect(r.blocking).toBe(true);
  });

  it('fails on dimension mismatch', () => {
    const r = checkPixelDiff(diff({ dimensionMismatch: true, diffPercentage: 100 }), 5, true);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/dimensions/);
  });
});

describe('checkConsoleErrors', () => {
  it('passes with zero errors', () => {
    expect(checkConsoleErrors(cap()).status).toBe('pass');
  });
  it('warns but does not block when errors are present', () => {
    const r = checkConsoleErrors(cap({ consoleErrors: ['ReferenceError: foo'] }));
    expect(r.status).toBe('warn');
    expect(r.blocking).toBe(false);
    expect(r.message).toBe('1 console error event(s): console_error=1');
  });
  it('collapses raw page and request detail to bounded category counts', () => {
    const r = checkConsoleErrors(
      cap({
        consoleErrors: [
          'net::ERR_ATTACKER_FAKE https://attacker.invalid/?token=CONSOLE_QUERY_CANARY',
          'request_failed:image',
          'request_failed:image',
          'page_error',
        ],
      }),
    );
    expect(r.message).toBe(
      '4 console error event(s): console_error=1, page_error=1, request_failed:image=2',
    );
    expect(r.message).not.toMatch(/https?:|token=|QUERY_CANARY|ERR_ATTACKER_FAKE/i);
  });
});

describe('checkLoadTime', () => {
  it('passes when under budget', () => {
    expect(checkLoadTime(cap({ loadTimeMs: 1000 }), 3000).status).toBe('pass');
  });
  it('warns when over budget', () => {
    const r = checkLoadTime(cap({ loadTimeMs: 5000 }), 3000);
    expect(r.status).toBe('warn');
    expect(r.blocking).toBe(false);
  });
  it('skips on capture error', () => {
    expect(checkLoadTime(cap({ error: 'timeout' }), 3000).status).toBe('skip');
  });
});

describe('aggregateVerdict — precedence', () => {
  it('error beats everything', () => {
    const r = aggregateVerdict(
      [
        { name: 'http_status', mode: 'blocking', status: 'error', message: 'boom', blocking: true },
        { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: 'x', blocking: true },
      ],
      true,
    );
    expect(r.verdict).toBe('error');
  });

  it('blocking fail beats warn', () => {
    const r = aggregateVerdict(
      [
        { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: 'x', blocking: true },
        { name: 'load_time', mode: 'warn', status: 'warn', message: 'y', blocking: false },
      ],
      true,
    );
    expect(r.verdict).toBe('fail');
  });

  it('missing baseline returns needs_baseline when no other failures', () => {
    const r = aggregateVerdict(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: '200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'skip', message: 'no baseline', blocking: false },
      ],
      false,
    );
    expect(r.verdict).toBe('needs_baseline');
  });

  it('missing baseline still yields fail if HTTP fails', () => {
    const r = aggregateVerdict(
      [
        { name: 'http_status', mode: 'blocking', status: 'fail', message: '500', blocking: true },
        { name: 'pixel_diff', mode: 'blocking', status: 'skip', message: 'no baseline', blocking: false },
      ],
      false,
    );
    expect(r.verdict).toBe('fail');
  });

  it('warn-mode fail does not block overall verdict', () => {
    // console_errors is warn-mode — if it came back as 'fail', it still wouldn't block
    const r = aggregateVerdict(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: '200', blocking: false },
        { name: 'console_errors', mode: 'warn', status: 'warn', message: '3 errors', blocking: false },
      ],
      true,
    );
    expect(r.verdict).toBe('warn');
  });

  it('all-pass yields pass', () => {
    const r = aggregateVerdict(
      [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: '200', blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '1%', blocking: false },
      ],
      true,
    );
    expect(r.verdict).toBe('pass');
    expect(r.reasons).toEqual([]);
  });
});

describe('buildTargetResult — integration', () => {
  it('passes a healthy target', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: diff({ diffPercentage: 0.5 }),
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('pass');
    expect(t.pass).toBe(true);
    expect(t.diff_percentage).toBe(0.5);
    expect(t.checks.length).toBe(4);
  });

  it('fails on pixel diff over threshold', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: diff({ diffPercentage: 8.5 }),
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('fail');
    expect(t.pass).toBe(false);
    expect(t.reasons.some((r) => r.includes('pixel_diff'))).toBe(true);
  });

  it('returns needs_baseline when no baseline and otherwise healthy', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: null,
      baselineExists: false,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('needs_baseline');
    expect(t.pass).toBe(false);
  });

  it('warn still counts as pass:true in top-level flag', () => {
    const t = buildTargetResult({
      cap: cap({ loadTimeMs: 5000, consoleErrors: ['foo'] }),
      diff: diff({ diffPercentage: 0.5 }),
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('warn');
    expect(t.pass).toBe(true);
  });

  it('threads the diff changed_region through to the target result', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: diff({ diffPercentage: 8, changedRegion: { x: 10, y: 20, width: 100, height: 50 } }),
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.changed_region).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('sets changed_region to null when there is no baseline', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: null,
      baselineExists: false,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.changed_region).toBeNull();
  });

  it('surfaces capture errors as verdict=error', () => {
    const t = buildTargetResult({
      cap: cap({ error: 'net::ERR_FAILED', httpStatus: null, loadTimeMs: 0 }),
      diff: null,
      baselineExists: false,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('error');
    expect(t.pass).toBe(false);
  });
});
