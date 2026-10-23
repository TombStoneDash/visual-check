import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { Capturer } from '../src/capture.js';
import { browserReady } from './helpers/browser-ready.js';

// The stable-capture <style> tag is inline. A page whose CSP forbids inline
// styles used to make addStyleTag throw, so every viewport of a healthy,
// CSP-hardened site ended as a capture error with no screenshot.

const STRICT_CSP =
  "default-src 'none'; style-src 'self'; script-src 'none'; img-src 'self'";

describe.skipIf(!browserReady)('Capturer on a page with a strict CSP (real Chromium)', () => {
  let workRoot: string;
  const capturer = new Capturer({ navigationTimeoutMs: 5_000 });
  const viewport = { name: 'probe', width: 320, height: 240 };

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Unexpected network request');
    }));
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-strict-csp-'));
    await fs.writeFile(
      path.join(workRoot, 'page.html'),
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="${STRICT_CSP}">` +
        '<body style="margin:0"><p>Hardened page</p></body>',
    );
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

  it('captures the page instead of ending in a capture error', async () => {
    const artifact = await capturer.capture(
      pathToFileURL(path.join(workRoot, 'page.html')).href,
      viewport,
      path.join(workRoot, 'page.png'),
    );

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(200);
    const png = PNG.sync.read(await fs.readFile(artifact.screenshotPath));
    expect([png.width, png.height]).toEqual([320, 240]);
  });
});
