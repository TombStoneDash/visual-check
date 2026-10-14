import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE_OR_FATAL_EXIT_CODE } from '../src/exit-codes.js';

// Built CLI, no browser: same style as test/cli.usage-exit-codes.test.ts.
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const builtCli = path.join(repoRoot, 'dist/cli.js');
const exampleConfig = path.join(repoRoot, 'examples/projects/pyramid-builder.config.mjs');

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

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vc-cli-config-flag-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeJson(name: string, value: unknown): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(value), 'utf8');
  return file;
}

describe('run --config (no browser, --dry-run)', () => {
  it('resolves the example config routes against --base-url and applies config viewports', () => {
    const result = run(['run', '--config', exampleConfig, '--base-url', 'https://example.com', '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('5 URL(s) × 2 viewport(s)');
    expect(result.stdout).toContain('  https://example.com/ @ mobile 390x844');
    expect(result.stdout).toContain('  https://example.com/stream @ desktop 1440x900');
    expect(result.stderr).not.toContain('notice:');
    expect(result.stderr).toContain('[visual-check] warning: checks is not applied by config-targets yet');
  });

  it('captures a custom config viewport size as-is, with no size warning', async () => {
    const file = await writeJson('vc.json', {
      projectId: 'demo',
      baseUrl: 'https://cfg.example',
      routes: [{ id: 'home', path: '/' }],
      viewports: [{ name: 'desktop', width: 1280, height: 800 }],
    });
    const result = run(['run', '--config', file, '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('  https://cfg.example/ @ desktop 1280x800');
    expect(result.stderr).not.toContain('not applied');
  });

  it('--base-url wins over the config baseUrl', async () => {
    const file = await writeJson('vc.json', {
      projectId: 'demo', baseUrl: 'https://cfg.example', routes: [{ id: 'home', path: '/' }],
    });
    const result = run(['run', '--config', file, '--base-url', 'https://flag.example', '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('https://flag.example/ @');
    expect(result.stdout).not.toContain('cfg.example');
  });

  it('--urls and --viewports override the config with one stderr notice each', () => {
    const result = run([
      'run', '--config', exampleConfig, '--base-url', 'https://example.com',
      '--urls', 'https://override.example', '--viewports', 'tablet:700x1000', '--dry-run',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 URL(s) × 1 viewport(s)');
    expect(result.stdout).toContain('  https://override.example @ tablet 700x1000');
    expect(result.stdout).not.toContain('example.com/');
    expect(result.stderr.match(/notice: --urls overrides config routes/g)).toHaveLength(1);
    expect(result.stderr.match(/notice: --viewports overrides config viewports/g)).toHaveLength(1);
  });

  it.each([
    { name: 'missing config file', args: ['--config', 'does-not-exist.json', '--base-url', 'https://example.com'], message: 'does-not-exist.json' },
    { name: 'no base URL anywhere', args: ['--config', exampleConfig], message: '--base-url' },
    { name: '--base-url without --config', args: ['--urls', 'https://example.com', '--base-url', 'https://example.com'], message: '--base-url needs --config' },
    { name: 'bad --viewports token', args: ['--config', exampleConfig, '--base-url', 'https://example.com', '--viewports', 'desktop:0x800'], message: 'Invalid viewport size' },
  ])('exits with the usage/fatal code: $name', ({ args, message }) => {
    const result = run(['run', ...args, '--dry-run']);
    expect(result.status, result.stderr).toBe(USAGE_OR_FATAL_EXIT_CODE);
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain('dry run');
  });

  it('still requires --urls without --config (pinned behaviour)', () => {
    const result = run(['run', '--dry-run']);
    expect(result.status).toBe(USAGE_OR_FATAL_EXIT_CODE);
    expect(result.stderr).toContain("required option '--urls <urls>' not specified");
    expect(result.stderr).not.toContain('[visual-check] fatal:');
  });
});

describe('compare and deploy-gate accept --config', () => {
  it('compare --help and deploy-gate --help list --config and --base-url', () => {
    for (const command of ['compare', 'deploy-gate']) {
      const result = run([command, '--help']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('--config <path>');
      expect(result.stdout).toContain('--base-url <url>');
    }
  });

  it('compare still requires --current without --config (pinned behaviour)', () => {
    const result = run(['compare', '--baseline', 'https://example.com']);
    expect(result.status).toBe(USAGE_OR_FATAL_EXIT_CODE);
    expect(result.stderr).toContain("required option '--current <target>' not specified");
  });

  it('deploy-gate rejects a bad config before anything else', () => {
    const result = run([
      'deploy-gate', '--config', 'does-not-exist.json', '--base-url', 'https://example.com',
      '--project', 'demo', '--deployment-url', 'https://example.com',
    ]);
    expect(result.status).toBe(USAGE_OR_FATAL_EXIT_CODE);
    expect(result.stderr).toContain('does-not-exist.json');
  });
});
