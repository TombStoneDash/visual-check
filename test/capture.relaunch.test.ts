import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Capturer } from '../src/capture.js';
import { browserReady } from './helpers/browser-ready.js';

const browserOf = (c: Capturer) => (c as unknown as { browser: Browser | null }).browser;

describe.skipIf(!browserReady)('Capturer after the browser disconnects (real Chromium)', () => {
  const capturer = new Capturer({ navigationTimeoutMs: 5_000 });
  const viewport = { name: 'probe', width: 320, height: 240 };
  let workRoot: string;
  let pageUrl: string;

  beforeAll(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-relaunch-'));
    const page = path.join(workRoot, 'page.html');
    await fs.writeFile(page, '<!doctype html><h1>Still here</h1>');
    pageUrl = pathToFileURL(page).href;
    await capturer.start();
  });

  afterAll(async () => {
    await capturer.stop();
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('relaunches Chromium so the rest of the run still captures', async () => {
    const first = browserOf(capturer)!;
    await first.close(); // stands in for a crash / OOM kill
    expect(first.isConnected()).toBe(false);

    const artifact = await capturer.capture(pageUrl, viewport, path.join(workRoot, 'after.png'));

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(200);
    await expect(fs.stat(artifact.screenshotPath)).resolves.toBeTruthy();
    expect(browserOf(capturer)).not.toBe(first);
    expect(browserOf(capturer)!.isConnected()).toBe(true);
  });

  it('shares one relaunch between concurrent captures', async () => {
    const before = browserOf(capturer)!;
    await before.close();

    const artifacts = await Promise.all(
      [0, 1, 2].map((i) => capturer.capture(pageUrl, viewport, path.join(workRoot, `c${i}.png`))),
    );

    for (const a of artifacts) expect(a.error).toBeUndefined();
    const after = browserOf(capturer)!;
    expect(after).not.toBe(before);
    // All three captured, and each closed its context in the new browser.
    expect(after.contexts()).toHaveLength(0);
  });

  it('still refuses to capture before start()', async () => {
    await expect(new Capturer().capture(pageUrl, viewport, path.join(workRoot, 'x.png'))).rejects.toThrow(
      'Capturer not started',
    );
  });
});
