import { describe, it, expect } from 'vitest';
import { buildTelegramMessage, shorten } from '../src/alerts.js';
import { RunReport, TargetResult } from '../src/types.js';

/** True when every high surrogate is followed by a low one and vice versa. */
function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function target(url: string, reason: string): TargetResult {
  return {
    url,
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
    reasons: [reason],
    checks: [],
  };
}

function run(results: TargetResult[], deploymentUrl: string): RunReport {
  return {
    schema_version: 1,
    timestamp: '2026-10-24T00:00:00.000Z',
    run_id: 'vc_unicode',
    projectId: 'trashalert',
    deploymentUrl,
    config: {
      urls: results.map((r) => r.url),
      viewports: ['mobile'],
      pixel_diff_threshold: 5,
      load_time_warn_ms: 3000,
      lane: { browser: 'chromium', os: 'linux', runner: 'github-actions' },
    },
    results,
    summary: { total: results.length, passed: 0, failed: results.length, warnings: 0, errors: 0, needs_baseline: 0 },
    assertions: [],
    terminal_state: 'READY_TO_REVIEW',
    pass: false,
  } as RunReport;
}

describe('shorten', () => {
  it('leaves short strings alone', () => {
    expect(shorten('abc', 5)).toBe('abc');
    expect(shorten('a🎉', 3)).toBe('a🎉');
  });

  it('cuts plain text to maxChars including the ellipsis', () => {
    const out = shorten('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(out.length).toBe(5);
  });

  it('drops a whole emoji instead of keeping half of it', () => {
    // 'abc' + 🎉 (2 UTF-16 units) + 'xyz': a naive slice(0, 4) keeps the high surrogate.
    const out = shorten('abc🎉xyz', 5);
    expect(out).toBe('abc…');
    expect(isWellFormed(out)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it('keeps an emoji that fits entirely', () => {
    expect(shorten('ab🎉xyz', 5)).toBe('ab🎉…');
  });

  it('never returns a lone surrogate at any cut point', () => {
    const input = '🎉'.repeat(20) + 'tail';
    for (let max = 2; max < input.length; max++) {
      const out = shorten(input, max);
      expect(isWellFormed(out)).toBe(true);
      expect(out.length).toBeLessThanOrEqual(max);
    }
  });
});

describe('buildTelegramMessage with astral characters', () => {
  it('produces well-formed text when a long URL, reason and deploy URL are cut mid-emoji', () => {
    // Shorten limits: URL 120, reason 160, deploy URL 120. Put an emoji astride each cut.
    const url = 'https://example.com/' + 'a'.repeat(98) + '🎉' + 'b'.repeat(20);
    const reason = 'pixel_diff: ' + 'r'.repeat(146) + '🚀' + 'more';
    const deployUrl = 'https://preview.example/' + 'd'.repeat(94) + '🔥' + 'x'.repeat(10);
    const msg = buildTelegramMessage(run([target(url, reason)], deployUrl), 'https://signed.example/r.html');
    expect(isWellFormed(msg)).toBe(true);
    // The payload Telegram receives must survive a UTF-8 round trip unchanged.
    const body = JSON.stringify({ text: msg });
    expect(new TextDecoder().decode(new TextEncoder().encode(body))).toBe(body);
    expect(Buffer.from(msg, 'utf8').toString('utf8')).toBe(msg);
  });
});
