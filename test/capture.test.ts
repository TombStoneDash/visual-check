import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Capturer, sanitizeCaptureError, urlToSlug } from '../src/capture.js';

describe('urlToSlug', () => {
  it('strips protocol and replaces dots in host', () => {
    expect(urlToSlug('https://trashalert.io')).toBe('trashalert-io');
  });

  it('preserves paths with underscores', () => {
    expect(urlToSlug('https://trashalert.io/pricing')).toBe('trashalert-io_pricing');
  });

  it('handles trailing slash', () => {
    expect(urlToSlug('https://trashalert.io/pricing/')).toBe('trashalert-io_pricing');
  });

  it('handles nested paths', () => {
    expect(urlToSlug('https://example.com/a/b/c')).toBe('example-com_a_b_c');
  });

  it('treats root path as bare hostname', () => {
    expect(urlToSlug('https://example.com/')).toBe('example-com');
  });

  it('is stable for non-URLs', () => {
    // Invalid URL → non-empty, filesystem-safe slug
    const slug = urlToSlug('not a url');
    expect(slug).toBe('not_a_url');
  });
});

describe('sanitizeCaptureError', () => {
  it('retains only a bounded Chromium network code', () => {
    const raw =
      'page.goto: net::ERR_TOO_MANY_REDIRECTS at https://preview.invalid/path?token=canary\nCall log:\nsecret details';
    const bounded = sanitizeCaptureError(new Error(raw));
    expect(bounded).toBe('net::ERR_TOO_MANY_REDIRECTS');
    expect(bounded).not.toMatch(/https?:|token|canary|Call log/i);
  });

  it('classifies timeouts without retaining the raw message', () => {
    const bounded = sanitizeCaptureError(
      new Error('page.goto: Timeout 30000ms exceeded at https://preview.invalid/?token=canary'),
    );
    expect(bounded).toBe('navigation_timeout');
    expect(sanitizeCaptureError(bounded)).toBe('navigation_timeout');
    expect(bounded).not.toMatch(/https?:|token|canary|30000/i);
  });

  it('collapses unknown failures to a fixed fallback', () => {
    const bounded = sanitizeCaptureError(
      'response body and Authorization header must never enter a result',
    );
    expect(bounded).toBe('capture_failed');
  });

  it('does not copy an unbounded network-like token', () => {
    const bounded = sanitizeCaptureError(`net::ERR_${'A'.repeat(200)}`);
    expect(bounded).toBe('capture_failed');
  });

  it('does not mistake a URL query value for a browser network code', () => {
    const bounded = sanitizeCaptureError(
      'page.goto: unknown failure at https://preview.invalid/?token=net::ERR_QUERY_SECRET',
    );
    expect(bounded).toBe('capture_failed');
  });
});

describe.sequential('Capturer renderable-response contract (real Chromium)', () => {
  let server: http.Server;
  let baseUrl: string;
  let workRoot: string;
  let capturer: Capturer;

  beforeAll(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-capturer-status-'));
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/redirect-loop')) {
        res.writeHead(302, { Location: '/redirect-loop' });
        res.end();
        return;
      }

      const status = Number(req.url?.slice(1));
      if (Number.isInteger(status)) {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        if (status !== 204 && status !== 205 && status !== 304) {
          res.end('<!doctype html><html><body>renderable</body></html>');
        } else {
          res.end();
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    capturer = new Capturer({ headless: true });
    await capturer.start();
  });

  afterAll(async () => {
    await capturer.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it.each([200, 300, 399])('captures renderable HTTP %i', async (status) => {
    const screenshotPath = path.join(workRoot, `${status}.png`);
    const artifact = await capturer.capture(
      `${baseUrl}/${status}`,
      { name: 'probe', width: 320, height: 240 },
      screenshotPath,
    );

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(status);
    await expect(fs.stat(screenshotPath)).resolves.toBeTruthy();
  });

  it.each([204, 205, 304])(
    'rejects non-renderable HTTP %i with a bounded error',
    async (status) => {
      const artifact = await capturer.capture(
        `${baseUrl}/${status}`,
        { name: 'probe', width: 320, height: 240 },
        path.join(workRoot, `${status}.png`),
      );

      expect(artifact.httpStatus).toBeNull();
      expect(artifact.error).toBe('net::ERR_ABORTED');
      expect(artifact.error).not.toMatch(/https?:|127\.0\.0\.1|Call log/i);
    },
  );

  it('bounds redirect-loop failures without exposing the target URL', async () => {
    const artifact = await capturer.capture(
      `${baseUrl}/redirect-loop?token=canary`,
      { name: 'probe', width: 320, height: 240 },
      path.join(workRoot, 'redirect-loop.png'),
    );

    expect(artifact.error).toBe('net::ERR_TOO_MANY_REDIRECTS');
    expect(artifact.error).not.toMatch(/https?:|127\.0\.0\.1|token|canary|Call log/i);
  });

  it('captures an HTTP 404 artifact so compare can reject it by status', async () => {
    const artifact = await capturer.capture(
      `${baseUrl}/404`,
      { name: 'probe', width: 320, height: 240 },
      path.join(workRoot, '404.png'),
    );

    expect(artifact.error).toBeUndefined();
    expect(artifact.httpStatus).toBe(404);
  });
});
