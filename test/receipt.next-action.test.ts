import { describe, expect, it, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildReport } from '../src/report.js';
import { nextActionFor, receiptPathFor, writeReceipt } from '../src/receipt.js';
import { BaselineLane, TargetResult, ViewportSpec } from '../src/types.js';

const tmp = path.resolve('test-tmp-receipts-next-action');
const lane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };
const vps: ViewportSpec[] = [{ name: 'mobile', width: 390, height: 844 }];

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function passedTarget(): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    verdict: 'pass',
    pass: true,
    status: 200,
    diff_percentage: 0,
    screenshot: '/tmp/shot.png',
    baseline: '/tmp/base.png',
    diff_image: '/tmp/diff.png',
    console_errors: 0,
    load_time_ms: 100,
    reasons: [],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '0%', blocking: false },
    ],
  };
}

function needsBaselineTarget(): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    verdict: 'needs_baseline',
    pass: false,
    status: 200,
    diff_percentage: null,
    screenshot: '/tmp/shot.png',
    baseline: null,
    diff_image: null,
    console_errors: 0,
    load_time_ms: 100,
    reasons: ['no approved baseline'],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'skip', message: 'no baseline', blocking: false },
    ],
  };
}

function captureErrorTarget(): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    verdict: 'error',
    pass: false,
    status: 200,
    diff_percentage: null,
    screenshot: '/tmp/shot.png',
    baseline: '/tmp/base.png',
    diff_image: null,
    console_errors: 0,
    load_time_ms: 100,
    reasons: ['capture crashed'],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: 'n/a', blocking: false },
      { name: 'console_errors', mode: 'warn', status: 'error', message: 'capture crashed', blocking: false },
    ],
  };
}

function visualDiffTarget(): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    verdict: 'fail',
    pass: false,
    status: 200,
    diff_percentage: 12,
    screenshot: '/tmp/shot.png',
    baseline: '/tmp/base.png',
    diff_image: '/tmp/diff.png',
    console_errors: 0,
    load_time_ms: 100,
    reasons: ['visual diff exceeded threshold'],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'fail', message: '12%', blocking: true },
    ],
  };
}

function warningTarget(): TargetResult {
  return {
    url: 'https://example.com',
    viewport: 'mobile',
    verdict: 'warn',
    pass: true,
    status: 200,
    diff_percentage: 0,
    screenshot: '/tmp/shot.png',
    baseline: '/tmp/base.png',
    diff_image: '/tmp/diff.png',
    console_errors: 1,
    load_time_ms: 100,
    reasons: ['console error observed'],
    checks: [
      { name: 'http_status', mode: 'blocking', status: 'pass', message: 'HTTP 200', blocking: false },
      { name: 'pixel_diff', mode: 'blocking', status: 'pass', message: '0%', blocking: false },
      { name: 'console_errors', mode: 'warn', status: 'warn', message: '1 console error', blocking: false },
    ],
  };
}

function reportFor(results: TargetResult[]) {
  return buildReport({
    urls: ['https://example.com'],
    viewports: vps,
    pixelDiffThreshold: 5,
    loadTimeWarnMs: 3000,
    results,
    lane,
  });
}

describe('nextActionFor', () => {
  it('returns the unchanged SHIPPED_PROVEN sentence for a clean run', () => {
    const report = reportFor([passedTarget()]);
    expect(report.terminal_state).toBe('SHIPPED_PROVEN');
    expect(nextActionFor(report)).toBe(
      'Deploy gate passed with proof artifacts; safe to continue.',
    );
  });

  it('names the missing baseline and its count when nothing else is wrong', () => {
    const report = reportFor([needsBaselineTarget()]);
    const action = nextActionFor(report);
    expect(action).toMatch(/1 target\(s\) have no approved baseline/);
    expect(action).not.toMatch(/visual/);
    expect(action).not.toMatch(/warning/);
    expect(action).not.toMatch(/capture/);
  });

  it('names the capture error without claiming a visual diff', () => {
    const report = reportFor([captureErrorTarget()]);
    const action = nextActionFor(report);
    expect(action).toMatch(/1 target\(s\) failed to capture/);
    expect(action).not.toMatch(/visual/);
  });

  it('names the visual change and its count for a failed pixel diff', () => {
    const report = reportFor([visualDiffTarget()]);
    const action = nextActionFor(report);
    expect(action).toMatch(/1 target\(s\) changed visually/);
  });

  it('names warnings without ever printing a zero count', () => {
    const report = reportFor([warningTarget()]);
    const action = nextActionFor(report);
    expect(action).toMatch(/1 target\(s\) have warnings to review/);
    expect(action).not.toMatch(/0 target\(s\)/);
  });

  it('writes the specific next_action sentence into the receipt file', async () => {
    const report = reportFor([needsBaselineTarget()]);
    const receiptPath = path.join(tmp, 'latest.receipt.json');
    await writeReceipt({
      report,
      receiptPath,
      jsonPath: path.join(tmp, 'latest.json'),
      htmlPath: path.join(tmp, 'latest.html'),
    });

    const raw = await fs.readFile(receiptPath, 'utf8');
    const receipt = JSON.parse(raw);
    expect(receipt.next_action).toBe(nextActionFor(report));
    expect(receipt.next_action).toMatch(/1 target\(s\) have no approved baseline/);
  });
});
