import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpTimeoutError,
  fetchWithTimeout,
  httpTimeoutMs,
} from '../src/http.js';
import { uploadArtifact, signedUrl } from '../src/storage.js';
import { getActiveBaseline, insertRun } from '../src/db.js';
import { sendTelegramAlert } from '../src/alerts.js';
import type { RunReport } from '../src/types.js';

/** A fetch that never answers until its signal aborts — a stalled server. */
const hangingFetch = (async (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // no deadline: hangs forever, which is the bug
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })) as typeof fetch;

/** Headers arrive, then the body never finishes. */
const stalledBodyFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  const signal = init?.signal;
  const never = () =>
    new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  return { ok: true, status: 200, json: never, text: never, arrayBuffer: never } as unknown as Response;
}) as typeof fetch;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.TELEGRAM_BOT_TOKEN = '123:secret-bot-token';
  process.env.TELEGRAM_CHAT_ID = '42';
  process.env.VISUAL_CHECK_HTTP_TIMEOUT_MS = '50';
});

afterEach(() => {
  delete process.env.VISUAL_CHECK_HTTP_TIMEOUT_MS;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
});

describe('httpTimeoutMs', () => {
  it('defaults to 30s and accepts only positive integers', () => {
    expect(httpTimeoutMs({})).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(httpTimeoutMs({ VISUAL_CHECK_HTTP_TIMEOUT_MS: '1500' })).toBe(1500);
    for (const bad of ['', '0', '-5', '1.5', 'abc', '0x10', '1e3']) {
      expect(httpTimeoutMs({ VISUAL_CHECK_HTTP_TIMEOUT_MS: bad })).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    }
  });
});

describe('fetchWithTimeout', () => {
  it('turns a stalled request into an HttpTimeoutError', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const p = fetchWithTimeout('probe', 'https://x.test', {}, async () => 'never', 30);
    await expect(p).rejects.toBeInstanceOf(HttpTimeoutError);
    await expect(p).rejects.toThrow('probe timed out after 30ms');
  });

  it('covers a body that stalls after the headers arrive', async () => {
    vi.stubGlobal('fetch', stalledBodyFetch);
    await expect(
      fetchWithTimeout('probe', 'https://x.test', {}, (res) => res.arrayBuffer(), 30),
    ).rejects.toBeInstanceOf(HttpTimeoutError);
  });

  it('passes ordinary errors through untouched', async () => {
    vi.stubGlobal('fetch', (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(fetchWithTimeout('probe', 'https://x.test', {}, async () => 1, 1000)).rejects.toThrow(
      'fetch failed',
    );
  });
});

describe('outbound calls honour the deadline', () => {
  it('storage upload and signing time out instead of hanging', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-http-timeout-'));
    try {
      const file = path.join(dir, 'a.png');
      await fs.writeFile(file, Buffer.from([1]));
      await expect(uploadArtifact(file, 'visual-check-screenshots', 'k/a.png')).rejects.toThrow(
        'uploadArtifact visual-check-screenshots/k/a.png timed out after 50ms',
      );
      await expect(signedUrl('visual-check-reports', 'k/r.html', 60)).rejects.toBeInstanceOf(HttpTimeoutError);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('PostgREST reads time out when the body stalls', async () => {
    vi.stubGlobal('fetch', stalledBodyFetch);
    await expect(
      getActiveBaseline('p', 'https://a.test', 'mobile', { browser: 'chromium', os: 'linux', runner: 'ci' }),
    ).rejects.toBeInstanceOf(HttpTimeoutError);
  });

  it('PostgREST writes with an empty body still succeed', async () => {
    vi.stubGlobal('fetch', (async () => new Response(null, { status: 201 })) as typeof fetch);
    const run = {
      run_id: 'vc_x',
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0, needs_baseline: 0 },
      config: {},
      targets: [],
    } as unknown as RunReport;
    await expect(insertRun(run, 'p', null)).resolves.toBeUndefined();
  });

  it('a stalled Telegram call times out without leaking the bot token', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const run = {
      schema_version: 1,
      timestamp: '2026-10-24T00:00:00.000Z',
      run_id: 'vc_x',
      config: { urls: ['https://a.test'], viewports: ['mobile'], pixel_diff_threshold: 5, load_time_warn_ms: 3000 },
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0, needs_baseline: 0 },
      results: [],
    } as unknown as RunReport;
    const err = await sendTelegramAlert(run, 'https://example.test/report').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpTimeoutError);
    expect(String((err as Error).message)).not.toContain('secret-bot-token');
  });
});
