import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTelegramMessage, sendTelegramAlert, TELEGRAM_MAX_CHARS } from '../src/alerts.js';
import type { RunReport, TargetResult } from '../src/types.js';

function makeRun(count: number, long = false): RunReport {
  const results: TargetResult[] = Array.from({ length: count }, (_, i) => ({
    url: long ? `https://preview.example/path/${i}/`.padEnd(600, 'x') : 'https://example.com/page',
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
    reasons: [long ? '&'.repeat(600) : 'pixel_diff: 12.5% > 5%'],
    checks: [],
  }));
  return {
    schema_version: 1,
    timestamp: '2026-09-20T00:00:00.000Z',
    run_id: 'length-test',
    projectId: 'visual-check',
    deploymentUrl: 'https://preview.example',
    branch: 'main',
    commitSha: 'abcdef0123456789',
    config: {
      urls: results.map((r) => r.url),
      viewports: ['mobile'],
      pixel_diff_threshold: 5,
      load_time_warn_ms: 3000,
      lane: { browser: 'chromium', os: 'windows', runner: 'lenovo-local' },
    },
    results,
    summary: { total: count, passed: 0, warnings: 0, failed: count, errors: 0, needs_baseline: 0 },
    pass: false,
  };
}

const reportUrl = 'https://signed.example/report.html';
const link = `<a href="${reportUrl}">Open HTML report</a>`;

function checkOverflow(message: string, total: number): number {
  const shown = message.split('\n').filter((line) => line.startsWith('• ')).length;
  expect(shown).toBeLessThan(total);
  expect(message).toContain(`…and ${total - shown} more in the HTML report`);
  expect(message.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
  return shown;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Telegram character budget', () => {
  it('bounds long targets after HTML escaping and drops only the last lines', async () => {
    const run = makeRun(10, true);
    const message = buildTelegramMessage(run, reportUrl);
    expect(TELEGRAM_MAX_CHARS).toBe(4000);
    const shown = checkOverflow(message, 10);
    expect(shown).toBeGreaterThan(0);
    expect(message.endsWith(link)).toBe(true);
    expect(message).toContain('<b>Visual Check FAIL</b>');
    expect(message).toContain('Targets: 10 · ✅ 0 · ⚠️ 0 · ❌ 10 · 🔥 0 · 📸 0');
    for (let i = 0; i < shown; i++) {
      expect(message).toContain(`<code>${run.results[i]!.url.slice(0, 119)}…</code>`);
    }
    expect(message).not.toContain(`https://preview.example/path/${shown}/`);
    expect(message).toContain(` — ${'&amp;'.repeat(159)}…`);

    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '42');
    const fetchStub = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchStub);
    await sendTelegramAlert(run, reportUrl);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const request = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string).text).toBe(message);
  });

  it('leaves a short run byte-for-byte unchanged', () => {
    expect(buildTelegramMessage(makeRun(1), reportUrl)).toBe(
      '❌ <b>Visual Check FAIL</b> — <code>visual-check</code>\n' +
      'Deploy: https://preview.example\n' +
      'Branch: <code>main</code>\n' +
      'Commit: <code>abcdef0</code>\n' +
      'Targets: 1 · ✅ 0 · ⚠️ 0 · ❌ 1 · 🔥 0 · 📸 0\n\n' +
      '<b>Failing:</b>\n' +
      '• <code>https://example.com/page</code> @ mobile — pixel_diff: 12.5% &gt; 5%\n\n' + link,
    );
  });

  it('escapes all HTML attribute metacharacters in the signed report link', () => {
    const message = buildTelegramMessage(makeRun(1), 'https://signed.example/?a="<x>"&b=2');
    expect(message.endsWith(
      '<a href="https://signed.example/?a=&quot;&lt;x&gt;&quot;&amp;b=2">Open HTML report</a>',
    )).toBe(true);
  });

  it('counts both the ten-target cap and length-based omissions', () => {
    const message = buildTelegramMessage(makeRun(15, true), reportUrl);
    expect(checkOverflow(message, 15)).toBeLessThan(10);
  });

  it('keeps a line at exactly 4000 characters and drops it one character over', () => {
    const run = makeRun(1);
    const padding = TELEGRAM_MAX_CHARS - buildTelegramMessage(run, reportUrl).length;
    const exactUrl = reportUrl + 'x'.repeat(padding);
    const exact = buildTelegramMessage(run, exactUrl);
    expect(exact.length).toBe(TELEGRAM_MAX_CHARS);
    expect(exact).toContain('• <code>');
    expect(checkOverflow(buildTelegramMessage(run, exactUrl + 'x'), 1)).toBe(0);
  });

  it('keeps a truthful overflow line even when every failing line is dropped', () => {
    const longReportUrl = reportUrl + '?token=' + 'x'.repeat(3400);
    const message = buildTelegramMessage(makeRun(10, true), longReportUrl);
    expect(checkOverflow(message, 10)).toBe(0);
    expect(message.endsWith(`<a href="${longReportUrl}">Open HTML report</a>`)).toBe(true);
  });

  it('shortens a deployment URL without changing the report destination', () => {
    const run = makeRun(1);
    run.deploymentUrl = 'https://preview.example/path/'.padEnd(600, 'x');
    expect(buildTelegramMessage(run, reportUrl)).toContain(`Deploy: ${run.deploymentUrl.slice(0, 119)}…\n`);
  });

  it('rejects an irreducible fixed section instead of returning an oversized payload', () => {
    expect(() => buildTelegramMessage(makeRun(0), reportUrl + 'x'.repeat(4000)))
      .toThrow(/exceed the character budget/);
  });
});
