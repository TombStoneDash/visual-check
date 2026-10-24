/**
 * Large stdout output must survive `process.exit` when stdout is a pipe.
 *
 * On macOS and Windows Node writes to pipes asynchronously, so a bare
 * `process.exit()` after a big write cut `run --quiet` JSON (and long
 * `--dry-run` / `config-targets` output) off at 64 KiB for anyone piping the
 * CLI into another program. Each case pipes into a reader that waits before
 * reading, so the pipe is full when the CLI decides to exit.
 *
 * Needs dist/ (built by test/global-setup.ts) and a POSIX shell; no browser.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtCli = path.join(repoRoot, 'dist', 'cli.js');
const builtStdout = pathToFileURL(path.join(repoRoot, 'dist', 'stdout.js')).href;
const posix = process.platform !== 'win32';

/** Run `command` with stdout piped into a reader that sleeps first, and return what it counted. */
function throughSlowReader(command: string, counter: string, env: Record<string, string>): string {
  const res = spawnSync('sh', ['-c', `${command} | (sleep 3; ${counter})`], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout.trim();
}

describe.runIf(posix)('stdout is fully flushed before the CLI exits', () => {
  it('exitAfterStdout delivers a 1 MB write through a slow pipe', () => {
    const script = [
      `import { exitAfterStdout } from ${JSON.stringify(builtStdout)};`,
      `process.stdout.write('x'.repeat(1_000_000));`,
      `await exitAfterStdout(0);`,
    ].join('\n');
    const count = throughSlowReader(
      `"$NODE_BIN" --input-type=module -e "$SCRIPT"`,
      'wc -c',
      { NODE_BIN: process.execPath, SCRIPT: script },
    );
    expect(Number(count)).toBe(1_000_000);
  }, 30_000);

  it('run --dry-run prints every target line when piped (>64 KiB of output)', () => {
    const urls = Array.from({ length: 2000 }, (_, i) => `https://host-${i}.example.com/page`);
    const count = throughSlowReader(
      `"$NODE_BIN" "$CLI" run --dry-run --urls "$URLS"`,
      'wc -l',
      { NODE_BIN: process.execPath, CLI: builtCli, URLS: urls.join(',') },
    );
    // One header line plus url × (mobile, tablet, desktop).
    expect(Number(count)).toBe(1 + urls.length * 3);
  }, 30_000);
});
