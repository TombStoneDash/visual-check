import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const builtCli = path.join(repoRoot, 'dist/cli.js');

beforeAll(() => {
  if (!existsSync(builtCli)) {
    const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc'], {
      cwd: repoRoot, encoding: 'utf8', timeout: 60_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }
}, 60_000);

function run(args: string[]) {
  const result = spawnSync(process.execPath, [builtCli, ...args], {
    cwd: repoRoot, encoding: 'utf8', timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe('CLI usage exit codes without a browser', () => {
  it.each([
    { args: [], message: 'Usage:' },
    { args: ['run'], message: '--urls' },
    { args: ['nope'], message: 'unknown command' },
    { args: ['compare', '--baseline', 'example.com'], message: '--current' },
  ])('commander rejects $args with code 3 and no extra fatal message', ({ args, message }) => {
    const result = run(args);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain('[visual-check] fatal:');
  });

  it.each([
    { args: ['--threshold', 'abc'], message: 'Invalid --threshold' },
    { args: ['--threshold', '5abc'], message: 'Invalid --threshold' },
    { args: ['--viewports', 'mobile,dekstop'], message: 'dekstop' },
    { args: ['--concurrency', '1.5'], message: 'Invalid --concurrency' },
    { args: ['--load-time-warn', '0'], message: 'Invalid --load-time-warn' },
  ])('rejects run options $args before capture', ({ args, message }) => {
    const result = run(['run', '--urls', 'example.com', ...args]);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain('target(s)');
  });

  it('rejects an empty URL list', () => {
    const result = run(['run', '--urls', ',']);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toMatch(/no URLs were given/i);
  });

  it.each([['--help'], ['run', '--help'], ['--version']])('allows informational invocation %j', (...args) => {
    const result = run(args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
