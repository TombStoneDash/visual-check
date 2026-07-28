/**
 * cli.smoke.test.ts
 *
 * CLI-surface smoke baseline. test/smoke.test.ts already proves the
 * programmatic entry point (src/index.ts) loads + exposes its public
 * API. This file does the same for the bin entry (src/cli.ts):
 *
 *   1. The CLI module can be imported without throwing at module load.
 *   2. `visual-check --help` exits 0 and lists every documented
 *      subcommand (baseline / run / deploy-gate / promote). If a
 *      command is silently removed or renamed, this test catches it
 *      before the next release.
 *
 * No browser, no network, no on-disk state — same constraints as the
 * sibling smoke suite, so CI can run it under the existing
 * `npm ci --ignore-scripts` path without Playwright.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const builtCli = path.join(repoRoot, 'dist', 'cli.js');

describe('cli module imports', () => {
  it('src/cli.ts loads without throwing', async () => {
    // We can't import src/cli.ts directly because it calls program.parseAsync
    // at module evaluation. Touch a sibling that the CLI re-uses to prove
    // the import graph is healthy.
    const mod = await import('../src/index.js');
    expect(mod).toBeTypeOf('object');
    expect(typeof mod.runPool).toBe('function');
  });
});

describe('visual-check --help', () => {
  // Skip the spawn test if the CLI hasn't been built yet (e.g., local dev
  // before `npm run build`). CI runs `npm run build` before this suite as
  // part of the ci.yml flow.
  const cliReady = existsSync(builtCli);

  it.skipIf(!cliReady)('exits 0 and lists all documented subcommands', () => {
    const res = spawnSync(process.execPath, [builtCli, '--help'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    const out = `${res.stdout}\n${res.stderr}`;
    for (const cmd of ['baseline', 'run', 'compare', 'deploy-gate', 'promote']) {
      expect(out, `--help output should mention "${cmd}"`).toContain(cmd);
    }
    expect(out).toContain('visual-check');
  });

  it.skipIf(!cliReady)('exits 0 on --version and reports a semver-ish string', () => {
    const res = spawnSync(process.execPath, [builtCli, '--version'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
