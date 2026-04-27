import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { uploadArtifact, signedUrl, downloadBaseline } from '../src/storage.js';
import { BaselineLane } from '../src/types.js';

vi.mock('../src/db.js', () => ({
  getActiveBaseline: vi.fn(),
}));
import * as db from '../src/db.js';

const SUPABASE_URL = 'https://example.supabase.co';
const SERVICE_KEY = 'service-role-test-key';

type FetchCall = { url: string; init: RequestInit };

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; json?: unknown; text?: string; bytes?: Uint8Array }>): {
  calls: FetchCall[];
  fn: typeof fetch;
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[i++] ?? responses[responses.length - 1]!;
    const ok = r.ok ?? true;
    const status = r.status ?? (ok ? 200 : 400);
    return {
      ok,
      status,
      json: async () => r.json ?? {},
      text: async () => r.text ?? '',
      arrayBuffer: async () =>
        r.bytes ? r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) : new ArrayBuffer(0),
    } as unknown as Response;
  }) as typeof fetch;
  return { calls, fn };
}

let tmpDir: string;

beforeEach(async () => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-storage-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('uploadArtifact', () => {
  it('POSTs binary body with bearer auth and upsert header', async () => {
    const src = path.join(tmpDir, 'pic.png');
    await fs.writeFile(src, Buffer.from([1, 2, 3, 4]));
    const { calls, fn } = mockFetchSequence([{ ok: true }]);
    vi.stubGlobal('fetch', fn);

    const key = await uploadArtifact(src, 'visual-check-screenshots', '/proj/run/foo.png');
    expect(key).toBe('proj/run/foo.png');
    expect(calls[0]!.url).toBe(
      `${SUPABASE_URL}/storage/v1/object/visual-check-screenshots/proj/run/foo.png`,
    );
    const h = (calls[0]!.init.headers ?? {}) as Record<string, string>;
    expect(h['Authorization']).toBe(`Bearer ${SERVICE_KEY}`);
    expect(h['x-upsert']).toBe('true');
    expect(h['content-type']).toBe('image/png');
  });

  it('throws when the Supabase response is not ok', async () => {
    const src = path.join(tmpDir, 'pic.png');
    await fs.writeFile(src, Buffer.from([9]));
    const { fn } = mockFetchSequence([{ ok: false, status: 413, text: 'payload too large' }]);
    vi.stubGlobal('fetch', fn);
    await expect(
      uploadArtifact(src, 'visual-check-reports', 'a/b.html'),
    ).rejects.toThrow(/413/);
  });
});

describe('signedUrl', () => {
  it('returns an absolute URL and passes expiresIn to Supabase', async () => {
    const { calls, fn } = mockFetchSequence([
      { ok: true, json: { signedURL: '/object/sign/visual-check-reports/a/b.html?token=xyz' } },
    ]);
    vi.stubGlobal('fetch', fn);

    const url = await signedUrl('visual-check-reports', 'a/b.html', 3600);
    expect(url).toBe(
      `${SUPABASE_URL}/storage/v1/object/sign/visual-check-reports/a/b.html?token=xyz`,
    );
    expect(calls[0]!.url).toBe(
      `${SUPABASE_URL}/storage/v1/object/sign/visual-check-reports/a/b.html`,
    );
    const body = JSON.parse((calls[0]!.init.body as string) ?? '{}');
    expect(body).toEqual({ expiresIn: 3600 });
  });

  it('throws when Supabase returns no signedURL', async () => {
    const { fn } = mockFetchSequence([{ ok: true, json: {} }]);
    vi.stubGlobal('fetch', fn);
    await expect(signedUrl('visual-check-reports', 'a.html', 60)).rejects.toThrow(/signedURL/);
  });
});

describe('downloadBaseline', () => {
  const lane: BaselineLane = { browser: 'chromium', os: 'windows', runner: 'lenovo-local' };

  it('returns null when no approved baseline exists', async () => {
    vi.mocked(db.getActiveBaseline).mockResolvedValue(null);
    const target = path.join(tmpDir, 'out.png');
    const result = await downloadBaseline('trashalert', 'https://x', 'mobile', lane, target);
    expect(result).toBeNull();
  });

  it('writes PNG bytes to targetPath and returns the path on hit', async () => {
    vi.mocked(db.getActiveBaseline).mockResolvedValue({
      id: 'b1',
      project_id: 'trashalert',
      url: 'https://x',
      viewport: 'mobile',
      lane_os: 'windows',
      lane_runner: 'lenovo-local',
      storage_path: 'trashalert/x/mobile.png',
      approved: true,
      approved_by: null,
      approved_at: new Date().toISOString(),
      run_id: 'vc_1',
    });
    const payload = new Uint8Array([137, 80, 78, 71]);
    const { fn } = mockFetchSequence([{ ok: true, bytes: payload }]);
    vi.stubGlobal('fetch', fn);

    const target = path.join(tmpDir, 'out.png');
    const result = await downloadBaseline('trashalert', 'https://x', 'mobile', lane, target);
    expect(result).toBe(target);
    const bytes = await fs.readFile(target);
    expect(Array.from(bytes)).toEqual(Array.from(payload));
  });
});
