import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { htmlReportPathFor, renderHtmlReport } from '../src/html-report.js';
import { buildReport } from '../src/report.js';
import { BaselineLane, TargetResult, ViewportSpec } from '../src/types.js';

const tmp = path.resolve('test-tmp-html');

beforeAll(async () => {
  await fs.mkdir(tmp, { recursive: true });
  // Make one real PNG so base64 embedding has something to bite into
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 255;
  }
  await fs.writeFile(path.join(tmp, 'pixel.png'), PNG.sync.write(png));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('htmlReportPathFor', () => {
  it('places HTML adjacent to JSON with same basename', () => {
    expect(path.normalize(htmlReportPathFor('/tmp/reports/latest.json'))).toBe(
      path.normalize('/tmp/reports/latest.html'),
    );
    expect(path.normalize(htmlReportPathFor('reports/run-42.json'))).toBe(
      path.normalize('reports/run-42.html'),
    );
  });
});

describe('renderHtmlReport', () => {
  const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
  const vps: ViewportSpec[] = [{ name: 'mobile', width: 390, height: 844 }];

  const target: TargetResult = {
    url: 'https://trashalert.io/<script>',
    viewport: 'mobile',
    verdict: 'fail',
    pass: false,
    status: 200,
    diff_percentage: 12.5,
    screenshot: path.join(tmp, 'pixel.png'),
    baseline: path.join(tmp, 'pixel.png'),
    diff_image: path.join(tmp, 'pixel.png'),
    console_errors: 2,
    load_time_ms: 1180,
    reasons: ['pixel_diff: 12.5% > 5%'],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12.5% > 5%', blocking: true },
      { name: 'console_errors', mode: 'warn', status: 'warn', message: '2 errors', blocking: false },
      { name: 'load_time', mode: 'warn', status: 'pass', message: '1180ms', blocking: false },
    ],
  };

  it('writes a standalone HTML file', async () => {
    const out = path.join(tmp, 'report.html');
    const report = buildReport({
      urls: ['https://trashalert.io/<script>'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [target],
      lane,
    });
    await renderHtmlReport(report, out);
    const html = await fs.readFile(out, 'utf8');

    // Structural sanity
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('Visual Check');
    expect(html).toContain('FAIL');

    // Screenshots are embedded as data URIs, not filesystem paths
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain(path.join(tmp, 'pixel.png'));

    // XSS-critical: script-looking URL must be escaped
    expect(html).not.toContain('https://trashalert.io/<script>');
    expect(html).toContain('https://trashalert.io/&lt;script&gt;');

    // Per-check table is present
    expect(html).toContain('pixel_diff');
    expect(html).toContain('http_status');
    expect(html).toContain('console_errors');
  });

  it('handles missing screenshots gracefully (placeholder rendering)', async () => {
    const out = path.join(tmp, 'report-missing.html');
    const noImgTarget: TargetResult = {
      ...target,
      screenshot: path.join(tmp, 'does-not-exist.png'),
      baseline: null,
      diff_image: null,
    };
    const report = buildReport({
      urls: [target.url],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [noImgTarget],
      lane,
    });
    await renderHtmlReport(report, out);
    const html = await fs.readFile(out, 'utf8');
    expect(html).toContain('placeholder');
  });
});
