import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertApprovableReport,
  parseApproveSelection,
  runApprove,
} from '../src/commands/approve.js';
import { urlToSlug } from '../src/capture.js';
import type { CheckResult, RunReport, TargetResult, Verdict } from '../src/types.js';

const PNG_A = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('A')]);
const PNG_B = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('B')]);
const FIXED_NOW = () => new Date('2026-10-24T12:00:00.000Z');

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-approve-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function check(name: CheckResult['name'], status: CheckResult['status']): CheckResult {
  return { name, mode: 'blocking', status, message: `${name} ${status}`, blocking: true };
}

async function target(
  url: string,
  viewport: string,
  verdict: Verdict,
  opts: { png?: Buffer | null; checks?: CheckResult[] } = {},
): Promise<TargetResult> {
  const screenshot = path.join(root, 'captures', '2026-10-24', 'ts', urlToSlug(url), `${viewport}.png`);
  if (opts.png !== null) {
    await fs.mkdir(path.dirname(screenshot), { recursive: true });
    await fs.writeFile(screenshot, opts.png ?? PNG_A);
  }
  return {
    url,
    viewport,
    verdict,
    pass: verdict === 'pass' || verdict === 'warn',
    status: 200,
    diff_percentage: null,
    screenshot,
    baseline: null,
    diff_image: null,
    console_errors: 0,
    load_time_ms: 100,
    reasons: [],
    checks: opts.checks ?? [check('http_status', 'pass')],
  };
}

function report(results: TargetResult[]): RunReport {
  return { schema_version: 1, run_id: 'run_test', results } as unknown as RunReport;
}

function baselinePath(url: string, viewport: string): string {
  return path.join(root, 'baselines', urlToSlug(url), `${viewport}.png`);
}

describe('runApprove', () => {
  it('copies the reviewed needs_baseline screenshot itself and logs the approval', async () => {
    const t = await target('https://a.test', 'mobile', 'needs_baseline', { png: PNG_B });
    const res = await runApprove({ report: report([t]), root, approvedBy: 'hudson', now: FIXED_NOW });

    expect(res.skipped).toEqual([]);
    expect(res.approved).toHaveLength(1);
    const dest = baselinePath('https://a.test', 'mobile');
    expect(await fs.readFile(dest)).toEqual(PNG_B);
    expect(res.approved[0]!.sha256).toBe(createHash('sha256').update(PNG_B).digest('hex'));

    const lines = (await fs.readFile(path.join(root, 'baselines', 'approvals.jsonl'), 'utf-8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      approved_at: '2026-10-24T12:00:00.000Z',
      approved_by: 'hudson',
      run_id: 'run_test',
      url: 'https://a.test',
      viewport: 'mobile',
      verdict: 'needs_baseline',
      baseline: dest,
      previous: null,
    });
  });

  it('never copies pass, warn or error targets, and needs --accept-fail for fail', async () => {
    const results = [
      await target('https://a.test', 'mobile', 'pass'),
      await target('https://a.test', 'tablet', 'warn'),
      await target('https://a.test', 'desktop', 'error'),
      await target('https://b.test', 'mobile', 'fail', { checks: [check('pixel_diff', 'fail')] }),
    ];
    const res = await runApprove({ report: report(results), root });

    expect(res.approved).toEqual([]);
    expect(res.log).toBeNull();
    expect(res.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining('already matches'),
      expect.stringContaining('already matches'),
      expect.stringContaining('did not complete'),
      expect.stringContaining('--accept-fail'),
    ]);
    await expect(fs.access(path.join(root, 'baselines'))).rejects.toThrow();
  });

  it('with --accept-fail re-baselines a pixel-diff fail and moves the old baseline to history', async () => {
    const url = 'https://a.test';
    const dest = baselinePath(url, 'desktop');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, PNG_A);
    const t = await target(url, 'desktop', 'fail', {
      png: PNG_B,
      checks: [check('http_status', 'pass'), check('pixel_diff', 'fail')],
    });

    const res = await runApprove({ report: report([t]), root, acceptFail: true, now: FIXED_NOW });

    expect(res.approved).toHaveLength(1);
    expect(await fs.readFile(dest)).toEqual(PNG_B);
    const previous = res.approved[0]!.previous!;
    expect(previous).toBe(
      path.join(root, 'baselines', '.history', urlToSlug(url), 'desktop.2026-10-24T12-00-00-000Z.png'),
    );
    expect(await fs.readFile(previous)).toEqual(PNG_A);
  });

  it('never overwrites an older history file', async () => {
    const url = 'https://a.test';
    const dest = baselinePath(url, 'desktop');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, PNG_A);
    const older = path.join(root, 'baselines', '.history', urlToSlug(url), 'desktop.2026-10-24T12-00-00-000Z.png');
    await fs.mkdir(path.dirname(older), { recursive: true });
    await fs.writeFile(older, Buffer.from('older'));
    const t = await target(url, 'desktop', 'fail', { png: PNG_B, checks: [check('pixel_diff', 'fail')] });

    const res = await runApprove({ report: report([t]), root, acceptFail: true, now: FIXED_NOW });

    expect(res.approved[0]!.previous).toBe(older.replace(/\.png$/, '-1.png'));
    expect(await fs.readFile(older, 'utf-8')).toBe('older');
  });

  it('refuses to re-baseline a fail caused by anything other than the pixel diff', async () => {
    const t = await target('https://a.test', 'mobile', 'fail', {
      checks: [check('http_status', 'fail'), check('pixel_diff', 'fail')],
    });
    const res = await runApprove({ report: report([t]), root, acceptFail: true });
    expect(res.approved).toEqual([]);
    expect(res.skipped[0]!.reason).toContain('http_status');
  });

  it('skips a needs_baseline target whose baseline appeared after the run', async () => {
    const dest = baselinePath('https://a.test', 'mobile');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, PNG_A);
    const t = await target('https://a.test', 'mobile', 'needs_baseline', { png: PNG_B });

    const res = await runApprove({ report: report([t]), root });

    expect(res.approved).toEqual([]);
    expect(res.skipped[0]!.reason).toContain('re-run');
    expect(await fs.readFile(dest)).toEqual(PNG_A);
  });

  it('skips missing or non-PNG screenshots', async () => {
    const missing = await target('https://a.test', 'mobile', 'needs_baseline', { png: null });
    const notPng = await target('https://a.test', 'tablet', 'needs_baseline', { png: Buffer.from('<html>') });
    const res = await runApprove({ report: report([missing, notPng]), root });
    expect(res.approved).toEqual([]);
    expect(res.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining('file not found'),
      expect.stringContaining('not a PNG'),
    ]);
  });

  it('refuses viewport names that would escape the baseline folder', async () => {
    const t = await target('https://a.test', 'mobile', 'needs_baseline');
    const res = await runApprove({ report: report([{ ...t, viewport: '../../evil' }]), root });
    expect(res.approved).toEqual([]);
    expect(res.skipped[0]!.reason).toContain('not a safe file name');
  });

  it('approves only the selected targets and rejects selections not in the report', async () => {
    const results = [
      await target('https://a.test', 'mobile', 'needs_baseline'),
      await target('https://a.test', 'desktop', 'needs_baseline'),
    ];
    const res = await runApprove({
      report: report(results),
      root,
      selected: [{ url: 'https://a.test', viewport: 'desktop' }],
    });
    expect(res.approved.map((a) => a.viewport)).toEqual(['desktop']);
    await expect(fs.access(baselinePath('https://a.test', 'mobile'))).rejects.toThrow();

    await expect(
      runApprove({ report: report(results), root, selected: [{ url: 'https://a.test', viewport: 'dekstop' }] }),
    ).rejects.toThrow(/not in the report: https:\/\/a\.test@dekstop/);
  });

  it('dry run reports what it would do and writes nothing', async () => {
    const t = await target('https://a.test', 'mobile', 'needs_baseline');
    const res = await runApprove({ report: report([t]), root, dryRun: true });
    expect(res.approved).toHaveLength(1);
    expect(res.log).toBeNull();
    await expect(fs.access(path.join(root, 'baselines'))).rejects.toThrow();
  });
});

