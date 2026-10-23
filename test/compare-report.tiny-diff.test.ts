import { describe, it, expect } from 'vitest';
import { renderCompareReport, CompareReportResult } from '../src/compare-report.js';

function baseResult(overrides: Partial<CompareReportResult> = {}): CompareReportResult {
  return {
    baseline: { url: 'https://example.com/baseline' },
    current: { url: 'https://example.com/current' },
    verdict: 'fail',
    diffPercentage: 0,
    httpStatus: 200,
    consoleErrors: [],
    loadTimeMs: 812,
    ...overrides,
  };
}

describe('compare report: a real but tiny pixel diff is never shown as 0%', () => {
  // One changed pixel on a 1280x800 capture is ~0.0000977% of the page.
  const onePixel = (1 / (1280 * 800)) * 100;

  it('renders "<0.001%" in the pixel_diff row and the meta strip, not "0%"', () => {
    const html = renderCompareReport(baseResult({ diffPercentage: onePixel }));
    expect(html).toContain('&lt;0.001% difference');
    expect(html).toContain('diff: <b>&lt;0.001%</b>');
    expect(html).not.toMatch(/>0% difference</);
    expect(html).not.toContain('diff: <b>0%</b>');
  });

  it('still renders an exact 0 as "0%"', () => {
    const html = renderCompareReport(baseResult({ verdict: 'pass', diffPercentage: 0 }));
    expect(html).toMatch(/>0% difference</);
    expect(html).toContain('diff: <b>0%</b>');
  });
});
