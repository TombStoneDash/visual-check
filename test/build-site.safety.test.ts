import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/build-site.mjs', import.meta.url));

let root: string;

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** A throwaway repo layout: scripts/build-site.mjs, a stub dist/, and an existing site/. */
async function fakeRepo(): Promise<string> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-build-site-'));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(SCRIPT, path.join(root, 'scripts', 'build-site.mjs'));
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(
    path.join(root, 'dist', 'presence-demo.js'),
    'export const DEMO_SNAPSHOTS = [];\nexport function renderDemoSite(o) { return `<html>${o.compare.length}</html>`; }\n',
  );
  await fs.mkdir(path.join(root, 'site'));
  await fs.writeFile(path.join(root, 'site', 'index.html'), 'committed site');
  return root;
}

async function writeScenario(name: string): Promise<void> {
  const dir = path.join(root, 'demo', 'output', name);
  await fs.mkdir(dir, { recursive: true });
  const report = {
    pass: name === 'pass',
    config: { pixel_diff_threshold: 0.1 },
    results: [{ viewport: 'desktop', diff_percentage: 0, baseline: null, screenshot: null, diff_image: null }],
  };
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report));
  await fs.writeFile(path.join(dir, 'report.html'), `<html>${name}</html>`);
}

function build() {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'build-site.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('scripts/build-site.mjs', () => {
  it('leaves the committed site/ untouched when the fail scenario output is missing', async () => {
    await fakeRepo();
    await writeScenario('pass');
    const r = build();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('site/ left unchanged');
    expect(await fs.readFile(path.join(root, 'site', 'index.html'), 'utf8')).toBe('committed site');
  });

  it('leaves site/ untouched when a report.html is missing', async () => {
    await fakeRepo();
    await writeScenario('pass');
    await writeScenario('fail');
    await fs.rm(path.join(root, 'demo', 'output', 'fail', 'report.html'));
    const r = build();
    expect(r.status).toBe(1);
    expect(await fs.readFile(path.join(root, 'site', 'index.html'), 'utf8')).toBe('committed site');
  });

  it('rebuilds site/ when both scenarios are present', async () => {
    await fakeRepo();
    await writeScenario('pass');
    await writeScenario('fail');
    const r = build();
    expect(r.status, r.stderr).toBe(0);
    expect(await fs.readFile(path.join(root, 'site', 'index.html'), 'utf8')).toBe('<html>2</html>');
    expect(await fs.readFile(path.join(root, 'site', 'reports', 'fail.html'), 'utf8')).toBe('<html>fail</html>');
  });
});
