import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfigFile, resolveConfigTargets } from '../src/project-config.js';
import { DEFAULT_VIEWPORTS } from '../src/types.js';
import { USAGE_OR_FATAL_EXIT_CODE } from '../src/exit-codes.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vc-project-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeJson(name: string, value: unknown): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(value), 'utf8');
  return file;
}

const base = {
  projectId: 'demo',
  routes: [
    { id: 'home', path: '/' },
    { id: 'pricing', path: '/pricing' },
    { id: 'home-again', path: '/' },
  ],
};

describe('loadProjectConfigFile + resolveConfigTargets', () => {
  it('turns JSON routes into URLs, keeping order and collapsing a duplicate', async () => {
    const config = await loadProjectConfigFile(await writeJson('vc.json', base));
    const { urls } = resolveConfigTargets(config, 'https://example.com');
    expect(urls).toEqual(['https://example.com/', 'https://example.com/pricing']);
  });

  it('resolves routes against a base URL that has a path (root-relative routes replace it)', async () => {
    const config = await loadProjectConfigFile(await writeJson('vc.json', base));
    const { urls } = resolveConfigTargets(config, 'https://example.com/app/');
    expect(urls).toEqual(['https://example.com/', 'https://example.com/pricing']);
  });

  it('loads an .mjs default export', async () => {
    const file = path.join(dir, 'vc.mjs');
    await writeFile(file, `export default ${JSON.stringify({ projectId: 'm', routes: [{ id: 'a', path: '/a' }] })};\n`, 'utf8');
    const config = await loadProjectConfigFile(file);
    expect(resolveConfigTargets(config, 'https://example.com').urls).toEqual(['https://example.com/a']);
  });

  it('rejects a .ts config as not supported yet', async () => {
    const file = path.join(dir, 'vc.ts');
    await writeFile(file, 'export default {};\n', 'utf8');
    await expect(loadProjectConfigFile(file)).rejects.toThrow(/not supported yet/);
  });

  it.each([
    [{ routes: base.routes }, /projectId/],
    [{ projectId: 'x', routes: [] }, /routes must be a non-empty array/],
    [{ projectId: 'x', routes: [{ id: 'a', path: 'pricing' }] }, /routes\[0\]\.path/],
  ])('rejects an invalid config %#', async (value, message) => {
    await expect(loadProjectConfigFile(await writeJson('bad.json', value))).rejects.toThrow(message);
  });

  it('uses valid custom viewports and falls back to DEFAULT_VIEWPORTS when absent', async () => {
    const custom = await loadProjectConfigFile(
      await writeJson('custom.json', { ...base, viewports: [{ name: 'desktop', width: 1440, height: 900 }] }),
    );
    expect(resolveConfigTargets(custom, 'https://example.com').viewports.map((v) => v.name)).toEqual(['desktop']);
    const plain = await loadProjectConfigFile(await writeJson('plain.json', base));
    expect(resolveConfigTargets(plain, 'https://example.com').viewports).toEqual(DEFAULT_VIEWPORTS);
  });

  it('warns about keys it does not apply yet, sorted, plus routes with extra keys', async () => {
    const config = await loadProjectConfigFile(
      await writeJson('extras.json', {
        projectId: 'x',
        themes: ['light'],
        checks: { pixel_diff: 'blocking' },
        routes: [{ id: 'home', path: '/', maskSelectors: ['video'] }],
      }),
    );
    expect(resolveConfigTargets(config, 'https://example.com').warnings).toEqual([
      'checks is not applied by config-targets yet',
      'themes is not applied by config-targets yet',
      'route "home": maskSelectors not applied by config-targets yet',
    ]);
  });

  it('rejects a non-http base URL', async () => {
    const config = await loadProjectConfigFile(await writeJson('vc.json', base));
    expect(() => resolveConfigTargets(config, 'ftp://example.com')).toThrow(/base-url/);
  });
});

// CLI cases: same way of running the built CLI as test/cli.usage-exit-codes.test.ts (no browser).
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const builtCli = path.join(repoRoot, 'dist/cli.js');

beforeAll(() => {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc'], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(existsSync(builtCli)).toBe(true);
}, 60_000);

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [builtCli, ...args], {
    cwd: repoRoot, encoding: 'utf8', timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe('config-targets CLI', () => {
  it('prints exactly the --urls and --viewports lines and exits 0', async () => {
    const file = await writeJson('vc.json', base);
    const result = runCli(['config-targets', '--config', file, '--base-url', 'https://example.com']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      '--urls=https://example.com/,https://example.com/pricing\n--viewports=mobile,tablet,desktop\n',
    );
  });

  it('exits with the usage/fatal code for a missing config file', () => {
    const result = runCli([
      'config-targets', '--config', path.join(dir, 'missing.json'), '--base-url', 'https://example.com',
    ]);
    expect(result.status).toBe(USAGE_OR_FATAL_EXIT_CODE);
    expect(result.stderr).toContain('[visual-check] config-targets:');
  });
});