describe('parseApproveSelection / assertApprovableReport', () => {
  it('splits on the last @ so URLs with @ keep working', () => {
    expect(parseApproveSelection('https://u@a.test/x@mobile, https://b.test@1280x720')).toEqual([
      { url: 'https://u@a.test/x', viewport: 'mobile' },
      { url: 'https://b.test', viewport: '1280x720' },
    ]);
  });

  it.each(['', ',', 'https://a.test', 'https://a.test@', '@mobile'])('rejects %j', (raw) => {
    expect(() => parseApproveSelection(raw)).toThrow(/--select/);
  });

  it.each([null, {}, { schema_version: 2, results: [] }, { schema_version: 1, results: [{ url: 'x' }] }])(
    'rejects a non-report %j',
    (value) => {
      expect(() => assertApprovableReport(value, 'r.json')).toThrow(/not a Visual Check report/);
    },
  );
});

describe('visual-check approve (built CLI)', () => {
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const cli = path.join(repoRoot, 'dist/cli.js');
  const run = (args: string[]) =>
    spawnSync(process.execPath, [cli, 'approve', ...args], { cwd: root, encoding: 'utf8', timeout: 15_000 });

  it('exits 0 after approving and 1 when nothing was approvable', async () => {
    const t = await target('https://a.test', 'mobile', 'needs_baseline');
    const reportPath = path.join(root, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(report([t])));

    const first = run(['--report', reportPath, '--out', root]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('1 approved, 0 skipped');

    const second = run(['--report', reportPath, '--out', root]);
    expect(second.status, second.stderr).toBe(1);
    expect(second.stdout).toContain('0 approved, 1 skipped');
  });

  it('exits 3 for a missing or malformed report', async () => {
    const missing = run(['--report', path.join(root, 'nope.json')]);
    expect(missing.status).toBe(3);
    expect(missing.stderr).toContain('does not exist');

    const bad = path.join(root, 'bad.json');
    await fs.writeFile(bad, JSON.stringify({ schema_version: 1 }));
    const malformed = run(['--report', bad]);
    expect(malformed.status).toBe(3);
    expect(malformed.stderr).toContain('not a Visual Check report');
  });
});
