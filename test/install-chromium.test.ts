import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/install-chromium.sh', import.meta.url));
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

let dir: string;

/** Put a fake `npx` first on PATH that fails `failures` times, then succeeds. */
function fakeNpx(failures: number, hang = false): NodeJS.ProcessEnv {
  const counter = path.join(dir, 'count');
  writeFileSync(counter, '0');
  writeFileSync(
    path.join(dir, 'npx'),
    `#!/usr/bin/env bash
n=$(( $(cat "${counter}") + 1 )); echo "$n" > "${counter}"
echo "npx $*" >> "${dir}/calls"
if [ "$n" -le ${failures} ]; then ${hang ? 'exec sleep 30' : 'exit 1'}; fi
exit 0
`,
  );
  chmodSync(path.join(dir, 'npx'), 0o755);
  return {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    PW_INSTALL_RETRY_SLEEP_S: '0',
  };
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [script], { env, encoding: 'utf8', timeout: 20_000 });
}

const calls = () => readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n');

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'vc-install-chromium-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scripts/install-chromium.sh', () => {
  it('installs chromium with system deps in one attempt when it works', () => {
    const r = run(fakeNpx(0));
    expect(r.status).toBe(0);
    expect(calls()).toEqual(['npx --no-install playwright install --with-deps chromium']);
  });

  it('retries a failed attempt and succeeds', () => {
    const r = run(fakeNpx(2));
    expect(r.status).toBe(0);
    expect(calls()).toHaveLength(3);
    expect(r.stderr).toContain('attempt 1/3 failed');
    expect(r.stderr).toContain('attempt 2/3 failed');
  });

  it('gives up with exit 1 after the configured attempts', () => {
    const r = run({ ...fakeNpx(99), PW_INSTALL_ATTEMPTS: '2' });
    expect(r.status).toBe(1);
    expect(calls()).toHaveLength(2);
    expect(r.stderr).toContain('::error::playwright install failed after 2 attempt(s)');
  });

  it('ignores a non-numeric attempt count', () => {
    const r = run({ ...fakeNpx(99), PW_INSTALL_ATTEMPTS: 'lots' });
    expect(r.status).toBe(1);
    expect(calls()).toHaveLength(3);
  });

  const hasTimeout = spawnSync('bash', ['-c', 'command -v timeout']).status === 0;
  it.skipIf(!hasTimeout)('kills a hung attempt at the deadline and retries', () => {
    const started = Date.now();
    const r = run({ ...fakeNpx(1, true), PW_INSTALL_TIMEOUT_S: '1' });
    expect(r.status).toBe(0);
    expect(calls()).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('is what CI, the manual workflow and the action use to install Chromium', () => {
    for (const file of ['.github/workflows/ci.yml', '.github/workflows/visual-check.yml', 'action.yml']) {
      const text = read(file);
      expect(text, file).toContain('bash scripts/install-chromium.sh');
      expect(text, file).not.toMatch(/npx playwright install --with-deps/);
    }
  });
});
