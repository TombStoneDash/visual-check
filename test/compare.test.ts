import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// --- Hoisted mocks -----------------------------------------------------------
// Same pattern as test/deploy-gate.test.ts: replace the browser + pixel-diff
// engine so orchestration is exercised without a real Chromium instance.

vi.mock('../src/capture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/capture.js')>();
  return {
    ...actual,
    Capturer: class {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async capture(url: string, vp: { name: string }, outPath: string) {
      const { promises: fsp } = await import('node:fs');
      const pathMod = await import('node:path');
      await fsp.mkdir(pathMod.dirname(outPath), { recursive: true });
      await fsp.writeFile(outPath, Buffer.from([137, 80, 78, 71]));
      // Loopback fixtures (127.0.0.1/localhost) are real HTTP servers spun
      // up by the health-gate regression tests below — resolve their real
      // status so the test exercises actual response codes. Every other
      // http(s) URL in this suite is a placeholder (never dialed) and keeps
      // the pre-existing default of 200, matching a healthy capture.
      let httpStatus = 200;
      if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url)) {
        const res = await fetch(url, { redirect: 'follow' });
        await res.arrayBuffer().catch(() => {});
        httpStatus = res.status;
      }
      return {
        url,
        viewport: vp.name,
        screenshotPath: outPath,
        httpStatus,
        consoleErrors: [],
        loadTimeMs: 100,
      };
    }
    },
  };
});

vi.mock('../src/diff.js', () => ({
  diffPngs: vi.fn(async () => ({
    diffPercentage: 1,
    diffPixels: 10,
    totalPixels: 1000,
    diffImagePath: null,
    dimensionMismatch: false,
    baselineDimensions: { width: 100, height: 100 },
    actualDimensions: { width: 100, height: 100 },
    changedRegion: { x: 5, y: 5, width: 10, height: 10 },
  })),
}));

// --- Imports that use the mocked modules --------------------------------------

import {
  resolveCompareTarget,
  buildCompareTargetResult,
  isHealthyBaseline,
  runCompare,
} from '../src/commands/compare.js';
import { BaselineLane, CaptureArtifact } from '../src/types.js';
import { DiffResult } from '../src/diff.js';

describe('resolveCompareTarget', () => {
  it('passes http(s) URLs through unchanged', () => {
    const t = resolveCompareTarget('https://example.com/page');
    expect(t.url).toBe('https://example.com/page');
    expect(t.label).toBe('https://example.com/page');
  });

  it('passes file:// URLs through unchanged', () => {
    const t = resolveCompareTarget('file:///tmp/page.html');
    expect(t.url).toBe('file:///tmp/page.html');
    expect(t.label).toBe('file:///tmp/page.html');
  });

  it('resolves a relative local path to a file:// URL with a relative label', () => {
    const baseDir = path.resolve('demo-fixture-base');
    const t = resolveCompareTarget('sub/page.html', baseDir);
    expect(t.url.startsWith('file://')).toBe(true);
    expect(t.label).toBe(path.join('sub', 'page.html'));
  });

  it('resolves an absolute local path and derives a relative label', () => {
    const baseDir = path.resolve('demo-fixture-base');
    const abs = path.join(baseDir, 'nested', 'page.html');
    const t = resolveCompareTarget(abs, baseDir);
    expect(t.url.startsWith('file://')).toBe(true);
    expect(t.label).toBe(path.join('nested', 'page.html'));
  });
});

