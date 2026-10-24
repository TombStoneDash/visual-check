import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Capturer } from '../src/capture.js';
import { browserReady } from './helpers/browser-ready.js';

// A page whose network never goes idle: it keeps a long-poll request open
// for as long as the page lives, like analytics beacons or a live feed.
describe.skipIf(!browserReady)('Capturer on a page that never goes network-idle (real Chromium)', () => {
  const NAV_TIMEOUT_MS = 2_000;
  const capturer = new Capturer({ navigationTimeoutMs: NAV_TIMEOUT_MS });
  const viewport = { name: 'probe', width: 320, height: 240 };
  const held: http.ServerResponse[] = [];
  let server: http.Server;
  let base: string;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-busy-network-'));
    server = http.createServer((req, res) => {
      if (req.url === '/poll') {
        held.push(res); // never answered
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (req.url === '/busy') {
        res.end('<!doctype html><h1>Live feed</h1><script>fetch("/poll")</script>');
      } else {
        res.end('<!doctype html><h1>Quiet page</h1>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await capturer.start();
  });

  afterAll(async () => {
    await capturer.stop();
    for (const res of held) res.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('still captures a screenshot instead of failing with navigation_timeout', async () => {
    const artifact = await capturer.capture(`${base}/busy`, viewport, path.join(workRoot, 'busy.png'));

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(200);
    await expect(fs.stat(artifact.screenshotPath)).resolves.toBeTruthy();
    // It waited out the idle budget, so the load time shows the slow settle.
    expect(artifact.loadTimeMs).toBeGreaterThanOrEqual(NAV_TIMEOUT_MS - 100);
    expect(artifact.loadTimeMs).toBeLessThan(NAV_TIMEOUT_MS + 2_000);
  });

  it('captures a quiet page without waiting out the budget', async () => {
    const artifact = await capturer.capture(`${base}/quiet`, viewport, path.join(workRoot, 'quiet.png'));

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(200);
    expect(artifact.loadTimeMs).toBeLessThan(NAV_TIMEOUT_MS);
  });
});
