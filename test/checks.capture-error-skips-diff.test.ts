import { describe, it, expect } from 'vitest';
import { buildTargetResult, checkPixelDiff } from '../src/checks.js';
import { buildReport } from '../src/report.js';
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

describe('capture error skips the pixel diff check instead of erroring it', () => {
  it('(a) reports a single honest reason for a dead page with a baseline', () => {
    const t = buildTargetResult({
      cap: cap({ error: 'net::ERR_NAME_NOT_RESOLVED', httpStatus: null, loadTimeMs: 0 }),
      diff: null,
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });

    expect(t.verdict).toBe('error');
    expect(t.pass).toBe(false);
    const pixelDiffCheck = t.checks.find((c) => c.name === 'pixel_diff');
    expect(pixelDiffCheck?.status).toBe('skip');
    expect(pixelDiffCheck?.message).toBe('skipped due to capture error');
    expect(t.reasons).toEqual(['http_status: navigation error: name_resolution_failed']);
  });

  it('(b) flows into the run report as a runtime capture failure, not a visual-diff failure', () => {
    const t = buildTargetResult({
      cap: cap({ error: 'net::ERR_NAME_NOT_RESOLVED', httpStatus: null, loadTimeMs: 0 }),
      diff: null,
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });

    const report = buildReport({
      urls: ['https://trashalert.io'],
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [t],
      lane: { browser: 'chromium', os: 'macos', runner: 'macmini-local' },
    });

    expect(report.assertions.find((a) => a.name === 'capture_completed')?.status).toBe('fail');
    expect(report.assertions.find((a) => a.name === 'visual_diff_within_threshold')?.status).toBe(
      'pass',
    );
    expect(report.summary.errors).toBe(1);
    expect(report.terminal_state).toBe('BLOCKED_WITH_OWNER');
  });

  it('(c) a genuinely unreadable diff after a successful capture still errors', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: null,
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });

    const pixelDiffCheck = t.checks.find((c) => c.name === 'pixel_diff');
    expect(pixelDiffCheck?.status).toBe('error');
    expect(pixelDiffCheck?.message).toBe('diff could not be computed');
    expect(t.verdict).toBe('error');

    const report = buildReport({
      urls: ['https://trashalert.io'],
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [t],
      lane: { browser: 'chromium', os: 'macos', runner: 'macmini-local' },
    });
    expect(report.assertions.find((a) => a.name === 'visual_diff_within_threshold')?.status).toBe(
      'fail',
    );
  });

  it('(d) no-baseline skip takes priority over the capture-error skip', () => {
    const t = buildTargetResult({
      cap: cap({ error: 'net::ERR_NAME_NOT_RESOLVED', httpStatus: null, loadTimeMs: 0 }),
      diff: null,
      baselineExists: false,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });

    const pixelDiffCheck = t.checks.find((c) => c.name === 'pixel_diff');
    expect(pixelDiffCheck?.status).toBe('skip');
    expect(pixelDiffCheck?.message).toMatch(/^no baseline/);
  });

  it('(e) checkPixelDiff called with 3 arguments still errors on a missing diff', () => {
    expect(checkPixelDiff(null, 5, true).status).toBe('error');
  });

  it('(f) a normal passing target is unaffected', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: diff({ diffPercentage: 0.5 }),
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });

    expect(t.verdict).toBe('pass');
    expect(t.checks.find((c) => c.name === 'pixel_diff')?.status).toBe('pass');
  });
});
