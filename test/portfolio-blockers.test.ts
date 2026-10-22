/**
 * portfolio-blockers.test.ts
 *
 * Covers the fixes that came out of the portfolio smoke blockers
 * (issues #6, #7, #8): `baseline` never saves an error page as the
 * approved picture, a Vercel DEPLOYMENT_NOT_FOUND 404 is named as a hosting
 * problem, and the receipt's next_action counts HTTP and visual failures
 * separately. No browser, no network.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BaselineCapturer,
  baselinePathFor,
  baselineRejectionReason,
  runBaseline,
} from '../src/commands/baseline.js';
import { hostingErrorFromHeaders } from '../src/capture.js';
import { buildTargetResult, checkHttpStatus } from '../src/checks.js';
import { explainReport } from '../src/explain.js';
import { buildReport } from '../src/report.js';
import { nextActionFor } from '../src/receipt.js';
import { BaselineLane, CaptureArtifact, TargetResult, ViewportSpec } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const MOBILE: ViewportSpec = { name: 'mobile', width: 390, height: 844 };
const DESKTOP: ViewportSpec = { name: 'desktop', width: 1440, height: 900 };

function artifact(overrides: Partial<CaptureArtifact> = {}): CaptureArtifact {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    screenshotPath: '/tmp/shot.png',
    httpStatus: 200,
    consoleErrors: [],
    loadTimeMs: 100,
    ...overrides,
  };
}

/** Writes `content` to the requested path and reports the configured status. */
function stubCapturer(
  outcomes: Record<string, { status: number | null; error?: string; content: string }>,
): BaselineCapturer & { started: boolean; stopped: boolean } {
  return {
    started: false,
    stopped: false,
    async start() {
      this.started = true;
    },
    async stop() {
      this.stopped = true;
    },
    async capture(url, viewport, outputPath) {
      const o = outcomes[url]!;
      if (!o.error) {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, o.content);
      }
      return artifact({
        url,
        viewport: viewport.name,
        screenshotPath: outputPath,
        httpStatus: o.status,
        error: o.error,
      });
    },
  };
}

describe('visual-check baseline only saves healthy captures', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-baseline-cmd-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('saves a 200 capture and refuses a 404 without touching its old baseline', async () => {
    const good = 'https://good.example';
    const gone = 'https://gone.example';
    const goneBaseline = baselinePathFor(root, gone, 'mobile');
    await fs.mkdir(path.dirname(goneBaseline), { recursive: true });
    await fs.writeFile(goneBaseline, 'previously approved');

    const capturer = stubCapturer({
      [good]: { status: 200, content: 'fresh good capture' },
      [gone]: { status: 404, content: 'deployment not found page' },
    });
    const lines: string[] = [];
    const result = await runBaseline({
      urls: [good, gone],
      viewports: [MOBILE],
      root,
      capturer,
      log: (l) => lines.push(l),
    });

    expect(capturer.started && capturer.stopped).toBe(true);
    expect(result.failures).toBe(1);
    expect(result.outcomes.map((o) => [o.url, o.saved])).toEqual([
      [good, true],
      [gone, false],
    ]);
    expect(result.outcomes[1]!.reason).toBe('HTTP 404');
    expect(await fs.readFile(baselinePathFor(root, good, 'mobile'), 'utf8')).toBe(
      'fresh good capture',
    );
    expect(await fs.readFile(goneBaseline, 'utf8')).toBe('previously approved');
    // No temporary capture files are left next to the baselines.
    const leftovers = await fs.readdir(path.dirname(goneBaseline));
    expect(leftovers).toEqual(['mobile.png']);
    expect(lines.join('\n')).toMatch(/gone\.example @ mobile \.\.\. NOT SAVED: HTTP 404/);
  });

  it('refuses capture errors and missing responses, creating no baseline', async () => {
    const broken = 'https://broken.example';
    const silent = 'https://silent.example';
    const result = await runBaseline({
      urls: [broken, silent],
      viewports: [MOBILE, DESKTOP],
      root,
      capturer: stubCapturer({
        [broken]: { status: null, error: 'navigation_timeout', content: '' },
        [silent]: { status: null, content: 'blank' },
      }),
      log: () => {},
    });

    expect(result.failures).toBe(4);
    expect(result.outcomes.map((o) => o.reason)).toEqual([
      'capture error: navigation_timeout',
      'capture error: navigation_timeout',
      'no HTTP response received',
      'no HTTP response received',
    ]);
    await expect(fs.stat(path.join(root, 'baselines', 'silent-example'))).rejects.toThrow();
  });

  it('accepts 2xx and 3xx statuses only', () => {
    expect(baselineRejectionReason(artifact({ httpStatus: 200 }))).toBeNull();
    expect(baselineRejectionReason(artifact({ httpStatus: 301 }))).toBeNull();
    expect(baselineRejectionReason(artifact({ httpStatus: 500 }))).toBe('HTTP 500');
  });
});

