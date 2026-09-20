/**
 * cli.exit-codes.test.ts
 *
 * Proves `visual-check compare` (the credential-free, network-free command)
 * is wired to the exit code contract in src/exit-codes.ts end-to-end: real
 * `dist/cli.js` child processes, real local Chromium captures against the
 * committed demo/fixtures/*.html pages — no network, no stored credentials.
 *
 * Exit code contract under test: pass/warn -> 0, fail -> 1,
 * needs_baseline -> 2, error -> 3, and --strict-warn remapping warn -> 1.
 * Global setup always rebuilds dist/ before test files run. Browser tests
 * always run in CI; locally they skip only when Chromium cannot launch.
 * Help tests always run and need no browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserReady, mustRunBrowserTests } from './helpers/browser-ready.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const builtCli = path.join(repoRoot, 'dist', 'cli.js');

let workRoot: string;
let warnFixturePath: string;

beforeAll(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cli-exit-codes-'));

  // A page that is visually identical to demo/fixtures/page.html (so the
  // pixel diff stays within threshold) but fires a console error, which
  // V1_CHECK_MODES marks 'warn' rather than blocking — the only way to
  // reach an overall "warn" verdict without a real visual regression.
  const baselineHtml = await fs.readFile(
    path.join(repoRoot, 'demo', 'fixtures', 'page.html'),
    'utf8',
  );
  const warnHtml = baselineHtml.replace(
    '</body>',
    '<script>console.error("synthetic-cli-exit-code-warn-fixture");</script></body>',
  );
  warnFixturePath = path.join(workRoot, 'warn-current.html');
  await fs.writeFile(warnFixturePath, warnHtml, 'utf8');
});

afterAll(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

function runCompare(args: string[], label: string) {
  const scenarioRoot = path.join(workRoot, label);
  const jsonPath = path.join(scenarioRoot, 'report.json');
  const res = spawnSync(
    process.execPath,
    [
      builtCli,
      'compare',
      '--viewports',
      'mobile',
      '--out',
      path.relative(repoRoot, scenarioRoot),
      '--json',
      path.relative(repoRoot, jsonPath),
      '--quiet',
      ...args,
    ],
    { cwd: repoRoot, encoding: 'utf8', timeout: 45_000 },
  );
  return { res, jsonPath };
}

async function readReport(jsonPath: string) {
  return JSON.parse(await fs.readFile(jsonPath, 'utf8'));
}

describe.skipIf(!browserReady && !mustRunBrowserTests)('visual-check compare — exit code contract', () => {
  it(
    'pass: identical baseline/current exits 0',
    async () => {
      const { res, jsonPath } = runCompare(
        [
          '--baseline',
          'demo/fixtures/page.html',
          '--current',
          'demo/fixtures/page.html',
        ],
        'pass',
      );
      expect(res.status, `stderr: ${res.stderr}`).toBe(0);
      const report = await readReport(jsonPath);
      expect(report.results[0].verdict).toBe('pass');
    },
    30_000,
  );

  it(
    'fail: a visual regression past threshold exits 1',
    async () => {
      const { res, jsonPath } = runCompare(
        [
          '--baseline',
          'demo/fixtures/page.html',
          '--current',
          'demo/fixtures/page-changed.html',
          '--threshold',
          '5',
        ],
        'fail',
      );
      expect(res.status, `stderr: ${res.stderr}`).toBe(1);
      const report = await readReport(jsonPath);
      expect(report.results[0].verdict).toBe('fail');
    },
    30_000,
  );

  it(
    'needs_baseline: an unreadable baseline exits 2',
    async () => {
      const { res, jsonPath } = runCompare(
        [
          '--baseline',
          'demo/fixtures/does-not-exist.html',
          '--current',
          'demo/fixtures/page.html',
        ],
        'needs-baseline',
      );
      expect(res.status, `stderr: ${res.stderr}`).toBe(2);
      const report = await readReport(jsonPath);
      expect(report.results[0].verdict).toBe('needs_baseline');
    },
    30_000,
  );

  it(
    'error: an unreadable current target (with a healthy baseline) exits 3',
    async () => {
      const { res, jsonPath } = runCompare(
        [
          '--baseline',
          'demo/fixtures/page.html',
          '--current',
          'demo/fixtures/does-not-exist.html',
        ],
        'error',
      );
      expect(res.status, `stderr: ${res.stderr}`).toBe(3);
      const report = await readReport(jsonPath);
      expect(report.results[0].verdict).toBe('error');
    },
    30_000,
  );

  it(
    'warn: a console-error-only target exits 0 by default',
    async () => {
      const { res, jsonPath } = runCompare(
        [
          '--baseline',
          'demo/fixtures/page.html',
          '--current',
          warnFixturePath,
        ],
        'warn-default',
      );
      expect(res.status, `stderr: ${res.stderr}`).toBe(0);
      const report = await readReport(jsonPath);
      expect(report.results[0].verdict).toBe('warn');
    },
    30_000,
  );

  it(
    '--strict-warn: the same console-error-only target exits 1',
    async () => {
      const { res, jsonPath } = runCompare(
        [
          '--baseline',
          'demo/fixtures/page.html',
          '--current',
          warnFixturePath,
          '--strict-warn',
        ],
        'warn-strict',
      );
      expect(res.status, `stderr: ${res.stderr}`).toBe(1);
      const report = await readReport(jsonPath);
      expect(report.results[0].verdict).toBe('warn');
    },
    30_000,
  );
});

describe('visual-check --help', () => {
  it('documents --strict-warn and the exit code contract', () => {
    const res = spawnSync(process.execPath, [builtCli, '--help'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('Exit codes');
    expect(res.stdout).toMatch(/0\s+success/);
    expect(res.stdout).toMatch(/1\s+failure/);
    expect(res.stdout).toMatch(/2\s+needs_baseline/);
    expect(res.stdout).toMatch(/3\s+error/);
    expect(res.stdout).toContain('--strict-warn');
  });

  it('documents --strict-warn on both `run --help` and `compare --help`', () => {
    for (const cmd of ['run', 'compare']) {
      const res = spawnSync(process.execPath, [builtCli, cmd, '--help'], {
        encoding: 'utf-8',
        timeout: 5_000,
      });
      expect(res.status, `${cmd} --help stderr: ${res.stderr}`).toBe(0);
      expect(res.stdout, `${cmd} --help should document --strict-warn`).toContain(
        '--strict-warn',
      );
    }
  });
});
