import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderHtmlReport } from '../src/html-report.js';
import { buildReport } from '../src/report.js';
import { BaselineLane, CheckName, TargetResult, ViewportSpec } from '../src/types.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-html-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const vps: ViewportSpec[] = [{ name: 'mobile', width: 390, height: 844 }];

describe('renderHtmlReport safety', () => {
  it('escapes hostile strings across every rendered field, never emitting a live <script> or unescaped event handler', async () => {
    const maliciousTarget: TargetResult = {
      url: `https://evil.example/'&<script>alert(1)</script>`,
      viewport: 'mobile',
      verdict: 'fail',
      pass: false,
      status: 200,
      diff_percentage: 12.5,
      screenshot: path.join(tmp, 'does-not-exist.png'),
      baseline: null,
      diff_image: null,
      console_errors: 0,
      load_time_ms: 100,
      reasons: [`pixel_diff: '&<script>alert(1)</script> "><img src=x onerror=alert(1)> 12% > 5%`],
      checks: [
        {
          name: '<script>alert(1)</script>' as unknown as CheckName,
          mode: 'blocking',
          status: 'fail',
          message: `'&"><img src=x onerror=alert(1)>`,
          blocking: true,
        },
      ],
    };

    const report = buildReport({
      urls: [maliciousTarget.url],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [maliciousTarget],
      lane: {
        ...lane,
        runner: '<script>alert(1)</script>' as unknown as BaselineLane['runner'],
      },
    });
    report.run_id = `'&<script>alert(1)</script>`;
    report.timestamp = `"><img src=x onerror=alert(1)>`;

    const out = path.join(tmp, 'report-xss.html');
    await renderHtmlReport(report, out);
    const html = await fs.readFile(out, 'utf8');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');

    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('emits no <script> tag and no external http(s) asset references for a normal report', async () => {
    const target: TargetResult = {
      url: 'https://trashalert.io/',
      viewport: 'mobile',
      verdict: 'pass',
      pass: true,
      status: 200,
      diff_percentage: 0.1,
      screenshot: path.join(tmp, 'does-not-exist.png'),
      baseline: null,
      diff_image: null,
      console_errors: 0,
      load_time_ms: 500,
      reasons: [],
      checks: [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      ],
    };
    const report = buildReport({
      urls: [target.url],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [target],
      lane,
    });

    const out = path.join(tmp, 'report-normal.html');
    await renderHtmlReport(report, out);
    const html = await fs.readFile(out, 'utf8');

    expect(html).not.toContain('<script');
    const assetRefs = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    for (const ref of assetRefs) {
      expect(ref.startsWith('http://')).toBe(false);
      expect(ref.startsWith('https://')).toBe(false);
    }
  });

  it('fixes the dark-mode table-head contrast bug: uses a CSS custom property, not the old hard-coded rule', async () => {
    const target: TargetResult = {
      url: 'https://trashalert.io/',
      viewport: 'mobile',
      verdict: 'pass',
      pass: true,
      status: 200,
      diff_percentage: 0,
      screenshot: path.join(tmp, 'does-not-exist.png'),
      baseline: null,
      diff_image: null,
      console_errors: 0,
      load_time_ms: 500,
      reasons: [],
      checks: [],
    };
    const report = buildReport({
      urls: [target.url],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [target],
      lane,
    });

    const out = path.join(tmp, 'report-theme.html');
    await renderHtmlReport(report, out);
    const html = await fs.readFile(out, 'utf8');

    expect(html).toContain('var(--vc-');
    expect(html).toMatch(/table\.checks thead\s*\{\s*background:\s*var\(--vc-table-head-bg\);?\s*\}/);
    expect(html).not.toContain('table.checks thead { background: #fafafa; }');
  });

  it('still renders the placeholder when screenshots are missing', async () => {
    const target: TargetResult = {
      url: 'https://trashalert.io/',
      viewport: 'mobile',
      verdict: 'fail',
      pass: false,
      status: 200,
      diff_percentage: 12.5,
      screenshot: path.join(tmp, 'does-not-exist.png'),
      baseline: null,
      diff_image: null,
      console_errors: 0,
      load_time_ms: 500,
      reasons: ['pixel_diff: 12.5% > 5%'],
      checks: [
        { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12.5% > 5%', blocking: true },
      ],
    };
    const report = buildReport({
      urls: [target.url],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [target],
      lane,
    });

    const out = path.join(tmp, 'report-missing.html');
    await renderHtmlReport(report, out);
    const html = await fs.readFile(out, 'utf8');

    expect(html).toContain('placeholder');
  });
});
