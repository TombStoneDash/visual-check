import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HTML_REPORT_BADGE_COLORS, renderHtmlReport } from '../src/html-report.js';
import { buildReport } from '../src/report.js';
import { contrastRatio } from '../src/report-theme.js';
import { BaselineLane, TargetResult } from '../src/types.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-html-badges-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };

function target(diff: number | null): TargetResult {
  return {
    url: 'https://example.com/',
    viewport: 'mobile',
    verdict: 'pass',
    pass: true,
    status: 200,
    diff_percentage: diff,
    screenshot: path.join(tmp, 'missing.png'),
    baseline: null,
    diff_image: null,
    console_errors: 0,
    load_time_ms: 100,
    reasons: [],
    checks: [],
  };
}

async function render(t: TargetResult): Promise<string> {
  const report = buildReport({
    urls: [t.url],
    viewports: [{ name: 'mobile', width: 390, height: 844 }],
    pixelDiffThreshold: 5,
    loadTimeWarnMs: 3000,
    results: [t],
    lane,
  });
  const out = path.join(tmp, 'report.html');
  await renderHtmlReport(report, out);
  return fs.readFile(out, 'utf8');
}

describe('HTML report verdict badges', () => {
  it('every verdict badge colour pair meets WCAG AA (4.5:1)', () => {
    expect(HTML_REPORT_BADGE_COLORS.map((c) => c.verdict).sort()).toEqual(
      ['error', 'fail', 'needs_baseline', 'pass', 'warn'],
    );
    for (const { verdict, fg, bg } of HTML_REPORT_BADGE_COLORS) {
      expect(contrastRatio(fg, bg), `${verdict} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('HTML report diff percentage', () => {
  it('shows a 1-pixel mobile diff as "<0.001%", not a raw float', async () => {
    // 1 of 390x844 pixels; buildTargetResult keeps the unrounded value so
    // the number never reads as zero.
    const html = await render(target(100 / (390 * 844)));
    expect(html).toContain('diff: <b>&lt;0.001%</b>');
    expect(html).not.toMatch(/diff: <b>0\.000\d{4,}/);
  });

  it('shows an ordinary diff with the same 3-place format as the check message', async () => {
    const html = await render(target(0.1 + 0.2));
    expect(html).toContain('diff: <b>0.300%</b>');
  });

  it('keeps 0% and the no-diff dash', async () => {
    expect(await render(target(0))).toContain('diff: <b>0%</b>');
    expect(await render(target(null))).toContain('diff: <b>—</b>');
  });
});
