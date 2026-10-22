import { describe, it, expect } from 'vitest';
import { buildReport } from '../src/report.js';
import { explainReport, speak } from '../src/explain.js';
import { BaselineLane, TargetResult, Verdict, ViewportSpec } from '../src/types.js';

const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };

const MOBILE: ViewportSpec = { name: 'mobile', width: 390, height: 844 };
const TABLET: ViewportSpec = { name: 'tablet', width: 768, height: 1024 };
const DESKTOP: ViewportSpec = { name: 'desktop', width: 1440, height: 900 };

function tgt(opts: {
  url: string;
  viewport: string;
  verdict: Verdict;
  status?: number | null;
  diffPct?: number | null;
  httpFail?: boolean;
  dimensionMismatch?: boolean;
}): TargetResult {
  const {
    url,
    viewport,
    verdict,
    status = 200,
    diffPct = null,
    httpFail = false,
    dimensionMismatch = false,
  } = opts;

  let checks: TargetResult['checks'];
  switch (verdict) {
    case 'pass':
      checks = [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: `HTTP ${status}`, blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '0%', blocking: false },
      ];
      break;
    case 'warn':
      checks = [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: `HTTP ${status}`, blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '0%', blocking: false },
        { name: 'load_time', mode: 'warn', status: 'warn', message: 'slow', blocking: false },
      ];
      break;
    case 'fail':
      checks = httpFail
        ? [
            { name: 'http_status', mode: 'blocking', status: 'fail', message: `HTTP ${status}`, blocking: true },
            {
              name: 'pixel_diff',
              mode: 'blocking',
              status: 'skip',
              message: 'skipped due to capture error',
              blocking: false,
            },
          ]
        : [
            { name: 'http_status', mode: 'blocking', status: 'pass', message: `HTTP ${status}`, blocking: false },
            {
              name: 'pixel_diff',
              mode: 'blocking',
              status: 'fail',
              message: dimensionMismatch
                ? 'dimensions 100×100 ≠ baseline 200×200'
                : `pixel diff ${diffPct ?? 0}%`,
              blocking: true,
            },
          ];
      break;
    case 'error':
      checks = [
        {
          name: 'http_status',
          mode: 'blocking',
          status: 'error',
          message: 'navigation error: timeout',
          blocking: true,
        },
      ];
      break;
    case 'needs_baseline':
      checks = [
        { name: 'http_status', mode: 'blocking', status: 'pass', message: `HTTP ${status}`, blocking: false },
        { name: 'pixel_diff', mode: 'blocking', status: 'skip', message: 'no baseline', blocking: false },
      ];
      break;
  }

  return {
    url,
    viewport,
    verdict,
    pass: verdict === 'pass' || verdict === 'warn',
    status: verdict === 'error' ? null : status,
    diff_percentage: verdict === 'fail' && !httpFail ? (dimensionMismatch ? null : diffPct) : null,
    screenshot: '',
    baseline: verdict === 'needs_baseline' ? null : 'baselines/example/mobile.png',
    diff_image: null,
    console_errors: 0,
    load_time_ms: 0,
    reasons: [],
    checks,
  };
}

