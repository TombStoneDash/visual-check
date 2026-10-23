import { describe, it, expect } from 'vitest';
import { buildReport } from '../src/report.js';
import { explainReport } from '../src/explain.js';
import { buildCompareTargetResult } from '../src/commands/compare.js';
import { BaselineLane, CaptureArtifact, TargetResult, ViewportSpec } from '../src/types.js';

// compare marks a target needs_baseline when the *baseline* page failed to
// load. explain used to read that as "has no approved picture yet", blaming
// the current site for a baseline that returned an HTTP error.

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const VIEWPORTS: ViewportSpec[] = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

function cap(url: string, viewport: string, extra: Partial<CaptureArtifact>): CaptureArtifact {
  return {
    url,
    viewport,
    screenshotPath: `/shots/${viewport}.png`,
    httpStatus: 200,
    consoleErrors: [],
    loadTimeMs: 100,
    ...extra,
  };
}

function compareResult(viewport: string, baseline: Partial<CaptureArtifact>): TargetResult {
  return buildCompareTargetResult({
    baselineCap: cap('https://prod.example.com/', viewport, baseline),
    currentCap: cap('https://staging.example.com/', viewport, {}),
    currentLabel: 'https://staging.example.com/',
    diff: null,
    pixelDiffThresholdPct: 5,
    loadTimeWarnMs: 3000,
  });
}

function explain(results: TargetResult[]) {
  return explainReport(
    buildReport({
      urls: ['https://staging.example.com/'],
      viewports: VIEWPORTS,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    }),
  );
}

describe('explainReport for a compare run whose baseline did not load', () => {
  it('names the baseline HTTP error instead of "no approved picture yet"', () => {
    const results = VIEWPORTS.map((vp) => compareResult(vp.name, { httpStatus: 500 }));
    expect(results.every((r) => r.verdict === 'needs_baseline')).toBe(true);

    const { sentences } = explain(results);
    expect(sentences[0]).toBe(
      'The baseline page for staging.example.com did not load on every screen size (error 500), so nothing was compared.',
    );
    expect(sentences.join(' ')).not.toContain('no approved picture');
  });

  it('says "no response" when the baseline capture itself failed', () => {
    const { sentences } = explain([compareResult('mobile', { httpStatus: null, error: 'timeout' })]);
    expect(sentences[0]).toBe(
      'The baseline page for staging.example.com did not load on phone (no response), so nothing was compared.',
    );
  });

  it('keeps "no approved picture yet" for a run target that simply has no baseline', () => {
    const plain: TargetResult = {
      ...compareResult('mobile', {}),
      verdict: 'needs_baseline',
      pass: false,
      reasons: ['pixel_diff: no baseline for this target'],
    };
    const { sentences } = explain([plain]);
    expect(sentences[0]).toBe('staging.example.com has no approved picture yet on phone.');
  });
});
