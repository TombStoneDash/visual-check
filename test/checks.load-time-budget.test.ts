import { describe, it, expect } from 'vitest';
import { buildTargetResult, checkLoadTime } from '../src/checks.js';
import { CaptureArtifact } from '../src/types.js';
import { DiffResult } from '../src/diff.js';

function cap(overrides: Partial<CaptureArtifact> = {}): CaptureArtifact {
  return {
    url: 'https://trashalert.io',
    viewport: 'mobile',
    screenshotPath: 'shot.png',
    httpStatus: 200,
    consoleErrors: [],
    loadTimeMs: 800,
    ...overrides,
  };
}

const sameDiff: DiffResult = {
  diffPercentage: 0,
  diffPixels: 0,
  totalPixels: 10_000,
  diffImagePath: 'diff.png',
  dimensionMismatch: false,
  baselineDimensions: { width: 100, height: 100 },
  actualDimensions: { width: 100, height: 100 },
  changedRegion: null,
};

describe('checkLoadTime — invalid budget (library callers)', () => {
  for (const [label, budget] of [
    ['NaN', Number.NaN],
    ['negative', -1],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
    ['a string', '3000'],
  ] as const) {
    it(`is an error, not a fake slow-page warning, when the budget is ${label}`, () => {
      const r = checkLoadTime(cap(), budget as unknown as number);
      expect(r.status).toBe('error');
      expect(r.message).toBe('invalid load time budget');
      expect(r.message).not.toMatch(/NaN|undefined|Infinity/);
      expect(r.threshold).toBeUndefined();
    });
  }

  it('still accepts a zero budget (every measured load warns)', () => {
    const r = checkLoadTime(cap({ loadTimeMs: 1 }), 0);
    expect(r.status).toBe('warn');
    expect(r.message).toBe('load time 1ms > 0ms');
  });

  it('a capture error still skips, even with a bad budget', () => {
    expect(checkLoadTime(cap({ error: 'timeout' }), Number.NaN).status).toBe('skip');
  });

  it('makes the target an error instead of a passing warn', () => {
    const r = buildTargetResult({
      cap: cap(),
      diff: sameDiff,
      baselineExists: true,
      baselinePath: 'base.png',
      pixelDiffThresholdPct: 1,
      loadTimeWarnMs: Number.NaN,
    });
    expect(r.verdict).toBe('error');
    expect(r.pass).toBe(false);
    expect(r.reasons).toEqual(['load_time: invalid load time budget']);
  });
});

describe('checkLoadTime — load time not measured', () => {
  it('skips instead of printing "NaNms" when the capture has no usable load time', () => {
    const r = checkLoadTime(cap({ loadTimeMs: Number.NaN }), 3000);
    expect(r.status).toBe('skip');
    expect(r.message).toBe('load time was not measured');
    expect(r.metric).toBeUndefined();
  });
});