describe('explainReport', () => {
  it('matches the portfolio case from issue #6', () => {
    const sites = ['https://trashalert.io', 'https://actorlab.io', 'https://lims.bot', 'https://noui.bot'];
    const results: TargetResult[] = [];
    for (const url of sites) {
      for (const vp of ['mobile', 'tablet', 'desktop']) {
        results.push(tgt({ url, viewport: vp, verdict: 'needs_baseline' }));
      }
    }
    for (const vp of ['mobile', 'tablet', 'desktop']) {
      results.push(
        tgt({ url: 'https://prelithic.build', viewport: vp, verdict: 'fail', httpFail: true, status: 404 }),
      );
    }

    const report = buildReport({
      urls: [...sites, 'https://prelithic.build'],
      viewports: [MOBILE, TABLET, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.headline).toBe('15 pages checked. 0 are fine.');
    expect(explanation.sentences).toEqual([
      'prelithic.build did not load on every screen size (error 404).',
      'trashalert.io has no approved picture yet on every screen size.',
      'actorlab.io has no approved picture yet on every screen size.',
      'And 2 more problems.',
      'Blocked: the pages that did not load need fixing first.',
    ]);
    expect(explanation.text).toBe(
      [explanation.headline, ...explanation.sentences].join(' '),
    );
  });

  it('says it is safe to continue on an all-pass run', () => {
    const results = [
      tgt({ url: 'https://example.com', viewport: 'mobile', verdict: 'pass' }),
      tgt({ url: 'https://example.com', viewport: 'desktop', verdict: 'pass' }),
    ];
    const report = buildReport({
      urls: ['https://example.com'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.headline).toBe('2 pages checked. 2 are fine.');
    expect(explanation.sentences).toEqual(['Safe to continue.']);
  });

  it('rounds a 12.4% pixel diff to "12% changed"', () => {
    const results = [
      tgt({ url: 'https://actorlab.io', viewport: 'desktop', verdict: 'fail', diffPct: 12.4 }),
    ];
    const report = buildReport({
      urls: ['https://actorlab.io'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.sentences).toEqual([
      'actorlab.io looks different on desktop (12% changed).',
      'Someone should open the report and look at the pictures.',
    ]);
  });

  it('reads a 0.4% pixel diff as "under 1% changed"', () => {
    const results = [
      tgt({ url: 'https://actorlab.io', viewport: 'desktop', verdict: 'fail', diffPct: 0.4 }),
    ];
    const report = buildReport({
      urls: ['https://actorlab.io'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.sentences[0]).toBe('actorlab.io looks different on desktop (under 1% changed).');
  });

  it('describes a dimension mismatch as "the page size changed"', () => {
    const results = [
      tgt({ url: 'https://actorlab.io', viewport: 'desktop', verdict: 'fail', dimensionMismatch: true }),
    ];
    const report = buildReport({
      urls: ['https://actorlab.io'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.sentences[0]).toBe('actorlab.io looks different on desktop (the page size changed).');
  });

  it('reports a verdict of error as "could not be checked"', () => {
    const results = [tgt({ url: 'https://example.com', viewport: 'mobile', verdict: 'error' })];
    const report = buildReport({
      urls: ['https://example.com'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.sentences).toEqual([
      'example.com could not be checked on phone.',
      'Blocked: the pages that could not be checked need fixing first.',
    ]);
  });

  it('names both blocking kinds when one page did not load and another could not be checked', () => {
    const results = [
      tgt({ url: 'https://a.com', viewport: 'mobile', verdict: 'fail', status: 500, httpFail: true }),
      tgt({ url: 'https://b.com', viewport: 'mobile', verdict: 'error' }),
    ];
    const report = buildReport({
      urls: ['https://a.com', 'https://b.com'],
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(report.terminal_state).toBe('BLOCKED_WITH_OWNER');
    expect(explanation.sentences.at(-1)).toBe(
      'Blocked: the pages that did not load or could not be checked need fixing first.',
    );
  });

  it('summarizes warnings in one sentence when nothing is worse', () => {
    const results = [
      tgt({ url: 'https://example.com', viewport: 'mobile', verdict: 'warn' }),
      tgt({ url: 'https://trashalert.io', viewport: 'mobile', verdict: 'pass' }),
    ];
    const report = buildReport({
      urls: ['https://example.com', 'https://trashalert.io'],
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.headline).toBe('2 pages checked. 2 are fine.');
    expect(explanation.sentences).toEqual([
      '1 page loaded with small warnings.',
      'Someone should open the report and look at the pictures.',
    ]);
  });

  it('says nothing was checked for an empty report', () => {
    const report = buildReport({
      urls: [],
      viewports: [],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [],
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.headline).toBe('Nothing was checked.');
    expect(explanation.sentences).toEqual(['Blocked: nothing was checked.']);
  });

  it('uses singular wording for one fine page', () => {
    const results = [tgt({ url: 'https://example.com', viewport: 'mobile', verdict: 'pass' })];
    const report = buildReport({
      urls: ['https://example.com'],
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.headline).toBe('1 page checked. It is fine.');
    expect(explanation.sentences).toEqual(['Safe to continue.']);
  });

  it('uses singular wording for one page with a problem', () => {
    const results = [tgt({ url: 'https://example.com', viewport: 'mobile', verdict: 'needs_baseline' })];
    const report = buildReport({
      urls: ['https://example.com'],
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.headline).toBe('1 page checked. It has a problem.');
    expect(explanation.sentences).toEqual([
      'example.com has no approved picture yet on every screen size.',
      'Someone should open the report and look at the pictures.',
    ]);
  });

  it('names a path URL by its host and path', () => {
    const results = [tgt({ url: 'https://trashalert.io/pricing', viewport: 'mobile', verdict: 'needs_baseline' })];
    const report = buildReport({
      urls: ['https://trashalert.io/pricing'],
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.sentences[0]).toBe('trashalert.io/pricing has no approved picture yet on every screen size.');
  });

  it('removes www and only says every screen size when all configured viewports match', () => {
    const report = buildReport({
      urls: ['https://www.example.com/pricing'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [
        tgt({ url: 'https://www.example.com/pricing', viewport: 'mobile', verdict: 'needs_baseline' }),
        tgt({ url: 'https://www.example.com/pricing', viewport: 'tablet', verdict: 'needs_baseline' }),
      ],
      lane,
    });

    expect(explainReport(report).sentences[0]).toBe(
      'example.com/pricing has no approved picture yet on phone and tablet.',
    );
  });

  it('uses a non-URL label from a compare report as-is', () => {
    const results = [tgt({ url: 'before.png', viewport: 'mobile', verdict: 'fail', diffPct: 20 })];
    const report = buildReport({
      urls: ['before.png'],
      viewports: [MOBILE, DESKTOP],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.sentences[0]).toBe('before.png looks different on phone (20% changed).');
  });

  it('caps at four problem sentences and stays under 90 words for ten broken sites', () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      tgt({ url: `https://site${i}.example`, viewport: 'mobile', verdict: 'needs_baseline' }),
    );
    const report = buildReport({
      urls: results.map((r) => r.url),
      viewports: [MOBILE],
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results,
      lane,
    });

    const explanation = explainReport(report);
    expect(explanation.headline).toBe('10 pages checked. 0 are fine.');
    expect(explanation.sentences).toEqual([
      'site0.example has no approved picture yet on every screen size.',
      'site1.example has no approved picture yet on every screen size.',
      'site2.example has no approved picture yet on every screen size.',
      'And 7 more problems.',
      'Someone should open the report and look at the pictures.',
    ]);
    const wordCount = explanation.text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(90);
  });
});

describe('speak', () => {
  it('passes the text as a single argv entry via spawn, never through a shell, on darwin', async () => {
    const calls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
    const fakeChild = {
      on(event: string, cb: (code: number) => void) {
        if (event === 'exit') {
          cb(0);
        }
        return fakeChild;
      },
    };
    const fakeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, args, opts });
      return fakeChild;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    await speak('hello world', {
      platform: 'darwin',
      existsSync: () => true,
      spawn: fakeSpawn,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('/usr/bin/say');
    expect(calls[0]!.args).toEqual(['hello world']);
    expect(calls[0]!.opts.shell).not.toBe(true);
  });

  it('never calls the spawner on linux', async () => {
    let called = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeSpawn = (() => {
      called = true;
      throw new Error('should not be called');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    await speak('hello', { platform: 'linux', spawn: fakeSpawn });
    expect(called).toBe(false);
  });
});
