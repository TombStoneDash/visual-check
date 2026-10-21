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
});
