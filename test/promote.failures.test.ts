import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/storage.js', () => ({
  uploadArtifact: vi.fn(async (_: string, __: string, k: string) => k),
  signedUrl: vi.fn(async () => 'https://signed.example/s.png'),
  downloadBaseline: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  insertRun: vi.fn(),
  insertResults: vi.fn(),
  upsertBaseline: vi.fn(async () => {}),
  getActiveBaseline: vi.fn(),
  getRun: vi.fn(),
}));

import { runPromote } from '../src/commands/promote.js';
import * as storage from '../src/storage.js';
import * as db from '../src/db.js';
import { BaselineLane } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'linux', runner: 'thinkcentre-local' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.uploadArtifact).mockImplementation(async (_l, _b, key) => key);
  const payload = new Uint8Array([137, 80, 78, 71]);
  vi.stubGlobal(
    'fetch',
    (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
      text: async () => '',
      json: async () => ({}),
    })) as unknown as typeof fetch,
  );
  vi.mocked(db.getRun).mockResolvedValue({
    run: {
      id: 'vc_mix',
      project_id: 'trashalert',
      verdict: 'pass',
      config: { urls: ['https://x.io'], viewports: ['mobile', 'desktop'], pixel_diff_threshold: 5, load_time_warn_ms: 3000, lane },
      html_report_path: null,
    },
    results: [
      { url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: 'k1.png' },
      { url: 'https://x.io', viewport: 'desktop', verdict: 'pass', screenshot_path: 'k2.png' },
      { url: 'https://y.io', viewport: 'mobile', verdict: 'fail', screenshot_path: 'k3.png' },
    ],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runPromote failures', () => {
  it('reports and logs a target whose upload failed, keeping the others promoted', async () => {
    vi.mocked(storage.uploadArtifact).mockImplementation(async (_l, _b, key) => {
      // Match the viewport segment, not the exact file name: per-run baseline
      // keys (#75) append the run id, e.g. `.../desktop-vc_mix.png`.
      if (/\/desktop(-[^/]*)?\.png$/.test(key)) throw new Error('uploadArtifact failed: 503 busy');
      return key;
    });
    const lines: string[] = [];

    const result = await runPromote({ runId: 'vc_mix', log: (l) => lines.push(l) });

    expect(result.promoted.map((p) => p.viewport)).toEqual(['mobile']);
    expect(result.failed).toEqual([
      { url: 'https://x.io', viewport: 'desktop', reason: 'uploadArtifact failed: 503 busy' },
    ]);
    expect(result.skipped).toContainEqual(result.failed[0]);
    expect(lines).toContain('  ✗ https://x.io @ desktop: uploadArtifact failed: 503 busy');
    expect(lines.at(-1)).toBe('[visual-check] promote: 1 promoted, 2 skipped (1 failed)');
  });

  it('reports a database error the same way', async () => {
    vi.mocked(db.upsertBaseline).mockRejectedValueOnce(new Error('visual_check_baselines insert failed'));

    const result = await runPromote({ runId: 'vc_mix', log: () => {} });

    expect(result.promoted).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toContain('insert failed');
  });

  it('counts a --select pair that is not in the run as failed', async () => {
    const result = await runPromote({
      runId: 'vc_mix',
      targets: 'selected',
      selected: [
        { url: 'https://x.io', viewport: 'mobile' },
        { url: 'https://x.io/', viewport: 'desktop' },
      ],
      log: () => {},
    });

    expect(result.promoted).toHaveLength(1);
    expect(result.failed).toEqual([
      { url: 'https://x.io/', viewport: 'desktop', reason: 'not in run vc_mix' },
    ]);
  });

  it('does not count policy skips (fail verdict, not selected) as failed', async () => {
    const all = await runPromote({ runId: 'vc_mix', log: () => {} });
    expect(all.promoted).toHaveLength(2);
    expect(all.skipped).toEqual([{ url: 'https://y.io', viewport: 'mobile', reason: 'verdict=fail' }]);
    expect(all.failed).toEqual([]);

    const some = await runPromote({
      runId: 'vc_mix',
      targets: 'selected',
      selected: [{ url: 'https://x.io', viewport: 'mobile' }],
      log: () => {},
    });
    expect(some.promoted).toHaveLength(1);
    expect(some.failed).toEqual([]);
  });
});
