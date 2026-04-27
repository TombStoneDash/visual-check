import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildTelegramMessage, sendTelegramAlert } from '../src/alerts.js';
import { BaselineLane, RunReport, TargetResult } from '../src/types.js';

const BOT_TOKEN = '123:ABC';
const CHAT_ID = '42';

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = CHAT_ID;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lane: BaselineLane = { browser: 'chromium', os: 'windows', runner: 'lenovo-local' };

function makeTarget(over: Partial<TargetResult>): TargetResult {
  return {
    url: 'https://trashalert.io',
    viewport: 'mobile',
    verdict: 'fail',
    pass: false,
    status: 200,
    diff_percentage: 12.5,
    screenshot: 's',
    baseline: 'b',
    diff_image: 'd',
    console_errors: 0,
    load_time_ms: 1200,
    reasons: ['pixel_diff: 12.5% > 5%'],
    checks: [],
    ...over,
  };
}

function makeRun(over: Partial<RunReport> = {}, results: TargetResult[] = []): RunReport {
  return {
    schema_version: 1,
    timestamp: '2026-04-22T00:00:00.000Z',
    run_id: 'vc_alert',
    projectId: 'trashalert',
    deploymentUrl: 'https://preview.vercel.app',
    branch: 'main',
    commitSha: 'abcdef0123456789',
    config: {
      urls: ['https://trashalert.io'],
      viewports: ['mobile'],
      pixel_diff_threshold: 5,
      load_time_warn_ms: 3000,
      lane,
    },
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.verdict === 'pass').length,
      failed: results.filter((r) => r.verdict === 'fail').length,
      warnings: results.filter((r) => r.verdict === 'warn').length,
      errors: results.filter((r) => r.verdict === 'error').length,
      needs_baseline: results.filter((r) => r.verdict === 'needs_baseline').length,
    },
    pass: results.every((r) => r.verdict === 'pass' || r.verdict === 'warn'),
    ...over,
  };
}

describe('buildTelegramMessage', () => {
  it('uses the fail emoji when at least one target failed', () => {
    const msg = buildTelegramMessage(
      makeRun({}, [makeTarget({ verdict: 'fail' })]),
      'https://signed.example/r.html',
    );
    expect(msg).toContain('❌');
    expect(msg).toContain('Visual Check FAIL');
    expect(msg).toContain('trashalert');
  });

  it('includes deployment URL, branch, and commit metadata', () => {
    const msg = buildTelegramMessage(
      makeRun({}, [makeTarget({ verdict: 'fail' })]),
      'https://signed.example/r.html',
    );
    expect(msg).toContain('Deploy: https://preview.vercel.app');
    expect(msg).toContain('Branch:');
    expect(msg).toContain('abcdef0'); // 7-char short sha
  });

  it('lists failing targets and truncates at 10', () => {
    const targets: TargetResult[] = [];
    for (let i = 0; i < 15; i++) {
      targets.push(
        makeTarget({
          url: `https://t.example/${i}`,
          viewport: 'mobile',
          verdict: 'fail',
        }),
      );
    }
    const msg = buildTelegramMessage(makeRun({}, targets), 'https://signed.example/r.html');
    expect(msg).toContain('<b>Failing:</b>');
    // Each target line starts with •. Expect 10 bullets, not 15.
    const bulletCount = (msg.match(/•/g) ?? []).length;
    expect(bulletCount).toBe(10);
  });

  it('omits the overflow line when failing count is at or under the cap', () => {
    const targets = [0, 1, 2].map((i) =>
      makeTarget({ url: `https://t.example/${i}`, verdict: 'fail' }),
    );
    const msg = buildTelegramMessage(makeRun({}, targets), 'https://signed.example/r.html');
    const bulletCount = (msg.match(/•/g) ?? []).length;
    expect(bulletCount).toBe(3);
    expect(msg).not.toContain('and ');
    expect(msg).not.toContain('more in the HTML report');
  });

  it('appends "...and N more in the HTML report" when over the cap', () => {
    const targets: TargetResult[] = [];
    for (let i = 0; i < 15; i++) {
      targets.push(
        makeTarget({ url: `https://t.example/${i}`, verdict: 'fail' }),
      );
    }
    const msg = buildTelegramMessage(makeRun({}, targets), 'https://signed.example/r.html');
    expect(msg).toContain('…and 5 more in the HTML report');
  });

  it('escapes HTML in URLs and project ids', () => {
    const msg = buildTelegramMessage(
      makeRun({ projectId: 'ta<script>' }, [
        makeTarget({ url: 'https://x.io/<img>', verdict: 'fail' }),
      ]),
      'https://signed.example/r.html',
    );
    expect(msg).not.toContain('<script>');
    expect(msg).not.toContain('<img>');
    expect(msg).toContain('&lt;script&gt;');
  });

  it('always includes the signed URL at the end', () => {
    const msg = buildTelegramMessage(
      makeRun({}, [makeTarget({ verdict: 'fail' })]),
      'https://signed.example/r.html',
    );
    expect(msg).toContain('<a href="https://signed.example/r.html">Open HTML report</a>');
  });
});

describe('sendTelegramAlert', () => {
  it('POSTs to api.telegram.org with the chat id and HTML parse mode', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response;
    }) as typeof fetch;
    vi.stubGlobal('fetch', fn);

    await sendTelegramAlert(
      makeRun({}, [makeTarget({ verdict: 'fail' })]),
      'https://signed.example/r.html',
    );
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    const body = JSON.parse((calls[0]!.init.body as string) ?? '{}');
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.parse_mode).toBe('HTML');
    expect(body.disable_web_page_preview).toBe(true);
    expect(body.text).toContain('Visual Check FAIL');
    expect(body.text).toContain('https://signed.example/r.html');
  });

  it('throws when Telegram rejects the call', async () => {
    const fn = (async () =>
      ({ ok: false, status: 400, text: async () => 'bad request', json: async () => ({}) } as unknown as Response)) as typeof fetch;
    vi.stubGlobal('fetch', fn);
    await expect(
      sendTelegramAlert(makeRun({}, [makeTarget({ verdict: 'fail' })]), 'https://x'),
    ).rejects.toThrow(/Telegram/);
  });
});
