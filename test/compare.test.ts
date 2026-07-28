import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Hoisted mocks -----------------------------------------------------------
// Same pattern as test/deploy-gate.test.ts: replace the browser + pixel-diff
// engine so orchestration is exercised without a real Chromium instance.

vi.mock('../src/capture.js', () => ({
  Capturer: class {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async capture(url: string, vp: { name: string }, outPath: string) {
      const { promises: fsp } = await import('node:fs');
      const pathMod = await import('node:path');
      await fsp.mkdir(pathMod.dirname(outPath), { recursive: true });
      await fsp.writeFile(outPath, Buffer.from([137, 80, 78, 71]));
      return {
        url,
        viewport: vp.name,
        screenshotPath: outPath,
        httpStatus: 200,
        consoleErrors: [],
        loadTimeMs: 100,
      };
    }
  },
}));

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
      baselineCap: cap({ error: 'net::ERR_FILE_NOT_FOUND', screenshotPath: '/tmp/baseline.png' }),
      currentCap: cap(),
      currentLabel: 'current.html',
      diff: null,
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(t.verdict).toBe('needs_baseline');
    expect(t.reasons[0]).toMatch(/baseline_capture/);
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
