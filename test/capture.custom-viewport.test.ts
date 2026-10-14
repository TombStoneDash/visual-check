import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Capturer } from '../src/capture.js';
import { parseViewports } from '../src/cli-args.js';
import { browserReady, mustRunBrowserTests } from './helpers/browser-ready.js';

// A custom viewport size from --viewports desktop:1280x800 (or a config) must be
// what Chromium captures, not the DEFAULT_VIEWPORTS size for that name.
describe.skipIf(!browserReady && !mustRunBrowserTests)('Capturer honors a custom viewport size (real Chromium)', () => {
  let server: http.Server;
  let baseUrl: string;
  let workRoot: string;
  let capturer: Capturer;

  beforeAll(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-custom-viewport-'));
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>renderable</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    capturer = new Capturer({ headless: true });
    await capturer.start();
  }, 60_000);

  afterAll(async () => {
    await capturer.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it('screenshot width and height equal the custom size', async () => {
    const [vp] = parseViewports('desktop:1280x800');
    const out = path.join(workRoot, 'desktop.png');
    const cap = await capturer.capture(`${baseUrl}/`, vp!, out);
    expect(cap.error).toBeUndefined();
    const png = PNG.sync.read(await fs.readFile(out));
    expect(png.width).toBe(1280);
    expect(png.height).toBe(800);
  }, 60_000);
});
