import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertDistinctTargetSlugs, parseUrls, UsageError } from '../src/cli-args.js';
import { loadProjectConfigFile, resolveConfigTargets } from '../src/project-config.js';
import { DEFAULT_VIEWPORTS } from '../src/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vc-target-identity-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeJson(value: unknown): Promise<string> {
  const file = path.join(dir, 'vc.json');
  await writeFile(file, JSON.stringify(value), 'utf8');
  return file;
}

describe('targets that would share one baseline file', () => {
  it.each([
    ['http and https on one host', 'http://a.example,https://a.example'],
    ['a dash vs a dot in the host', 'https://my-site.example,https://my.site.example'],
    ['a slash vs an underscore in the path', 'https://a.example/x/y,https://a.example/x_y'],
  ])('rejects %s in --urls with a UsageError naming both URLs', (_label, raw) => {
    const [first, second] = raw.split(',');
    expect(() => parseUrls(raw)).toThrow(UsageError);
    expect(() => parseUrls(raw)).toThrow(`${first} and ${second} would share one baseline file`);
  });

  it('still accepts URLs whose files differ (ports, queries, paths)', () => {
    expect(() =>
      assertDistinctTargetSlugs([
        'https://a.example',
        'https://a.example:8443',
        'https://a.example/?p=1',
        'https://a.example/?p=2',
        'https://a.example/x',
      ]),
    ).not.toThrow();
  });

  it('rejects config routes that collide after slugging', async () => {
    const config = await loadProjectConfigFile(
      await writeJson({ projectId: 'p', routes: [{ id: 'a', path: '/x/y' }, { id: 'b', path: '/x_y' }] }),
    );
    expect(() => resolveConfigTargets(config, 'https://a.example')).toThrow('would share one baseline file');
  });
});

describe('config routes stay on the base host', () => {
  it.each(['//evil.example/x', '/\\evil.example/x'])('rejects the protocol-relative path %j', async (routePath) => {
    const file = await writeJson({ projectId: 'p', routes: [{ id: 'bad', path: routePath }] });
    await expect(loadProjectConfigFile(file)).rejects.toThrow('routes[0].path must be a path on the base URL');
  });

  it('still accepts ordinary root-relative paths', async () => {
    const config = await loadProjectConfigFile(
      await writeJson({ projectId: 'p', routes: [{ id: 'a', path: '/a//b' }] }),
    );
    expect(resolveConfigTargets(config, 'https://a.example').urls).toEqual(['https://a.example/a//b']);
  });
});

describe('config viewport names are unique', () => {
  it('does not use viewports that list one name at two sizes, and says why', async () => {
    const config = await loadProjectConfigFile(
      await writeJson({
        projectId: 'p',
        routes: [{ id: 'home', path: '/' }],
        viewports: [
          { name: 'desktop', width: 1280, height: 800 },
          { name: 'desktop', width: 1440, height: 900 },
        ],
      }),
    );
    const { viewports, warnings } = resolveConfigTargets(config, 'https://a.example');
    expect(viewports).toEqual(DEFAULT_VIEWPORTS);
    expect(warnings).toEqual([
      'viewports: not used ("desktop" is listed more than once, and both sizes would write the same desktop.png); using mobile, tablet, desktop',
    ]);
  });

  it('keeps distinct custom viewports as given', async () => {
    const viewports = [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'desktop', width: 1280, height: 800 },
    ];
    const config = await loadProjectConfigFile(
      await writeJson({ projectId: 'p', routes: [{ id: 'home', path: '/' }], viewports }),
    );
    const resolved = resolveConfigTargets(config, 'https://a.example');
    expect(resolved.viewports).toEqual(viewports);
    expect(resolved.warnings).toEqual([]);
  });
});