describe('buildCompareTargetResult', () => {
  function cap(overrides: Partial<CaptureArtifact> = {}): CaptureArtifact {
    return {
      url: 'https://example.com/current',
      viewport: 'mobile',
      screenshotPath: '/tmp/current.png',
      httpStatus: 200,
      consoleErrors: [],
      loadTimeMs: 500,
      ...overrides,
    };
  }

  function diffResult(overrides: Partial<DiffResult> = {}): DiffResult {
    return {
      diffPercentage: 1,
      diffPixels: 10,
      totalPixels: 1000,
      diffImagePath: '/tmp/diff.png',
      dimensionMismatch: false,
      baselineDimensions: { width: 390, height: 844 },
      actualDimensions: { width: 390, height: 844 },
      ...overrides,
    };
  }

  it('passes when diff is within threshold and relabels the target url', () => {
    const t = buildCompareTargetResult({
      baselineCap: cap({ url: 'https://example.com/baseline', screenshotPath: '/tmp/baseline.png' }),
      currentCap: cap(),
      currentLabel: 'demo/fixtures/current.html',
      diff: diffResult({ diffPercentage: 0.5 }),
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('pass');
    expect(t.url).toBe('demo/fixtures/current.html');
    expect(t.baseline).toBe('/tmp/baseline.png');
  });

  it('fails when diff exceeds threshold and surfaces the changed region', () => {
    const t = buildCompareTargetResult({
      baselineCap: cap({ screenshotPath: '/tmp/baseline.png' }),
      currentCap: cap(),
      currentLabel: 'current.html',
      diff: diffResult({ diffPercentage: 12, changedRegion: { x: 4, y: 8, width: 100, height: 60 } }),
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('fail');
    expect(t.changed_region).toEqual({ x: 4, y: 8, width: 100, height: 60 });
  });

  it('reports needs_baseline and a reason when the baseline capture failed', () => {
    const t = buildCompareTargetResult({
      baselineCap: cap({
        error:
          'page.goto: net::ERR_FILE_NOT_FOUND at file:///private/preview.html?token=canary\nCall log: details',
        screenshotPath: '/tmp/baseline.png',
      }),
      currentCap: cap(),
      currentLabel: 'current.html',
      diff: null,
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('needs_baseline');
    expect(t.reasons[0]).toBe('baseline_capture: net::ERR_FILE_NOT_FOUND');
    expect(t.reasons.join(' ')).not.toMatch(/file:\/\/|token|canary|Call log/i);
  });

  it('surfaces a current-capture error as verdict=error', () => {
    const t = buildCompareTargetResult({
      baselineCap: cap({ screenshotPath: '/tmp/baseline.png' }),
      currentCap: cap({ error: 'net::ERR_FAILED', httpStatus: null }),
      currentLabel: 'current.html',
      diff: null,
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('error');
  });

  it('fails closed with a bounded reason when the baseline captured HTTP 404 (no Playwright error)', () => {
    const diff = diffResult({ diffPercentage: 0 });
    const t = buildCompareTargetResult({
      baselineCap: cap({ httpStatus: 404, screenshotPath: '/tmp/baseline.png' }),
      currentCap: cap({ httpStatus: 200 }),
      currentLabel: 'current.html',
      diff,
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('needs_baseline');
    expect(t.pass).toBe(false);
    expect(t.diff_percentage).toBeNull();
    expect(t.reasons).toContain('baseline_http_status: HTTP 404');
    // The reason is bounded to the status line — no response body, headers,
    // or URL leak into it.
    expect(t.reasons.join(' ')).not.toMatch(/https?:\/\//);
  });

  it('isHealthyBaseline: renderable 2xx/3xx are eligible; no-content and unhealthy captures are not', () => {
    expect(isHealthyBaseline(cap({ httpStatus: 200 }))).toBe(true);
    expect(isHealthyBaseline(cap({ httpStatus: 203 }))).toBe(true);
    expect(isHealthyBaseline(cap({ httpStatus: 301 }))).toBe(true);
    expect(isHealthyBaseline(cap({ httpStatus: 399 }))).toBe(true);
    expect(isHealthyBaseline(cap({ httpStatus: 204 }))).toBe(false);
    expect(isHealthyBaseline(cap({ httpStatus: 205 }))).toBe(false);
    expect(isHealthyBaseline(cap({ httpStatus: 304 }))).toBe(false);
    expect(isHealthyBaseline(cap({ httpStatus: 404 }))).toBe(false);
    expect(isHealthyBaseline(cap({ httpStatus: 500 }))).toBe(false);
    expect(isHealthyBaseline(cap({ httpStatus: null }))).toBe(false);
    expect(isHealthyBaseline(cap({ httpStatus: 200, error: 'net::ERR_FAILED' }))).toBe(false);
  });

  it('keeps an unhealthy baseline primary when the current side also fails', () => {
    const t = buildCompareTargetResult({
      baselineCap: cap({ httpStatus: 404, screenshotPath: '/tmp/baseline.png' }),
      currentCap: cap({ httpStatus: 500 }),
      currentLabel: 'current.html',
      diff: null,
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });

    expect(t.verdict).toBe('needs_baseline');
    expect(t.pass).toBe(false);
    expect(t.baseline).toBeNull();
    expect(t.reasons).toContain('baseline_http_status: HTTP 404');
    expect(t.reasons).toContain('http_status: HTTP 500');
  });
});

describe('runCompare orchestration', () => {
  const lane: BaselineLane = { browser: 'chromium', os: 'linux', runner: 'thinkcentre-local' };
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-compare-test-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('passes when diff is within threshold and writes json+html+receipt', async () => {
    const jsonPath = path.join(workRoot, 'reports', 'compare.json');
    const result = await runCompare({
      baseline: 'https://example.com/a',
      current: 'https://example.com/b',
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
      jsonOutPath: jsonPath,
    });

    expect(result.report.pass).toBe(true);
    expect(result.report.config.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(result.jsonPath).toBe(jsonPath);
    expect(result.htmlPath).toBeTruthy();
    expect(result.receiptPath).toBeTruthy();

    const html = await fs.readFile(result.htmlPath!, 'utf8');
    expect(html).toContain('PASS');

    const parsed = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    expect(parsed.results[0].changed_region).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });

  it('fails when diff exceeds threshold', async () => {
    const { diffPngs } = await import('../src/diff.js');
    vi.mocked(diffPngs).mockResolvedValueOnce({
      diffPercentage: 20,
      diffPixels: 200,
      totalPixels: 1000,
      diffImagePath: null,
      dimensionMismatch: false,
      baselineDimensions: { width: 100, height: 100 },
      actualDimensions: { width: 100, height: 100 },
      changedRegion: { x: 0, y: 0, width: 50, height: 50 },
    });

    const result = await runCompare({
      baseline: 'https://example.com/a',
      current: 'https://example.com/b',
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(result.report.pass).toBe(false);
    expect(result.report.summary.failed).toBe(1);
  });

  it('writes an HTML report at a deterministic default path even without --json', async () => {
    const result = await runCompare({
      baseline: 'https://example.com/a',
      current: 'https://example.com/b',
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(result.jsonPath).toBeNull();
    expect(result.htmlPath).toBeTruthy();
    const exists = await fs
      .stat(result.htmlPath!)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    expect(path.resolve(result.htmlPath!).startsWith(path.resolve(workRoot))).toBe(true);
  });

  it('skips HTML entirely when htmlOutPath is false', async () => {
    const result = await runCompare({
      baseline: 'https://example.com/a',
      current: 'https://example.com/b',
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
      htmlOutPath: false,
    });
    expect(result.htmlPath).toBeNull();
  });

  it('supports local file paths for both baseline and current', async () => {
    const fixtureA = path.join(workRoot, 'a.html');
    const fixtureB = path.join(workRoot, 'b.html');
    await fs.writeFile(fixtureA, '<html></html>');
    await fs.writeFile(fixtureB, '<html></html>');

    const result = await runCompare({
      baseline: fixtureA,
      current: fixtureB,
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(result.report.config.urls[0]).toContain('a.html');
    expect(result.report.config.urls[1]).toContain('b.html');
    expect(result.report.pass).toBe(true);
  });
});

describe('runCompare — baseline HTTP health gate (loopback fixtures)', () => {
  // Regression for the false-green bug: a baseline that 404s (but never
  // throws a Playwright navigation error) must not be treated as usable —
  // even when its HTML is byte-identical to the current page's HTML. These
  // tests dial a real HTTP server bound to 127.0.0.1 only; no external
  // network access, no public URLs.
  const lane: BaselineLane = { browser: 'chromium', os: 'linux', runner: 'thinkcentre-local' };
  const identicalHtml = '<html><body>Identical content</body></html>';
  let workRoot: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-compare-health-'));
    vi.clearAllMocks();

    server = http.createServer((req, res) => {
      switch (req.url) {
        case '/baseline-404':
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(identicalHtml);
          return;
        case '/current-200':
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(identicalHtml);
          return;
        case '/baseline-300':
          res.writeHead(300, { 'Content-Type': 'text/html' });
          res.end(identicalHtml);
          return;
        case '/baseline-204':
          res.writeHead(204);
          res.end();
          return;
        case '/baseline-205':
          res.writeHead(205);
          res.end();
          return;
        case '/baseline-304':
          res.writeHead(304);
          res.end();
          return;
        case '/current-500':
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(identicalHtml);
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('fails closed and never calls the diff seam when the baseline is HTTP 404, even with byte-identical HTML', async () => {
    const { diffPngs } = await import('../src/diff.js');

    const result = await runCompare({
      baseline: `${baseUrl}/baseline-404`,
      current: `${baseUrl}/current-200`,
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(diffPngs).not.toHaveBeenCalled();
    expect(result.report.pass).toBe(false);
    expect(result.report.results[0]!.verdict).toBe('needs_baseline');
    expect(result.report.results[0]!.diff_percentage).toBeNull();
    expect(result.report.results[0]!.reasons).toContain('baseline_http_status: HTTP 404');
  });

  it('keeps a renderable 3xx baseline eligible and does call the diff seam', async () => {
    const { diffPngs } = await import('../src/diff.js');

    const result = await runCompare({
      baseline: `${baseUrl}/baseline-300`,
      current: `${baseUrl}/current-200`,
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(diffPngs).toHaveBeenCalledTimes(1);
    expect(result.report.results[0]!.verdict).not.toBe('needs_baseline');
  });

  it.each([204, 205, 304])(
    'rejects non-renderable HTTP %i and never calls the diff seam',
    async (status) => {
      const { diffPngs } = await import('../src/diff.js');

      const result = await runCompare({
        baseline: `${baseUrl}/baseline-${status}`,
        current: `${baseUrl}/current-200`,
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
        outRoot: workRoot,
        threshold: 5,
        loadTimeWarnMs: 3000,
        lane,
        quiet: true,
      });

      expect(diffPngs).not.toHaveBeenCalled();
      expect(result.report.pass).toBe(false);
      expect(result.report.results[0]!.verdict).toBe('needs_baseline');
      expect(result.report.results[0]!.diff_percentage).toBeNull();
      expect(result.report.results[0]!.reasons).toContain(
        `baseline_http_status: HTTP ${status}`,
      );
    },
  );

  it('reports both an unhealthy baseline and current HTTP failure truthfully', async () => {
    const { diffPngs } = await import('../src/diff.js');

    const result = await runCompare({
      baseline: `${baseUrl}/baseline-404`,
      current: `${baseUrl}/current-500`,
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(diffPngs).not.toHaveBeenCalled();
    expect(result.report.pass).toBe(false);
    expect(result.report.results[0]!.verdict).toBe('needs_baseline');
    expect(result.report.results[0]!.baseline).toBeNull();
    expect(result.report.summary.needs_baseline).toBe(1);
    expect(result.report.assertions.find((a) => a.name === 'baselines_present')?.status).toBe(
      'fail',
    );
    expect(result.report.assertions.find((a) => a.name === 'http_healthy')?.status).toBe(
      'fail',
    );
    expect(result.report.results[0]!.reasons).toContain('baseline_http_status: HTTP 404');
    expect(result.report.results[0]!.reasons).toContain('http_status: HTTP 500');
  });

  it('keeps a healthy 2xx baseline eligible and does call the diff seam', async () => {
    const { diffPngs } = await import('../src/diff.js');

    const result = await runCompare({
      baseline: `${baseUrl}/current-200`,
      current: `${baseUrl}/current-200`,
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(diffPngs).toHaveBeenCalledTimes(1);
    expect(result.report.pass).toBe(true);
  });

  it('keeps local file:// baselines eligible — Capturer normalizes them to HTTP 200', async () => {
    const { diffPngs } = await import('../src/diff.js');
    const fixtureA = path.join(workRoot, 'a.html');
    const fixtureB = path.join(workRoot, 'b.html');
    await fs.writeFile(fixtureA, identicalHtml);
    await fs.writeFile(fixtureB, identicalHtml);

    const result = await runCompare({
      baseline: fixtureA,
      current: fixtureB,
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      outRoot: workRoot,
      threshold: 5,
      loadTimeWarnMs: 3000,
      lane,
      quiet: true,
    });

    expect(diffPngs).toHaveBeenCalledTimes(1);
    expect(result.report.pass).toBe(true);
  });
});
