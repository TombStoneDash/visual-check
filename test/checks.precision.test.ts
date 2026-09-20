import { describe, it, expect } from 'vitest';
import {
  buildTargetResult,
  checkPixelDiff,
  formatDiffPercentage,
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
    baselineDimensions: { width: 1440, height: 900 },
    actualDimensions: { width: 1440, height: 900 },
    ...overrides,
  };
}

// A 1440x900 capture with a 3px difference: 3 / 1,296,000 * 100 % ≈ 0.000231%
const tinyDiff = diff({
  diffPercentage: (3 / 1_296_000) * 100,
  diffPixels: 3,
  totalPixels: 1_296_000,
});

describe('formatDiffPercentage', () => {
  it.each([
    [0, '0%'],
    [(3 / 1_296_000) * 100, '<0.001%'],
    [0.0001, '<0.001%'],
    [0.25, '0.250%'],
    [1, '1.000%'],
    [8.5, '8.500%'],
    [100, '100.000%'],
  ])('formats %p as %p', (pct, expected) => {
    expect(formatDiffPercentage(pct)).toBe(expected);
  });
});

describe('checkPixelDiff — tiny diffs at strict thresholds', () => {
  it('fails a 3-of-1,296,000-pixel diff at threshold 0 with a precise message, never "0.000%"', () => {
    const r = checkPixelDiff(tinyDiff, 0, true);
    expect(r.status).toBe('fail');
    expect(r.blocking).toBe(true);
    expect(r.message).toContain('<0.001%');
    expect(r.message).toContain('3 of 1,296,000');
    expect(r.message).not.toContain('0.000%');
    expect(r.metric).toBeGreaterThan(0);
  });

  it('passes the same tiny diff at threshold 0.1 with wording matching a normal pass', () => {
    const r = checkPixelDiff(tinyDiff, 0.1, true);
    expect(r.status).toBe('pass');
    expect(r.blocking).toBe(false);
    expect(r.message).toBe('pixel diff <0.001% within threshold');
  });

  it('passes with metric 0 when there is exactly zero diff', () => {
    const r = checkPixelDiff(diff({ diffPercentage: 0, diffPixels: 0, totalPixels: 1_296_000 }), 0, true);
    expect(r.status).toBe('pass');
    expect(r.metric).toBe(0);
    expect(r.message).toBe('pixel diff 0% within threshold');
  });

  it('fails a 0.25% diff at threshold 0.1 with the exact wording plus a pixel count', () => {
    const r = checkPixelDiff(
      diff({ diffPercentage: 0.25, diffPixels: 3240, totalPixels: 1_296_000 }),
      0.1,
      true,
    );
    expect(r.status).toBe('fail');
    expect(r.message).toBe('pixel diff 0.250% > 0.1% (3,240 of 1,296,000 pixels)');
    expect(r.metric).toBe(0.25);
  });

  it('leaves the dimension-mismatch path unchanged', () => {
    const r = checkPixelDiff(
      diff({ dimensionMismatch: true, diffPercentage: 100, diffPixels: -1 }),
      0,
      true,
    );
    expect(r.status).toBe('fail');
    expect(r.blocking).toBe(true);
    expect(r.metric).toBe(100);
    expect(r.message).toMatch(/dimensions/);
    expect(r.message).not.toContain('pixels)');
  });

  it.each([NaN, -1, Infinity])('errors on an invalid threshold (%p) instead of silently failing everything', (threshold) => {
    const r = checkPixelDiff(tinyDiff, threshold, true);
    expect(r.status).toBe('error');
    expect(r.blocking).toBe(true);
    expect(r.message).toBe('invalid pixel diff threshold');
  });
});

describe('buildTargetResult — diff_percentage precision', () => {
  it('keeps a tiny real difference non-zero in diff_percentage', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: tinyDiff,
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 0,
      loadTimeWarnMs: 3000,
    });
    expect(t.diff_percentage).not.toBe(0);
    expect(t.diff_percentage).toBeGreaterThan(0);
    expect(t.verdict).toBe('fail');
  });

  it('still rounds ordinary differences to 3 decimals', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: diff({ diffPercentage: 0.5 }),
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.diff_percentage).toBe(0.5);
  });

  it('reports diff_percentage 0 for an exact zero diff', () => {
    const t = buildTargetResult({
      cap: cap(),
      diff: diff({ diffPercentage: 0, diffPixels: 0 }),
      baselineExists: true,
      baselinePath: '/tmp/baseline.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.diff_percentage).toBe(0);
  });
});
