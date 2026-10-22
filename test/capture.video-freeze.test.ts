import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Capturer } from '../src/capture.js';
import { DEFAULT_VIEWPORTS } from '../src/types.js';
import { browserReady, mustRunBrowserTests } from './helpers/browser-ready.js';

// CSS animation rules and reducedMotion don't stop a <video>, so an
// autoplaying hero was captured at a different frame on every run. Each page
// below repaints its background when the capturer has frozen the video, and
// the test reads that colour back from the screenshot.
const PAGES: Record<string, string> = {
  // A really playing video (canvas stream, no media file needed).
  '/playing': `<!doctype html><html><body style="margin:0;background:#fff">
    <canvas id="c" width="16" height="16"></canvas><video id="v" muted playsinline></video>
    <script>
      const c = document.getElementById('c');
      c.getContext('2d').fillRect(0, 0, 16, 16);
      const v = document.getElementById('v');
      v.srcObject = c.captureStream(30);
      v.play();
      v.addEventListener('pause', () => { document.body.style.background = 'rgb(255,0,0)'; });
    </script></body></html>`,
  // A loaded video 7s in: currentTime/readyState are stubbed so the rewind
  // is checked without shipping a media file.
  '/mid-play': `<!doctype html><html><body style="margin:0;background:#fff">
    <video id="v" muted></video>
    <script>
      const v = document.getElementById('v');
      let t = 7;
      Object.defineProperty(v, 'readyState', { get: () => 4 });
      Object.defineProperty(v, 'currentTime', {
        get: () => t,
        set: (value) => {
          t = value;
          setTimeout(() => v.dispatchEvent(new Event('seeked')), 0);
        },
      });
      v.addEventListener('seeked', () => {
        if (t === 0 && v.paused) document.body.style.background = 'rgb(0,255,0)';
      });
    </script></body></html>`,
};

/** Bottom-right pixel: plain page background, clear of the canvas and video. */
function backgroundPixel(png: PNG): [number, number, number] {
  const i = png.data.length - 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

describe.skipIf(!browserReady && !mustRunBrowserTests)('Capturer freezes <video> before the screenshot (real Chromium)', () => {
  let server: http.Server;
  let baseUrl: string;
  let workRoot: string;
  let capturer: Capturer;
  const desktop = DEFAULT_VIEWPORTS.find((v) => v.name === 'desktop')!;

  beforeAll(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-video-freeze-'));
    server = http.createServer((req, res) => {
      const body = PAGES[req.url ?? ''];
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html' });
      res.end(body ?? 'not found');
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

  it('pauses a playing video', async () => {
    const out = path.join(workRoot, 'playing.png');
    const cap = await capturer.capture(`${baseUrl}/playing`, desktop, out);
    expect(cap.error).toBeUndefined();
    expect(backgroundPixel(PNG.sync.read(await fs.readFile(out)))).toEqual([255, 0, 0]);
  }, 60_000);

  it('rewinds a loaded video to its first frame', async () => {
    const out = path.join(workRoot, 'mid-play.png');
    const cap = await capturer.capture(`${baseUrl}/mid-play`, desktop, out);
    expect(cap.error).toBeUndefined();
    expect(backgroundPixel(PNG.sync.read(await fs.readFile(out)))).toEqual([0, 255, 0]);
  }, 60_000);
});
