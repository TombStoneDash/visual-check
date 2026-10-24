import { describe, it, expect } from 'vitest';
import { buildReport } from '../src/report.js';
import { explainReport } from '../src/explain.js';
import { BaselineLane, TargetResult, ViewportSpec } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const VIEWPORTS: ViewportSpec[] = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

function httpFail(url: string, viewport: string, status: number | null): TargetResult {
  return {
    url,
    viewport,
    verdict: 'fail',
    pass: false,
    status,
    diff_percentage: null,
    screenshot: '',
    baseline: 'baselines/x.png',
    diff_image: null,
    console_errors: 0,
    load_time_ms: 0,
    reasons: [],
    checks: [
      {
        name: 'http_status',
        mode: 'blocking',
        status: 'fail',
        message: status === null ? 'no HTTP response received' : `HTTP ${status}`,
        blocking: true,
      },
    ],
  };
}

function visualFail(url: string, viewport: string, diffPct: number | null): TargetResult {
  return {
    url,
    viewport,
    verdict: 'fail',
    pass: false,
    status: 200,
    diff_percentage: diffPct,
    screenshot: '',
    baseline: 'baselines/x.png',
    diff_image: null,
    console_errors: 0,
    load_time_ms: 0,
    reasons: [],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: 'diff', blocking: true },
    ],
  };
}

function explain(results: TargetResult[]) {
  const report = buildReport({
    urls: [...new Set(results.map((r) => r.url))],
    viewports: VIEWPORTS,
    pixelDiffThreshold: 5,
    loadTimeWarnMs: 3000,
    results,
    lane,
  });
  return explainReport(report);
}

describe('explainReport — mixed results across screen sizes', () => {
  it('names every HTTP status a site returned, not only the first one', () => {
    const e = explain([
      httpFail('https://shop.example', 'mobile', 404),
      httpFail('https://shop.example', 'tablet', 404),
      httpFail('https://shop.example', 'desktop', 500),
    ]);
    expect(e.sentences[0]).toBe('shop.example did not load on every screen size (error 404 and 500).');
  });

  it('keeps "no response" visible next to a real status code', () => {
    const e = explain([
      httpFail('https://shop.example', 'mobile', 503),
      httpFail('https://shop.example', 'desktop', null),
    ]);
    expect(e.sentences[0]).toBe('shop.example did not load on phone and desktop (error 503 and no response).');
  });

  it('still says "no response" when no status code came back at all', () => {
    const e = explain([httpFail('https://shop.example', 'mobile', null)]);
    expect(e.sentences[0]).toBe('shop.example did not load on phone (no response).');
  });

  it('never rounds a not-quite-total change up to "100% changed"', () => {
    const e = explain([visualFail('https://shop.example', 'desktop', 99.6)]);
    expect(e.sentences[0]).toBe('shop.example looks different on desktop (over 99% changed).');
  });

  it('says "100% changed" only when every pixel changed', () => {
    const e = explain([visualFail('https://shop.example', 'desktop', 100)]);
    expect(e.sentences[0]).toBe('shop.example looks different on desktop (100% changed).');
  });

  it('does not let a page-size change on one screen hide a measured diff on another', () => {
    const e = explain([
      visualFail('https://shop.example', 'mobile', null),
      visualFail('https://shop.example', 'desktop', 34.2),
    ]);
    expect(e.sentences[0]).toBe(
      'shop.example looks different on phone and desktop (the page size changed, and up to 34% changed elsewhere).',
    );
  });

  it('keeps the plain page-size sentence when no screen had a measured diff', () => {
    const e = explain([visualFail('https://shop.example', 'mobile', null)]);
    expect(e.sentences[0]).toBe('shop.example looks different on phone (the page size changed).');
  });
});
