import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Hoisted mocks ---------------------------------------------------------
// These replace every external dependency of deploy-gate so the test
// exercises orchestration only. No real browser, no real network.

vi.mock('../src/capture.js', () => ({
  Capturer: class {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async capture(url: string, vp: { name: string }, outPath: string) {
      const { promises: fsp } = await import('node:fs');
      const pathMod = await import('node:path');
      await fsp.mkdir(pathMod.dirname(outPath), { recursive: true });
      await fsp.writeFile(outPath, Buffer.from([137, 80, 78, 71]));
      return {
        url,
        viewport: vp.name,
        screenshotPath: outPath,
        httpStatus: 200,
        consoleErrors: [],
        loadTimeMs: 100,
      };
    }
  },
  urlToSlug: (u: string) =>
    u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '_'),
}));

vi.mock('../src/diff.js', () => ({
  diffPngs: vi.fn(async () => ({
    diffPercentage: 20,
    diffPixels: 200,
    totalPixels: 1000,
    diffImagePath: null,
    dimensionMismatch: false,
    baselineDimensions: { width: 100, height: 100 },
    actualDimensions: { width: 100, height: 100 },
  })),
  fileExists: vi.fn(async () => true),
}));

vi.mock('../src/storage.js', () => ({
  uploadArtifact: vi.fn(async (_local: string, _bucket: string, key: string) => key),
  signedUrl: vi.fn(async () => 'https://signed.example/report.html'),
  downloadBaseline: vi.fn(async () => null),
}));

vi.mock('../src/db.js', () => ({
  insertRun: vi.fn(async () => {}),
  insertResults: vi.fn(async () => {}),
  upsertBaseline: vi.fn(async () => {}),
  getActiveBaseline: vi.fn(async () => null),
  getRun: vi.fn(async () => null),
}));

vi.mock('../src/alerts.js', () => ({
  sendTelegramAlert: vi.fn(async () => {}),
}));

// --- Imports that use the mocked modules ----------------------------------
import { runDeployGate } from '../src/commands/deploy-gate.js';
import * as storage from '../src/storage.js';
import * as db from '../src/db.js';
import * as alerts from '../src/alerts.js';
import { BaselineLane } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'windows', runner: 'lenovo-local' };

let workRoot: string;

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-deploy-gate-test-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

function baseOpts(over: Record<string, unknown> = {}) {
  return {
    urls: ['https://trashalert.io'],
    viewports: [{ name: 'mobile', width: 390, height: 844 }],
    outRoot: workRoot,
    threshold: 5,
    loadTimeWarnMs: 3000,
    concurrency: 1,
    projectId: 'trashalert',
    deploymentUrl: 'https://preview.vercel.app',
    branch: 'main',
    commitSha: 'deadbeef',
    lane,
    headless: true,
    quiet: true,
    ...over,
  } as const;
}

describe('runDeployGate orchestration', () => {
  it('uploads artifacts, persists run + results, signs the report, and alerts on needs_baseline', async () => {
    const result = await runDeployGate(baseOpts());

    // Baseline fetch was attempted
    expect(storage.downloadBaseline).toHaveBeenCalledWith(
      'trashalert',
      'https://trashalert.io',
      'mobile',
      lane,
      expect.any(String),
    );

    // Screenshot + HTML uploads happened
    const uploadCalls = vi.mocked(storage.uploadArtifact).mock.calls;
    const buckets = uploadCalls.map((c) => c[1]);
    expect(buckets).toContain('visual-check-screenshots');
    expect(buckets).toContain('visual-check-reports');

    // Persisted
    expect(db.insertRun).toHaveBeenCalledTimes(1);
    expect(db.insertResults).toHaveBeenCalledTimes(1);

    // Signed URL requested
    expect(storage.signedUrl).toHaveBeenCalled();
    expect(result.signedReportUrl).toBe('https://signed.example/report.html');

    // Alert fired (verdict is needs_baseline because downloadBaseline returned null)
    expect(alerts.sendTelegramAlert).toHaveBeenCalledTimes(1);
    expect(result.alertSent).toBe(true);
    expect(result.report.pass).toBe(false);
    expect(result.report.summary.needs_baseline).toBe(1);
  });

  it('does NOT alert when verdict is pass (baseline downloaded, diff within threshold)', async () => {
    vi.mocked(storage.downloadBaseline).mockResolvedValueOnce('fake-path.png');
    const { diffPngs } = await import('../src/diff.js');
    vi.mocked(diffPngs).mockResolvedValueOnce({
      diffPercentage: 1,
      diffPixels: 10,
      totalPixels: 1000,
      diffImagePath: null,
      dimensionMismatch: false,
      baselineDimensions: { width: 100, height: 100 },
      actualDimensions: { width: 100, height: 100 },
    });

    const result = await runDeployGate(baseOpts());

    expect(result.report.pass).toBe(true);
    expect(result.report.summary.passed).toBe(1);
    expect(alerts.sendTelegramAlert).not.toHaveBeenCalled();
    expect(result.alertSent).toBe(false);
  });

  it('alerts on fail verdict (pixel diff over threshold)', async () => {
    vi.mocked(storage.downloadBaseline).mockResolvedValueOnce('fake-path.png');
    // default diffPngs mock returns 20% — over 5% threshold → fail

    const result = await runDeployGate(baseOpts());

    expect(result.report.summary.failed).toBe(1);
    expect(result.report.pass).toBe(false);
    expect(alerts.sendTelegramAlert).toHaveBeenCalledTimes(1);
  });

  it('records the Phase 2 report context (projectId/deploymentUrl/branch/sha/storageKeys)', async () => {
    const result = await runDeployGate(baseOpts());
    expect(result.report.projectId).toBe('trashalert');
    expect(result.report.deploymentUrl).toBe('https://preview.vercel.app');
    expect(result.report.branch).toBe('main');
    expect(result.report.commitSha).toBe('deadbeef');
    expect(result.report.storageKeys?.htmlReport).toBeTruthy();
  });

  it('does not call insertRun twice on a single run', async () => {
    await runDeployGate(baseOpts());
    expect(db.insertRun).toHaveBeenCalledTimes(1);
  });
});
