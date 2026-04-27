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

const lane: BaselineLane = { browser: 'chromium', os: 'windows', runner: 'lenovo-local' };

beforeEach(() => {
  vi.clearAllMocks();
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runPromote', () => {
  it('promotes only passed/warn targets and upserts baselines for each', async () => {
    vi.mocked(db.getRun).mockResolvedValue({
      run: {
        id: 'vc_ok',
        project_id: 'trashalert',
        verdict: 'pass',
        config: {
          urls: ['https://x.io', 'https://y.io'],
          viewports: ['mobile', 'desktop'],
          pixel_diff_threshold: 5,
          load_time_warn_ms: 3000,
          lane,
        },
        html_report_path: null,
      },
      results: [
        { url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: 'k1.png' },
        { url: 'https://x.io', viewport: 'desktop', verdict: 'warn', screenshot_path: 'k2.png' },
        { url: 'https://y.io', viewport: 'mobile', verdict: 'fail', screenshot_path: 'k3.png' },
      ],
    });

    const result = await runPromote({ runId: 'vc_ok', log: () => {} });

    expect(result.promoted).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('fail');
    expect(db.upsertBaseline).toHaveBeenCalledTimes(2);
    expect(storage.uploadArtifact).toHaveBeenCalledTimes(2);
  });

  it('throws when the run id is unknown', async () => {
    vi.mocked(db.getRun).mockResolvedValue(null);
    await expect(runPromote({ runId: 'vc_none', log: () => {} })).rejects.toThrow(/not found/);
  });

  it('skips targets with no screenshot_path', async () => {
    vi.mocked(db.getRun).mockResolvedValue({
      run: {
        id: 'vc_ok',
        project_id: 'trashalert',
        verdict: 'pass',
        config: {
          urls: ['https://x.io'],
          viewports: ['mobile'],
          pixel_diff_threshold: 5,
          load_time_warn_ms: 3000,
          lane,
        },
        html_report_path: null,
      },
      results: [{ url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: null }],
    });

    const result = await runPromote({ runId: 'vc_ok', log: () => {} });
    expect(result.promoted).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('no screenshot_path');
    expect(db.upsertBaseline).not.toHaveBeenCalled();
  });

  it('skips needs_baseline targets when seed mode is off (default)', async () => {
    vi.mocked(db.getRun).mockResolvedValue({
      run: {
        id: 'vc_seed',
        project_id: 'trashalert',
        verdict: 'needs_baseline',
        config: {
          urls: ['https://x.io'],
          viewports: ['mobile', 'desktop'],
          pixel_diff_threshold: 5,
          load_time_warn_ms: 3000,
          lane,
        },
        html_report_path: null,
      },
      results: [
        { url: 'https://x.io', viewport: 'mobile', verdict: 'needs_baseline', screenshot_path: 'k1.png' },
        { url: 'https://x.io', viewport: 'desktop', verdict: 'needs_baseline', screenshot_path: 'k2.png' },
      ],
    });

    const result = await runPromote({ runId: 'vc_seed', log: () => {} });
    expect(result.promoted).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]!.reason).toContain('needs_baseline');
    expect(db.upsertBaseline).not.toHaveBeenCalled();
  });

  it('promotes needs_baseline targets when seed=true', async () => {
    vi.mocked(db.getRun).mockResolvedValue({
      run: {
        id: 'vc_seed',
        project_id: 'trashalert',
        verdict: 'needs_baseline',
        config: {
          urls: ['https://x.io'],
          viewports: ['mobile', 'desktop'],
          pixel_diff_threshold: 5,
          load_time_warn_ms: 3000,
          lane,
        },
        html_report_path: null,
      },
      results: [
        { url: 'https://x.io', viewport: 'mobile', verdict: 'needs_baseline', screenshot_path: 'k1.png' },
        { url: 'https://x.io', viewport: 'desktop', verdict: 'needs_baseline', screenshot_path: 'k2.png' },
        { url: 'https://x.io', viewport: 'tablet', verdict: 'fail', screenshot_path: 'k3.png' },
      ],
    });

    const result = await runPromote({ runId: 'vc_seed', seed: true, approvedBy: 'HT', log: () => {} });
    expect(result.promoted).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('fail');
    expect(db.upsertBaseline).toHaveBeenCalledTimes(2);
    expect(storage.uploadArtifact).toHaveBeenCalledTimes(2);
  });

  it('respects --targets=selected and only promotes chosen pairs', async () => {
    vi.mocked(db.getRun).mockResolvedValue({
      run: {
        id: 'vc_ok',
        project_id: 'trashalert',
        verdict: 'pass',
        config: {
          urls: ['https://x.io'],
          viewports: ['mobile', 'desktop'],
          pixel_diff_threshold: 5,
          load_time_warn_ms: 3000,
          lane,
        },
        html_report_path: null,
      },
      results: [
        { url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: 'k1.png' },
        { url: 'https://x.io', viewport: 'desktop', verdict: 'pass', screenshot_path: 'k2.png' },
      ],
    });

    const result = await runPromote({
      runId: 'vc_ok',
      targets: 'selected',
      selected: [{ url: 'https://x.io', viewport: 'desktop' }],
      log: () => {},
    });

    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]!.viewport).toBe('desktop');
    expect(result.skipped[0]!.reason).toBe('not selected');
  });
});
