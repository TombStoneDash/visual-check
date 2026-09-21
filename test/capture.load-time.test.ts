import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Capturer } from '../src/capture.js';
import { browserReady } from './helpers/browser-ready.js';

describe.skipIf(!browserReady)('Capturer load time (real Chromium)', () => {
  let workRoot: string;
  const capturer = new Capturer({ navigationTimeoutMs: 2_000 });
  const viewport = { name: 'probe', width: 320, height: 240 };

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Unexpected network request');
    }));
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-load-time-'));
    await fs.writeFile(path.join(workRoot, 'page.html'), '<!doctype html><p>Local page</p>');
    await capturer.start();
  });

  afterAll(async () => {
    try {
      await capturer.stop();
      if (workRoot) await fs.rm(workRoot, { recursive: true, force: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('excludes the stable-capture delay and artifact work from load time', async () => {
    const start = Date.now();
    const artifact = await capturer.capture(
      pathToFileURL(path.join(workRoot, 'page.html')).href,
      viewport,
      path.join(workRoot, 'page.png'),
    );
    const wallTimeMs = Date.now() - start;

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(200);
    expect(artifact.loadTimeMs).toBeGreaterThanOrEqual(0);
    expect(wallTimeMs - artifact.loadTimeMs).toBeGreaterThanOrEqual(200);
    await expect(fs.stat(artifact.screenshotPath)).resolves.toBeTruthy();
  });

  it('returns a finite non-negative load time for an unreachable URL', async () => {
    const artifact = await capturer.capture(
      pathToFileURL(path.join(workRoot, 'missing.html')).href,
      viewport,
      path.join(workRoot, 'missing.png'),
    );

    expect(artifact.error).toBe('resource_not_found');
    expect(Number.isFinite(artifact.loadTimeMs)).toBe(true);
    expect(artifact.loadTimeMs).toBeGreaterThanOrEqual(0);
  });
});
