import { describe, it, expect } from 'vitest';
import { buildReport } from '../src/report.js';
import { explainReport } from '../src/explain.js';
import { BaselineLane, TargetResult, ViewportSpec } from '../src/types.js';

// explain groups problems per target. Before, the group key and label were
// host + path only, so two targets on different ports or with different
// queries were merged: their screen sizes pooled into "every screen size"
// and the largest diff of either was reported for both.

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const VIEWPORTS: ViewportSpec[] = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

function looksDifferent(url: string, viewport: string, diffPct: number): TargetResult {
  return {
    url,
    viewport,
    verdict: 'fail',
    pass: false,
    status: 200,
    diff_percentage: diffPct,
    screenshot: '',
    baseline: 'b.png',
    diff_image: null,
    console_errors: 0,
    load_time_ms: 0,
    reasons: [],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: `pixel diff ${diffPct}%`, blocking: true },
    ],
  };
}

function explain(results: TargetResult[]) {
  return explainReport(
    buildReport({
      urls: [...new Set(results.map((r) => r.url))],
      viewports: VIEWPORTS,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    }),
  );
}

describe('explainReport target identity', () => {
  it('keeps two ports on one host apart', () => {
    const { sentences } = explain([
      looksDifferent('http://localhost:3000/', 'mobile', 40),
      looksDifferent('http://localhost:4000/', 'tablet', 2),
      looksDifferent('http://localhost:4000/', 'desktop', 3),
    ]);
    expect(sentences.slice(0, 2)).toEqual([
      'localhost:3000 looks different on phone (40% changed).',
      'localhost:4000 looks different on tablet and desktop (3% changed).',
    ]);
  });

  it('keeps two queries on one path apart', () => {
    const { sentences } = explain([
      looksDifferent('https://shop.com/p?id=1', 'mobile', 50),
      looksDifferent('https://shop.com/p?id=2', 'tablet', 1),
      looksDifferent('https://shop.com/p?id=2', 'desktop', 1),
    ]);
    expect(sentences.slice(0, 2)).toEqual([
      'shop.com/p?id=1 looks different on phone (50% changed).',
      'shop.com/p?id=2 looks different on tablet and desktop (1% changed).',
    ]);
  });

  it('does not pool http:// and https:// of one host into "every screen size"', () => {
    const { sentences } = explain([
      looksDifferent('http://x.io', 'mobile', 10),
      looksDifferent('https://x.io', 'tablet', 10),
      looksDifferent('https://x.io', 'desktop', 10),
    ]);
    expect(sentences.some((s) => s.includes('every screen size'))).toBe(false);
    expect(sentences.slice(0, 2)).toEqual([
      'x.io looks different on phone (10% changed).',
      'x.io looks different on tablet and desktop (10% changed).',
    ]);
  });

  it('still drops a default port and a bare "?"', () => {
    const { sentences } = explain([looksDifferent('https://www.x.io:443/a?', 'mobile', 10)]);
    expect(sentences[0]).toBe('x.io/a looks different on phone (10% changed).');
  });
});
