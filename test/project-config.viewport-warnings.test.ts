import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfigFile, resolveConfigTargets } from '../src/project-config.js';
import { DEFAULT_VIEWPORTS } from '../src/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vc-project-config-viewports-'));
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
  routes: [{ id: 'home', path: '/' }],
};

describe('resolveConfigTargets viewport warnings', () => {
  it.each([
    ['unknown name', [{ name: 'phone', width: 390, height: 844 }]],
    ['zero width', [{ name: 'desktop', width: 0, height: 900 }]],
    ['empty list', []],
    ['not a list', 'desktop'],
  ])('falls back to DEFAULT_VIEWPORTS with one fallback warning when viewports is %s', async (_label, viewports) => {
    const config = await loadProjectConfigFile(await writeJson('vc.json', { ...base, viewports }));
    const result = resolveConfigTargets(config, 'https://example.com');
    expect(result.viewports).toEqual(DEFAULT_VIEWPORTS);
    const viewportWarnings = result.warnings.filter((w) => w.startsWith('viewports') || w.startsWith('viewport '));
    expect(viewportWarnings).toHaveLength(1);
    expect(viewportWarnings[0]).toContain('mobile');
    expect(viewportWarnings[0]).toContain('tablet');
    expect(viewportWarnings[0]).toContain('desktop');
  });

  it('uses a resized desktop config viewport unchanged, plus one size warning', async () => {
    const config = await loadProjectConfigFile(
      await writeJson('vc.json', { ...base, viewports: [{ name: 'desktop', width: 1280, height: 800 }] }),
    );
    const result = resolveConfigTargets(config, 'https://example.com');
    expect(result.viewports).toEqual([{ name: 'desktop', width: 1280, height: 800 }]);
    const viewportWarnings = result.warnings.filter((w) => w.startsWith('viewport '));
    expect(viewportWarnings).toHaveLength(1);
    expect(viewportWarnings[0]).toContain('1280x800');
    expect(viewportWarnings[0]).toContain('1440x900');
  });

  it('gives exactly one size warning when only one of two entries is resized', async () => {
    const config = await loadProjectConfigFile(
      await writeJson('vc.json', {
        ...base,
        viewports: [
          { name: 'mobile', width: 390, height: 844 },
          { name: 'desktop', width: 1280, height: 800 },
        ],
      }),
    );
    const result = resolveConfigTargets(config, 'https://example.com');
    const viewportWarnings = result.warnings.filter((w) => w.startsWith('viewport '));
    expect(viewportWarnings).toHaveLength(1);
    expect(viewportWarnings[0]).toContain('desktop');
    expect(viewportWarnings[0]).toContain('1280x800');
  });

  it('gives no viewport warning when viewports is absent', async () => {
    const config = await loadProjectConfigFile(await writeJson('vc.json', base));
    const result = resolveConfigTargets(config, 'https://example.com');
    expect(result.warnings.filter((w) => w.startsWith('viewport'))).toHaveLength(0);
  });

  it('gives no viewport warning when all used entries have their default size', async () => {
    const config = await loadProjectConfigFile(
      await writeJson('vc.json', { ...base, viewports: [{ name: 'desktop', width: 1440, height: 900 }] }),
    );
    const result = resolveConfigTargets(config, 'https://example.com');
    expect(result.warnings.filter((w) => w.startsWith('viewport'))).toHaveLength(0);
  });

  it('still gives exactly the three themes/checks/maskSelectors warnings, in order, with no viewport warning', async () => {
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
});

// CLI case: same way of running the built CLI as test/project-config.test.ts (no browser).
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

describe('config-targets CLI with a resized viewport', () => {
  it('exits 0, keeps --viewports= names unchanged, and warns about the size on stderr', async () => {
    const file = await writeJson('vc.json', { ...base, viewports: [{ name: 'desktop', width: 1280, height: 800 }] });
    const result = runCli(['config-targets', '--config', file, '--base-url', 'https://example.com']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('--urls=https://example.com/\n--viewports=desktop\n');
    expect(result.stderr).toContain('[visual-check] warning: viewport "desktop"');
  });
});