describe('hosting error diagnostics', () => {
  it('maps exact x-vercel-error codes and ignores anything else', () => {
    expect(hostingErrorFromHeaders({ 'x-vercel-error': 'DEPLOYMENT_NOT_FOUND' })).toBe(
      'DEPLOYMENT_NOT_FOUND',
    );
    expect(hostingErrorFromHeaders({ 'x-vercel-error': ' deployment_paused ' })).toBe(
      'DEPLOYMENT_PAUSED',
    );
    expect(
      hostingErrorFromHeaders({ 'x-vercel-error': 'https://attacker.invalid/?token=CANARY' }),
    ).toBeUndefined();
    expect(hostingErrorFromHeaders({ server: 'Vercel' })).toBeUndefined();
    expect(hostingErrorFromHeaders(null)).toBeUndefined();
  });

  it('names the hosting cause in the failing HTTP check and target result', () => {
    const cap = artifact({ httpStatus: 404, hostingError: 'DEPLOYMENT_NOT_FOUND' });
    const http = checkHttpStatus(cap);
    expect(http.status).toBe('fail');
    expect(http.message).toBe(
      'HTTP 404 (Vercel DEPLOYMENT_NOT_FOUND: no deployment is assigned to this domain)',
    );

    const result = buildTargetResult({
      cap,
      diff: null,
      baselineExists: false,
      baselinePath: '/tmp/base.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(result.verdict).toBe('fail');
    expect(result.hosting_error).toBe('DEPLOYMENT_NOT_FOUND');
  });

  it('keeps the plain message for a healthy response or an unknown code', () => {
    expect(
      checkHttpStatus(artifact({ httpStatus: 200, hostingError: 'DEPLOYMENT_NOT_FOUND' })).message,
    ).toBe('HTTP 200');
    expect(checkHttpStatus(artifact({ httpStatus: 404, hostingError: 'MADE_UP' })).message).toBe(
      'HTTP 404',
    );
    const result = buildTargetResult({
      cap: artifact({ httpStatus: 404, hostingError: 'MADE_UP' }),
      diff: null,
      baselineExists: false,
      baselinePath: '/tmp/base.png',
      pixelDiffThresholdPct: 5,
      loadTimeWarnMs: 3000,
    });
    expect(result.hosting_error).toBeUndefined();
  });

  it('explains a missing deployment in plain words', () => {
    const results = [MOBILE, DESKTOP].map((vp) =>
      buildTargetResult({
        cap: artifact({
          url: 'https://prelithic.build',
          viewport: vp.name,
          httpStatus: 404,
          hostingError: 'DEPLOYMENT_NOT_FOUND',
        }),
        diff: null,
        baselineExists: false,
        baselinePath: '/tmp/base.png',
        pixelDiffThresholdPct: 5,
        loadTimeWarnMs: 3000,
      }),
    );
    const report = buildReport({
      urls: ['https://prelithic.build'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });
    expect(explainReport(report).sentences[0]).toBe(
      'prelithic.build did not load on every screen size (error 404: nothing is deployed there).',
    );
  });
});

describe('next_action counts each failure cause separately', () => {
  function failed(url: string, cause: 'http' | 'visual'): TargetResult {
    return {
      url,
      viewport: 'mobile',
      verdict: 'fail',
      pass: false,
      status: cause === 'http' ? 404 : 200,
      diff_percentage: cause === 'visual' ? 12 : null,
      screenshot: '/tmp/shot.png',
      baseline: '/tmp/base.png',
      diff_image: null,
      console_errors: 0,
      load_time_ms: 100,
      reasons: [],
      checks: [
        {
          name: 'http_status',
          mode: 'blocking',
          status: cause === 'http' ? 'fail' : 'pass',
          message: cause === 'http' ? 'HTTP 404' : 'HTTP 200',
          blocking: cause === 'http',
        },
        {
          name: 'pixel_diff',
          mode: 'blocking',
          status: cause === 'visual' ? 'fail' : 'skip',
          message: cause === 'visual' ? '12%' : 'skipped',
          blocking: cause === 'visual',
        },
      ],
    };
  }

  it('says 1 site-owner target and 2 visual changes for a mixed run', () => {
    const report = buildReport({
      urls: ['https://a.example', 'https://b.example', 'https://c.example'],
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [
        failed('https://a.example', 'http'),
        failed('https://b.example', 'visual'),
        failed('https://c.example', 'visual'),
      ],
      lane,
    });
    const action = nextActionFor(report);
    expect(action).toContain('1 target(s) need site-owner investigation.');
    expect(action).toContain('2 target(s) changed visually');
    expect(action).not.toContain('3 target(s)');
  });

  it('does not claim a visual change when only HTTP failed', () => {
    const report = buildReport({
      urls: ['https://a.example'],
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [failed('https://a.example', 'http')],
      lane,
    });
    expect(nextActionFor(report)).toBe('1 target(s) need site-owner investigation.');
  });
});
