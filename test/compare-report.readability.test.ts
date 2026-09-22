import { describe, it, expect } from 'vitest';
import {
  renderCompareReport,
  contrastRatio,
  COMPARE_REPORT_COLOR_PAIRS,
  CompareReportResult,
} from '../src/compare-report.js';

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

function styleBlock(html: string): string {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!m) throw new Error('no <style> block found');
  return m[1];
}

function rowStatus(html: string, checkName: string): string {
  const re = new RegExp(`<tr class="check-(\\w+)">\\s*<td><code>${checkName}</code></td>`);
  const m = re.exec(html);
  if (!m) throw new Error(`no row found for check ${checkName}`);
  return m[1];
}

describe('compare report color pairs', () => {
  it('every declared pair meets WCAG AA (>= 4.5:1)', () => {
    for (const pair of COMPARE_REPORT_COLOR_PAIRS) {
      expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every declared pair color is actually used in the rendered output', () => {
    // Banner colors are verdict-specific and only ever render one at a
    // time, so cover every verdict (plus console errors, for the
    // console-error pair) before checking the full color list.
    const verdicts: CompareReportResult['verdict'][] = ['pass', 'warn', 'fail', 'error', 'needs_baseline'];
    const html = verdicts
      .map((verdict) =>
        renderCompareReport(
          baseResult({ verdict, diffPercentage: 22.7, consoleErrors: ['boom'] }),
        ),
      )
      .join('\n');
    for (const pair of COMPARE_REPORT_COLOR_PAIRS) {
      expect(html).toContain(pair.fg);
      expect(html).toContain(pair.bg);
    }
  });
});

describe('contrastRatio', () => {
  it('is 21 for pure black on pure white', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
  });

  it('is below 4.5 for #777 on white', () => {
    expect(contrastRatio('#777', '#fff')).toBeLessThan(4.5);
  });
});

describe('font sizes and color-scheme', () => {
  it('has no font-size or font shorthand below 14px', () => {
    const html = renderCompareReport(baseResult());
    const css = styleBlock(html);
    const sizeMatches = css.match(/font(?:-size)?:\s*(\d+(?:\.\d+)?)px/g) ?? [];
    expect(sizeMatches.length).toBeGreaterThan(0);
    for (const decl of sizeMatches) {
      const n = Number(/(\d+(?:\.\d+)?)px/.exec(decl)![1]);
      expect(n).toBeGreaterThanOrEqual(14);
    }
  });

  it('does not declare color-scheme: light dark', () => {
    const html = renderCompareReport(baseResult());
    expect(html).not.toContain('light dark');
    expect(html).toContain('color-scheme: light');
  });
});

describe('pixel_diff status reflects pixels, not the overall verdict', () => {
  it('fail verdict + http 500 + 0% diff -> pixel_diff pass, http_status fail', () => {
    const html = renderCompareReport(
      baseResult({ verdict: 'fail', httpStatus: 500, diffPercentage: 0 }),
    );
    expect(rowStatus(html, 'pixel_diff')).toBe('pass');
    expect(rowStatus(html, 'http_status')).toBe('fail');
  });

  it('warn verdict + console errors + 0% diff -> pixel_diff pass', () => {
    const html = renderCompareReport(
      baseResult({ verdict: 'warn', consoleErrors: ['oops'], diffPercentage: 0 }),
    );
    expect(rowStatus(html, 'pixel_diff')).toBe('pass');
  });

  it('fail verdict + 22.7% diff -> pixel_diff fail', () => {
    const html = renderCompareReport(baseResult({ verdict: 'fail', diffPercentage: 22.7 }));
    expect(rowStatus(html, 'pixel_diff')).toBe('fail');
  });

  it('null diffPercentage -> pixel_diff skip, "not compared"', () => {
    const html = renderCompareReport(baseResult({ verdict: 'error', diffPercentage: null }));
    expect(rowStatus(html, 'pixel_diff')).toBe('skip');
    expect(html).toContain('not compared');
  });
});

describe('diff percentage formatting', () => {
  it('renders 0.1 + 0.2 as "0.3%", never the raw float', () => {
    const html = renderCompareReport(baseResult({ verdict: 'warn', diffPercentage: 0.1 + 0.2 }));
    expect(html).toContain('0.3%');
    expect(html).not.toContain('0.30000000000000004');
  });

  it('renders an exact 0 as "0%"', () => {
    const html = renderCompareReport(baseResult({ verdict: 'pass', diffPercentage: 0 }));
    expect(html).toMatch(/>0% difference</);
  });
});

describe('status glyphs', () => {
  it('pass, fail, warn, and skip cells each carry a text glyph', () => {
    const passHtml = renderCompareReport(baseResult({ verdict: 'pass', diffPercentage: 0.1 }));
    expect(passHtml).toContain('✓ pass');

    const failHtml = renderCompareReport(baseResult({ verdict: 'fail', diffPercentage: 22.7 }));
    expect(failHtml).toContain('✗ fail');

    const warnHtml = renderCompareReport(
      baseResult({ verdict: 'warn', consoleErrors: ['oops'], diffPercentage: 3.2 }),
    );
    expect(warnHtml).toContain('! warn');

    const skipHtml = renderCompareReport(baseResult({ diffPercentage: null }));
    expect(skipHtml).toContain('– skip');
  });
});

describe('escaping is preserved', () => {
  it('escapes a hostile baseline URL', () => {
    const html = renderCompareReport(
      baseResult({ baseline: { url: 'https://example.com/<img src=x onerror=alert(1)>' } }),
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes hostile console error text', () => {
    const html = renderCompareReport(
      baseResult({ verdict: 'warn', consoleErrors: ['<script>alert(1)</script>'] }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
