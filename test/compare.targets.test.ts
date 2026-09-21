import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Hoisted mocks -----------------------------------------------------------
// Same pattern as test/compare.test.ts: replace the browser engine so
// runCompare's missing-target guard can be exercised without a real
// Chromium instance, while still letting us assert Capturer.start was
// never reached.

const { startSpy } = vi.hoisted(() => ({ startSpy: vi.fn(async () => {}) }));

vi.mock('../src/capture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/capture.js')>();
  return {
    ...actual,
    Capturer: class {
    async start(): Promise<void> {
      await startSpy();
    }
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
  };
});

// --- Imports that use the mocked module ---------------------------------------

import { resolveCompareTarget, looksLikeWebAddress, runCompare } from '../src/commands/compare.js';
import { BaselineLane } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'linux', runner: 'thinkcentre-local' };

describe('looksLikeWebAddress', () => {
  it.each([
    ['example.com', true],
    ['staging.example.com/pricing?x=1', true],
    ['localhost:3000/app', true],
    ['127.0.0.1:8080', true],
    ['localhost', true],
    ['[::1]:8080', true],
    ['page.html', false],
    ['sub/page.html', false],
    ['./example.com', false],
    ['/abs/x.html', false],
    ['C:\\site\\index.html', false],
    ['~/site/example.com', false],
    ['sub', false],
    ['', false],
  ])('looksLikeWebAddress(%j) === %j', (raw, expected) => {
    expect(looksLikeWebAddress(raw)).toBe(expected);
  });
});

describe('resolveCompareTarget — bare web addresses and missing local files', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-compare-targets-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('guesses a bare domain as https://', () => {
    const t = resolveCompareTarget('example.com', baseDir);
    expect(t.kind).toBe('url');
    expect(t.url).toBe('https://example.com');
    expect(t.label).toBe('https://example.com');
  });

  it('guesses a domain with path and query as https:// and keeps them', () => {
    const t = resolveCompareTarget('staging.example.com/pricing?x=1', baseDir);
    expect(t.kind).toBe('url');
    expect(t.url).toBe('https://staging.example.com/pricing?x=1');
    expect(t.label).toBe('https://staging.example.com/pricing?x=1');
  });

  it('guesses localhost:port/path as http://', () => {
    const t = resolveCompareTarget('localhost:3000/app', baseDir);
    expect(t.kind).toBe('url');
    expect(t.url).toBe('http://localhost:3000/app');
  });

  it('guesses 127.0.0.1:port as http://', () => {
    const t = resolveCompareTarget('127.0.0.1:8080', baseDir);
    expect(t.kind).toBe('url');
    expect(t.url).toBe('http://127.0.0.1:8080');
  });

  it('leaves an explicit scheme untouched regardless of case', () => {
    const t = resolveCompareTarget('HTTPS://Example.com/a', baseDir);
    expect(t.kind).toBe('url');
    expect(t.url).toBe('HTTPS://Example.com/a');
    expect(t.label).toBe('HTTPS://Example.com/a');
  });

  it.each([['page.html'], ['sub/page.html'], ['./example.com'], ['/abs/x.html'], ['C:\\site\\index.html']])(
    'treats %j as a file target, not a guessed web address',
    (raw) => {
      const t = resolveCompareTarget(raw, baseDir);
      expect(t.kind).toBe('file');
      expect(t.url.startsWith('file://')).toBe(true);
      expect(t.exists).toBe(false);
    },
  );

  it('an existing local file literally named "example.com" always wins over the web-address guess', async () => {
    const filePath = path.join(baseDir, 'example.com');
    await fs.writeFile(filePath, 'hello');

    const t = resolveCompareTarget('example.com', baseDir);
    expect(t.kind).toBe('file');
    expect(t.exists).toBe(true);
    expect(t.url.startsWith('file://')).toBe(true);
  });
});

describe('runCompare — missing local targets fail fast with no capture', () => {
  let workRoot: string;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-compare-targets-run-'));
    startSpy.mockClear();
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('rejects when the baseline is a non-existent local path and never starts the browser', async () => {
    await expect(
      runCompare({
        baseline: 'old.htm',
        current: 'https://example.com/b',
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
        outRoot: workRoot,
        threshold: 5,
        loadTimeWarnMs: 3000,
        lane,
        quiet: true,
      }),
    ).rejects.toThrow(/old\.htm/);
    await expect(
      runCompare({
        baseline: 'old.htm',
        current: 'https://example.com/b',
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
        outRoot: workRoot,
        threshold: 5,
        loadTimeWarnMs: 3000,
        lane,
        quiet: true,
      }),
    ).rejects.toThrow(/baseline/i);

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('rejects when the current target is a non-existent local path and never starts the browser', async () => {
    await expect(
      runCompare({
        baseline: 'https://example.com/a',
        current: 'missing-current.htm',
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
        outRoot: workRoot,
        threshold: 5,
        loadTimeWarnMs: 3000,
        lane,
        quiet: true,
      }),
    ).rejects.toThrow(/missing-current\.htm/);
    await expect(
      runCompare({
        baseline: 'https://example.com/a',
        current: 'missing-current.htm',
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
        outRoot: workRoot,
        threshold: 5,
        loadTimeWarnMs: 3000,
        lane,
        quiet: true,
      }),
    ).rejects.toThrow(/current/i);

    expect(startSpy).not.toHaveBeenCalled();
  });
});
