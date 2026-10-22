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

import { resolvePromoteSelection, runPromote } from '../src/commands/promote.js';
import { UsageError } from '../src/cli-args.js';
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

function mockRun(results: Array<{ url: string; viewport: string; verdict: string; screenshot_path: string | null }>) {
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
    results,
  });
}

describe('runPromote selection validation', () => {
  it('rejects --targets=selected with no --select at all, without calling db.getRun', async () => {
    await expect(
      runPromote({ runId: 'vc_ok', targets: 'selected', log: () => {} }),
    ).rejects.toThrow(/--select/);
    expect(db.getRun).not.toHaveBeenCalled();
  });

  it('rejects --targets=selected with an empty --select list, without calling db.getRun', async () => {
    await expect(
      runPromote({ runId: 'vc_ok', targets: 'selected', selected: [], log: () => {} }),
    ).rejects.toThrow(/--select/);
    expect(db.getRun).not.toHaveBeenCalled();
  });

  it('reports a selected pair that matched no result in the run (typo/trailing slash)', async () => {
    mockRun([
      { url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: 'k1.png' },
      { url: 'https://x.io', viewport: 'desktop', verdict: 'pass', screenshot_path: 'k2.png' },
    ]);

    const result = await runPromote({
      runId: 'vc_ok',
      targets: 'selected',
      selected: [{ url: 'https://x.io/', viewport: 'desktop' }],
      log: () => {},
    });

    expect(result.promoted).toHaveLength(0);
    const ghost = result.skipped.find((s) => s.url === 'https://x.io/' && s.viewport === 'desktop');
    expect(ghost).toBeDefined();
    expect(ghost!.reason).toContain('vc_ok');
    expect(ghost!.reason).not.toBe('not selected');
  });

  it('promotes the real matched pair and still reports a ghost selection', async () => {
    mockRun([
      { url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: 'k1.png' },
      { url: 'https://x.io', viewport: 'desktop', verdict: 'pass', screenshot_path: 'k2.png' },
    ]);

    const result = await runPromote({
      runId: 'vc_ok',
      targets: 'selected',
      selected: [
        { url: 'https://x.io', viewport: 'desktop' },
        { url: 'https://ghost.io', viewport: 'mobile' },
      ],
      log: () => {},
    });

    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]!.viewport).toBe('desktop');

    const mobileSkip = result.skipped.find((s) => s.url === 'https://x.io' && s.viewport === 'mobile');
    expect(mobileSkip!.reason).toBe('not selected');

    const ghost = result.skipped.find((s) => s.url === 'https://ghost.io' && s.viewport === 'mobile');
    expect(ghost).toBeDefined();
    expect(ghost!.reason).toContain('vc_ok');
  });

  it('leaves --targets=all unaffected: no unmatched-selection entries appear', async () => {
    mockRun([
      { url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: 'k1.png' },
      { url: 'https://x.io', viewport: 'desktop', verdict: 'pass', screenshot_path: 'k2.png' },
    ]);

    const result = await runPromote({ runId: 'vc_ok', targets: 'all', log: () => {} });

    expect(result.promoted).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('leaves omitted --targets unaffected: no unmatched-selection entries appear', async () => {
    mockRun([
      { url: 'https://x.io', viewport: 'mobile', verdict: 'pass', screenshot_path: 'k1.png' },
      { url: 'https://x.io', viewport: 'desktop', verdict: 'pass', screenshot_path: 'k2.png' },
    ]);

    const result = await runPromote({ runId: 'vc_ok', log: () => {} });

    expect(result.promoted).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });
});

describe('resolvePromoteSelection (--targets / --select)', () => {
  it('treats --select on its own as --targets selected (it was silently ignored before)', () => {
    expect(resolvePromoteSelection(undefined, 'https://x.io@mobile, https://x.io/a@desktop')).toEqual({
      targets: 'selected',
      selected: [
        { url: 'https://x.io', viewport: 'mobile' },
        { url: 'https://x.io/a', viewport: 'desktop' },
      ],
    });
  });

  it('defaults to all when neither flag is given', () => {
    expect(resolvePromoteSelection(undefined, undefined)).toEqual({ targets: 'all' });
    expect(resolvePromoteSelection('all', undefined)).toEqual({ targets: 'all' });
  });

  it('rejects an unknown --targets value instead of skipping every target', () => {
    expect(() => resolvePromoteSelection('selcted', 'https://x.io@mobile')).toThrow(UsageError);
    expect(() => resolvePromoteSelection('selcted', undefined)).toThrow(/Invalid --targets: selcted/);
    // The README used to show url@viewport pairs passed to --targets.
    expect(() => resolvePromoteSelection('https://x.io@mobile', undefined)).toThrow(UsageError);
  });

  it('rejects --targets all combined with --select', () => {
    expect(() => resolvePromoteSelection('all', 'https://x.io@mobile')).toThrow(/cannot be combined/);
  });

  it('rejects selected with nothing selected and malformed pairs', () => {
    expect(() => resolvePromoteSelection('selected', undefined)).toThrow(UsageError);
    expect(() => resolvePromoteSelection(undefined, ' , ')).toThrow(UsageError);
    expect(() => resolvePromoteSelection(undefined, 'https://x.io')).toThrow(/Invalid --select entry/);
    expect(() => resolvePromoteSelection(undefined, 'https://x.io@')).toThrow(/Invalid --select entry/);
    expect(() => resolvePromoteSelection(undefined, '@mobile')).toThrow(/Invalid --select entry/);
  });

  it('promotes only the selected pair when --select is given without --targets', async () => {
    mockRun([
      { url: 'https://x.io', viewport: 'mobile', verdict: 'fail', screenshot_path: 'k1.png' },
      { url: 'https://x.io', viewport: 'desktop', verdict: 'fail', screenshot_path: 'k2.png' },
    ]);
    const sel = resolvePromoteSelection(undefined, 'https://x.io@desktop');
    const result = await runPromote({ runId: 'vc_ok', ...sel, acceptFail: true, log: () => {} });
    expect(result.promoted.map((p) => p.viewport)).toEqual(['desktop']);
    expect(result.skipped).toEqual([{ url: 'https://x.io', viewport: 'mobile', reason: 'not selected' }]);
  });
});
