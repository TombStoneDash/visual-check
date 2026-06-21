import { describe, expect, it, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildReport } from '../src/report.js';
import { receiptPathFor, writeReceipt } from '../src/receipt.js';
import { BaselineLane, TargetResult, ViewportSpec } from '../src/types.js';

const tmp = path.resolve('test-tmp-receipts');
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

describe('receipt writer', () => {
  it('places receipts adjacent to JSON reports by default', () => {
    expect(path.normalize(receiptPathFor('reports/latest.json'))).toBe(
      path.normalize('reports/latest.receipt.json'),
    );
  });

  it('writes terminal state, assertions, artifacts, and next action', async () => {
    const report = buildReport({
      urls: ['https://example.com'],
      viewports: vps,
      pixelDiffThreshold: 5,
      loadTimeWarnMs: 3000,
      results: [passedTarget()],
      lane,
    });
    const receiptPath = path.join(tmp, 'latest.receipt.json');
    await writeReceipt({
      report,
      receiptPath,
      jsonPath: path.join(tmp, 'latest.json'),
      htmlPath: path.join(tmp, 'latest.html'),
    });

    const raw = await fs.readFile(receiptPath, 'utf8');
    const receipt = JSON.parse(raw);
    expect(receipt.run_id).toBe(report.run_id);
    expect(receipt.terminal_state).toBe('SHIPPED_PROVEN');
    expect(receipt.assertions).toHaveLength(5);
    expect(receipt.artifacts.receipt).toBe(path.resolve(receiptPath));
    expect(receipt.artifacts.json).toBe(path.resolve(tmp, 'latest.json'));
    expect(receipt.context.urls).toEqual(['https://example.com']);
    expect(receipt.next_action).toMatch(/safe to continue/);
  });
});
