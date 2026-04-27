import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  insertRun,
  insertResults,
  upsertBaseline,
  getActiveBaseline,
  getRun,
} from '../src/db.js';
import { BaselineLane, RunReport, TargetResult } from '../src/types.js';

const SUPABASE_URL = 'https://example.supabase.co';
const SERVICE_KEY = 'service-role-test-key';

type FetchCall = { url: string; init: RequestInit };

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; json?: unknown; text?: string }>): {
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
      json: async () => r.json ?? [],
      text: async () => r.text ?? '',
    } as unknown as Response;
  }) as typeof fetch;
  return { calls, fn };
}

beforeEach(() => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lane: BaselineLane = { browser: 'chromium', os: 'windows', runner: 'lenovo-local' };

const baseRun: RunReport = {
  schema_version: 1,
  timestamp: '2026-04-22T00:00:00.000Z',
  run_id: 'vc_testrun',
  projectId: 'trashalert',
  deploymentUrl: 'https://preview.vercel.app',
  branch: 'fix/hero-copy',
  commitSha: 'abc123',
  config: {
    urls: ['https://trashalert.io'],
    viewports: ['mobile'],
    pixel_diff_threshold: 5,
    load_time_warn_ms: 3000,
    lane,
  },
  results: [],
  summary: { total: 1, passed: 0, failed: 1, warnings: 0, errors: 0, needs_baseline: 0 },
  pass: false,
};

describe('insertRun', () => {
  it('POSTs to visual_check_runs with upsert Prefer and correct fields', async () => {
    const { calls, fn } = mockFetchSequence([{ ok: true }]);
    vi.stubGlobal('fetch', fn);
    await insertRun(baseRun, 'trashalert', 'trashalert/vc_testrun.html');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/visual_check_runs`);
    expect(calls[0]!.init.method).toBe('POST');
    const h = (calls[0]!.init.headers ?? {}) as Record<string, string>;
    expect(h['Prefer']).toContain('resolution=merge-duplicates');
    expect(h['apikey']).toBe(SERVICE_KEY);
    const body = JSON.parse((calls[0]!.init.body as string) ?? '{}');
    expect(body.id).toBe('vc_testrun');
    expect(body.project_id).toBe('trashalert');
    expect(body.deployment_url).toBe('https://preview.vercel.app');
    expect(body.branch).toBe('fix/hero-copy');
    expect(body.commit_sha).toBe('abc123');
    expect(body.verdict).toBe('fail');
    expect(body.html_report_path).toBe('trashalert/vc_testrun.html');
  });

  it('derives verdict=pass when summary is clean', async () => {
    const { calls, fn } = mockFetchSequence([{ ok: true }]);
    vi.stubGlobal('fetch', fn);
    const r = {
      ...baseRun,
      summary: { total: 1, passed: 1, failed: 0, warnings: 0, errors: 0, needs_baseline: 0 },
      pass: true,
    };
    await insertRun(r, 'trashalert', null);
    const body = JSON.parse((calls[0]!.init.body as string) ?? '{}');
    expect(body.verdict).toBe('pass');
  });
});

describe('insertResults', () => {
  const result: TargetResult = {
    url: 'https://trashalert.io',
    viewport: 'mobile',
    verdict: 'fail',
    pass: false,
    status: 200,
    diff_percentage: 12.5,
    screenshot: 'local/cap.png',
    baseline: 'local/base.png',
    diff_image: 'local/diff.png',
    console_errors: 0,
    load_time_ms: 1200,
    reasons: ['pixel_diff: 12.5% > 5%'],
    checks: [],
  };

  it('POSTs an array with storage keys mapped from the screenshots/diffs dicts', async () => {
    const { calls, fn } = mockFetchSequence([{ ok: true }]);
    vi.stubGlobal('fetch', fn);
    const k = `${result.url}|${result.viewport}`;
    await insertResults('vc_testrun', [result], {
      screenshots: { [k]: 'trashalert/vc_testrun/s.png' },
      diffs: { [k]: 'trashalert/vc_testrun/d.png' },
      baselines: { [k]: 'trashalert/x/b.png' },
    });
    const body = JSON.parse((calls[0]!.init.body as string) ?? '[]');
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].screenshot_path).toBe('trashalert/vc_testrun/s.png');
    expect(body[0].diff_image_path).toBe('trashalert/vc_testrun/d.png');
    expect(body[0].baseline_path).toBe('trashalert/x/b.png');
    expect(body[0].run_id).toBe('vc_testrun');
    expect(body[0].verdict).toBe('fail');
  });

  it('is a no-op when the results array is empty', async () => {
    const { calls, fn } = mockFetchSequence([{ ok: true }]);
    vi.stubGlobal('fetch', fn);
    await insertResults('vc_testrun', [], {});
    expect(calls).toHaveLength(0);
  });
});

describe('upsertBaseline', () => {
  it('deactivates prior approved rows then inserts the new one', async () => {
    const { calls, fn } = mockFetchSequence([{ ok: true }, { ok: true }]);
    vi.stubGlobal('fetch', fn);
    await upsertBaseline(
      'trashalert',
      'https://trashalert.io',
      'mobile',
      lane,
      'trashalert/slug/mobile.png',
      'vc_testrun',
      'HT',
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(calls[0]!.url).toContain('approved=eq.true');
    const patchBody = JSON.parse((calls[0]!.init.body as string) ?? '{}');
    expect(patchBody).toEqual({ approved: false });
    expect(calls[1]!.init.method).toBe('POST');
    const postBody = JSON.parse((calls[1]!.init.body as string) ?? '{}');
    expect(postBody.approved).toBe(true);
    expect(postBody.approved_by).toBe('HT');
    expect(postBody.lane_os).toBe('windows');
    expect(postBody.lane_runner).toBe('lenovo-local');
    expect(postBody.run_id).toBe('vc_testrun');
  });
});

describe('getActiveBaseline', () => {
  it('returns null when there is no approved row', async () => {
    const { fn } = mockFetchSequence([{ ok: true, json: [] }]);
    vi.stubGlobal('fetch', fn);
    const row = await getActiveBaseline('trashalert', 'https://x', 'mobile', lane);
    expect(row).toBeNull();
  });

  it('returns the first row when Supabase returns one', async () => {
    const { fn, calls } = mockFetchSequence([
      {
        ok: true,
        json: [
          {
            id: 'b1',
            project_id: 'trashalert',
            url: 'https://x',
            viewport: 'mobile',
            lane_os: 'windows',
            lane_runner: 'lenovo-local',
            storage_path: 'k.png',
            approved: true,
            approved_by: 'HT',
            approved_at: '2026-04-22T00:00:00Z',
            run_id: 'vc_1',
          },
        ],
      },
    ]);
    vi.stubGlobal('fetch', fn);
    const row = await getActiveBaseline('trashalert', 'https://x', 'mobile', lane);
    expect(row?.storage_path).toBe('k.png');
    expect(calls[0]!.url).toContain('approved=eq.true');
    expect(calls[0]!.url).toContain('limit=1');
  });
});

describe('getRun', () => {
  it('returns null when the run is unknown', async () => {
    const { fn } = mockFetchSequence([{ ok: true, json: [] }]);
    vi.stubGlobal('fetch', fn);
    const r = await getRun('vc_missing');
    expect(r).toBeNull();
  });

  it('returns the run row plus its per-target results', async () => {
    const { fn } = mockFetchSequence([
      {
        ok: true,
        json: [
          {
            id: 'vc_1',
            project_id: 'trashalert',
            verdict: 'pass',
            config: baseRun.config,
            html_report_path: 'r.html',
          },
        ],
      },
      {
        ok: true,
        json: [
          { url: 'https://x', viewport: 'mobile', verdict: 'pass', screenshot_path: 's.png' },
        ],
      },
    ]);
    vi.stubGlobal('fetch', fn);
    const r = await getRun('vc_1');
    expect(r?.run.id).toBe('vc_1');
    expect(r?.results).toHaveLength(1);
    expect(r?.results[0]!.screenshot_path).toBe('s.png');
  });
});
