import { describe, expect, it, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReport, runVerdict } from '../src/report.js';
import { renderHtmlReport } from '../src/html-report.js';
import { explainReport } from '../src/explain.js';
import { nextActionFor } from '../src/receipt.js';
import { BaselineLane, TargetResult, Verdict, ViewportSpec } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const vps: ViewportSpec[] = [{ name: 'mobile', width: 390, height: 844 }];
const tmpRoot = fs.mkdtemp(path.join(os.tmpdir(), 'vc-run-verdict-'));

afterAll(async () => {
  await fs.rm(await tmpRoot, { recursive: true, force: true });
});

function target(verdict: Verdict, url = 'https://example.com'): TargetResult {
  const checkStatus =
    verdict === 'needs_baseline' ? 'skip' : verdict === 'warn' ? 'warn' : verdict;
  return {
    url,
    viewport: 'mobile',
    verdict,
    pass: verdict === 'pass' || verdict === 'warn',
    status: verdict === 'error' ? null : 200,
    diff_percentage: verdict === 'pass' ? 0 : null,
    screenshot: null,
    baseline: null,
    diff_image: null,
    console_errors: verdict === 'warn' ? 1 : 0,
    load_time_ms: 100,
    reasons: verdict === 'pass' ? [] : [verdict],
    checks: [
      {
        name: verdict === 'warn' ? 'console_errors' : 'pixel_diff',
        mode: 'blocking',
        status: checkStatus,
        message: verdict,
        blocking: verdict === 'fail' || verdict === 'error',
      },
    ],
  } as TargetResult;
}

function report(results: TargetResult[]) {
  return buildReport({
    urls: [...new Set(results.map((r) => r.url))],
    viewports: vps,
    pixelDiffThreshold: 0.1,
    loadTimeWarnMs: 3000,
    results,
    lane,
  });
}

async function overallBadge(results: TargetResult[]): Promise<string> {
  const out = path.join(await tmpRoot, `${Math.random().toString(36).slice(2)}.html`);
  await renderHtmlReport(report(results), out);
  const html = await fs.readFile(out, 'utf8');
  const m = html.match(/<span class="overall"[^>]*>([^<]+)<\/span>/);
  return m?.[1] ?? '';
}

describe('runVerdict', () => {
  it('orders worst first, matching the CLI exit code', () => {
    expect(runVerdict(report([]).summary)).toBe('error');
    expect(runVerdict(report([target('pass')]).summary)).toBe('pass');
    expect(runVerdict(report([target('pass'), target('warn', 'https://b.test')]).summary)).toBe('warn');
    expect(runVerdict(report([target('warn'), target('needs_baseline', 'https://b.test')]).summary)).toBe(
      'needs_baseline',
    );
    expect(runVerdict(report([target('needs_baseline'), target('fail', 'https://b.test')]).summary)).toBe(
      'fail',
    );
    expect(runVerdict(report([target('fail'), target('error', 'https://b.test')]).summary)).toBe('error');
  });
});

describe('HTML report overall badge', () => {
  it('says NEEDS BASELINE, not FAIL, when every target only needs a baseline', async () => {
    expect(await overallBadge([target('needs_baseline')])).toBe('NEEDS BASELINE');
  });

  it('says ERROR when a capture errored', async () => {
    expect(await overallBadge([target('pass'), target('error', 'https://b.test')])).toBe('ERROR');
  });

  it('says WARN for a warning-only run', async () => {
    expect(await overallBadge([target('warn')])).toBe('WARN');
  });

  it('still says PASS and FAIL for those runs', async () => {
    expect(await overallBadge([target('pass')])).toBe('PASS');
    expect(await overallBadge([target('fail')])).toBe('FAIL');
  });
});

describe('explain headline', () => {
  it('uses "is" for exactly one fine page', () => {
    const e = explainReport(report([target('pass'), target('fail', 'https://b.test')]));
    expect(e.headline).toBe('2 pages checked. 1 is fine.');
  });

  it('keeps "are" for other counts', () => {
    const e = explainReport(report([target('pass'), target('pass', 'https://b.test')]));
    expect(e.headline).toBe('2 pages checked. 2 are fine.');
  });
});

describe('receipt next action for a run with no targets', () => {
  it('tells the caller to pass a URL instead of "review the run"', () => {
    const r = report([]);
    expect(r.terminal_state).toBe('BLOCKED_WITH_OWNER');
    expect(nextActionFor(r)).toBe('No targets were checked - pass at least one URL and re-run.');
  });
});

describe('compare console "overall" line', () => {
  it('says NEEDS_BASELINE, not FAIL, when the baseline is missing', async () => {
    const { runCompare } = await import('../src/commands/compare.js');
    const lines: string[] = [];
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-overall-'));
    try {
      const result = await runCompare({
        baseline: 'demo/fixtures/does-not-exist.html',
        current: 'demo/fixtures/page.html',
        viewports: vps,
        outRoot: out,
        threshold: 0.1,
        loadTimeWarnMs: 3000,
        lane,
        htmlOutPath: false,
        log: (line) => lines.push(line),
      });
      expect(result.report.summary.needs_baseline).toBe(1);
      expect(lines.join('\n')).toContain('[visual-check] overall: NEEDS_BASELINE');
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  }, 60_000);
});
