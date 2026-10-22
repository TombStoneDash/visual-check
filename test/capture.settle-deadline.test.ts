import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Capturer } from '../src/capture.js';
import { browserReady, mustRunBrowserTests } from './helpers/browser-ready.js';

// A page whose main thread never returns after load. Before the settle
// deadline, the stable-capture steps (style injection, fonts.ready) waited on
// it forever and the whole run hung.
const BUSY_AFTER_LOAD = `<!doctype html><h1>loaded</h1><script>
addEventListener('load', () => setTimeout(() => { for (;;) {} }, 50));
</script>`;

describe('Capturer settle deadline', () => {
  it('requires a launchable browser in CI', () => {
    if (mustRunBrowserTests) expect(browserReady).toBe(true);
  });
});

describe.skipIf(!browserReady)('Capturer settle deadline (real Chromium)', () => {
  let workRoot: string;
  const capturer = new Capturer({ navigationTimeoutMs: 2_000 });
  const viewport = { name: 'probe', width: 320, height: 240 };

  beforeAll(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-settle-'));
    await fs.writeFile(path.join(workRoot, 'busy.html'), BUSY_AFTER_LOAD);
    await fs.writeFile(path.join(workRoot, 'ok.html'), '<!doctype html><p>fine</p>');
    await capturer.start();
  });

  afterAll(async () => {
    await capturer.stop();
    if (workRoot) await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('ends a capture whose page blocks after load as navigation_timeout', async () => {
    const start = Date.now();
    const artifact = await capturer.capture(
      pathToFileURL(path.join(workRoot, 'busy.html')).href,
      viewport,
      path.join(workRoot, 'busy.png'),
    );

    expect(artifact.error).toBe('navigation_timeout');
    expect(Date.now() - start).toBeLessThan(8_000);
  }, 15_000);

  it('leaves the browser usable for the next capture', async () => {
    const artifact = await capturer.capture(
      pathToFileURL(path.join(workRoot, 'ok.html')).href,
      viewport,
      path.join(workRoot, 'ok.png'),
    );

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(200);
    await expect(fs.stat(artifact.screenshotPath)).resolves.toBeTruthy();
  }, 15_000);
});
