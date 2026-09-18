import { describe, it, expect } from 'vitest';
import { renderCompareReport, CompareReportResult } from '../src/compare-report.js';

function baseResult(overrides: Partial<CompareReportResult> = {}): CompareReportResult {
  return {
    baseline: { url: 'https://example.com/baseline' },
    current: { url: 'https://example.com/current' },
    verdict: 'pass',
    diffPercentage: 0.1,
    httpStatus: 200,
    consoleErrors: [],
    loadTimeMs: 812,
    ...overrides,
  };
}

const tinyPngBuffer = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

describe('renderCompareReport', () => {
  it('renders a pass verdict with a colored banner', () => {
    const html = renderCompareReport(baseResult({ verdict: 'pass' }));
    expect(html).toContain('PASS');
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('https://example.com/baseline');
    expect(html).toContain('https://example.com/current');
  });

  it('renders a warn verdict', () => {
    const html = renderCompareReport(baseResult({ verdict: 'warn', diffPercentage: 3.2 }));
    expect(html).toContain('WARN');
    expect(html).toContain('3.2%');
  });

  it('renders a fail verdict', () => {
    const html = renderCompareReport(baseResult({ verdict: 'fail', diffPercentage: 22.7 }));
    expect(html).toContain('FAIL');
    expect(html).toContain('22.7%');
  });

  it('renders an error verdict', () => {
    const html = renderCompareReport(
      baseResult({ verdict: 'error', httpStatus: null, diffPercentage: null }),
    );
    expect(html).toContain('ERROR');
    expect(html).toContain('no response');
  });

  it('shows a placeholder when image buffers are missing', () => {
    const html = renderCompareReport(baseResult());
    expect(html).toContain('No image captured');
    expect(html).not.toContain('data:image/png;base64');
  });

  it('embeds screenshots as data URIs when image buffers are present', () => {
    const png = tinyPngBuffer();
    const html = renderCompareReport(
      baseResult({
        baseline: { url: 'https://example.com/baseline', image: png },
        current: { url: 'https://example.com/current', image: png },
        diffImage: png,
      }),
    );
    const matches = html.match(/data:image\/png;base64,/g) ?? [];
    expect(matches.length).toBe(3);
    expect(html).not.toContain('No image captured');
  });

  it('HTML-escapes console error text', () => {
    const html = renderCompareReport(
      baseResult({
        verdict: 'warn',
        consoleErrors: ['<script>alert(1)</script>', 'Uncaught TypeError: a & b'],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Uncaught TypeError: a &amp; b');
  });

  it('HTML-escapes URLs so they cannot inject markup', () => {
    const html = renderCompareReport(
      baseResult({
        baseline: { url: 'https://example.com/<img src=x onerror=alert(1)>' },
      }),
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('never contains a <script> tag', () => {
    const html = renderCompareReport(
      baseResult({
        verdict: 'fail',
        consoleErrors: ['<script>evil()</script>'],
        baseline: { url: 'https://example.com/baseline', image: tinyPngBuffer() },
        current: { url: 'https://example.com/current', image: tinyPngBuffer() },
      }),
    );
    expect(html.toLowerCase()).not.toContain('<script');
  });
});
