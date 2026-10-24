import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { gateSummary } from '../scripts/gate-summary.mjs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('thresholds.json', () => {
  it('matches the THRESHOLDS.md table row for row', () => {
    const table: Record<string, number> = {};
    for (const m of read('THRESHOLDS.md').matchAll(/^\| ([a-z.]+) \| ([0-9.]+)% \|/gm)) {
      table[m[1]!] = Number(m[2]);
    }
    expect(Object.keys(table).length).toBeGreaterThan(0);
    expect(JSON.parse(read('thresholds.json'))).toEqual(table);
  });
});

describe('gate action', () => {
  it('references no secret other than GITHUB_TOKEN', () => {
    for (const file of ['action.yml', 'examples/consumer/visual-check.yml']) {
      const refs = read(file).match(/secrets\.[A-Za-z_]+/g) ?? [];
      expect(refs.filter((r) => r !== 'secrets.GITHUB_TOKEN')).toEqual([]);
    }
  });
});

describe('gateSummary', () => {
  const report = {
    terminal_state: 'READY_TO_REVIEW',
    summary: { total: 4, passed: 2, failed: 1, warnings: 0, errors: 0, needs_baseline: 1 },
    results: [
      { url: 'https://a/', viewport: 'mobile', diff_percentage: 0.01, verdict: 'pass' },
      { url: 'https://a/', viewport: 'desktop', diff_percentage: 2.5, verdict: 'fail' },
      { url: 'https://a/b', viewport: 'mobile', diff_percentage: 0.2, verdict: 'pass' },
      { url: 'https://a/c', viewport: 'mobile', diff_percentage: 0.1, verdict: 'pass' },
      { url: 'https://a/d', viewport: 'mobile', diff_percentage: null, verdict: 'needs_baseline' },
    ],
  };

  it('names project, threshold, terminal state and the top 3 diffs, largest first', () => {
    const out: string = gateSummary(report, { project: 'prelithic', threshold: '0.12', exitCode: '1' });
    expect(out).toContain('Visual Check: prelithic');
    expect(out).toContain('`READY_TO_REVIEW` (exit 1)');
    expect(out).toContain('0.12% of pixels');
    const rows = out.split('\n').filter((l) => l.startsWith('| https://'));
    expect(rows.map((r) => r.split(' | ')[2])).toEqual(['2.500', '0.200', '0.100']);
    expect(out).toContain('1 target(s) have no baseline');
  });

  it('says so when no report was written', () => {
    expect(gateSummary(null, { project: 'x', threshold: '1', exitCode: '3' })).toContain('No report was written (exit 3)');
  });

  it('counts errors and lists errors and no-diff fails with their first reason, errors first', () => {
    const out: string = gateSummary(
      {
        terminal_state: 'BLOCKED_WITH_OWNER',
        summary: { total: 3, passed: 0, failed: 1, warnings: 0, errors: 1, needs_baseline: 0 },
        results: [
          { url: 'https://a/x', viewport: 'mobile', diff_percentage: null, verdict: 'fail', reasons: ['http_status: HTTP 404'] },
          { url: 'https://a/y', viewport: 'desktop', diff_percentage: null, verdict: 'error', reasons: ['http_status: navigation error: navigation_timeout'] },
          { url: 'https://a/z', viewport: 'desktop', diff_percentage: 9, verdict: 'fail', reasons: ['pixel_diff: 9%'] },
        ],
      },
      { project: 'p', threshold: '1', exitCode: '3' },
    );
    expect(out).toContain('1 failed, 1 errored, 0 need a baseline');
    const items = out.split('\n').filter((l) => l.startsWith('- `'));
    expect(items).toEqual([
      '- `https://a/y` @ desktop: **error** — http_status: navigation error: navigation_timeout',
      '- `https://a/x` @ mobile: **fail** — http_status: HTTP 404',
    ]);
  });

  it('caps the attention list and escapes table pipes and backticks', () => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      url: `https://a/${i}`,
      viewport: 'mobile',
      diff_percentage: null,
      verdict: 'error',
      reasons: [],
    }));
    results.push({ url: 'https://a/?q=a|b`c', viewport: 'mobile', diff_percentage: 50, verdict: 'fail', reasons: [] });
    const out: string = gateSummary(
      { terminal_state: 'BLOCKED_WITH_OWNER', summary: { total: 13, passed: 0, failed: 1, warnings: 0, errors: 12, needs_baseline: 0 }, results },
      { project: 'p', threshold: '1', exitCode: '3' },
    );
    expect(out.split('\n').filter((l) => l.startsWith('- `'))).toHaveLength(10);
    expect(out).toContain('- …and 2 more in the report');
    expect(out).toContain('| https://a/?q=a\\|b`c | mobile | 50.000 | fail |');
  });

  it('describes an unreadable report instead of throwing', () => {
    expect(gateSummary({}, { project: '', threshold: '1', exitCode: '1' })).toContain(
      'Visual Check: (no project)\n\nThe report could not be read (exit 1)',
    );
  });
});
