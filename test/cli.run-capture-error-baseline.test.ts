/**
 * `run` against a page that cannot load, with an approved baseline on disk:
 * the report must still point at that baseline (so the HTML report shows
 * what the page should look like) and must not claim needs_baseline.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlToSlug } from '../src/capture.js';
import { browserReady, mustRunBrowserTests } from './helpers/browser-ready.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtCli = path.join(repoRoot, 'dist', 'cli.js');

let workRoot: string;

beforeAll(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-run-capture-error-'));
});

afterAll(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

describe.skipIf(!browserReady && !mustRunBrowserTests)('visual-check run — capture error with a baseline', () => {
  it('reports the existing baseline and an error verdict', async () => {
    // Port 9 (discard) on loopback refuses the connection immediately.
    const url = 'http://127.0.0.1:9/';
    const baselinePath = path.join(workRoot, 'baselines', urlToSlug(url), 'mobile.png');
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(baselinePath, Buffer.from([137, 80, 78, 71]));
    const jsonPath = path.join(workRoot, 'report.json');

    const res = spawnSync(
      process.execPath,
      [builtCli, 'run', '--urls', url, '--viewports', 'mobile', '--out', workRoot, '--json', jsonPath, '--no-html', '--quiet'],
      { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 },
    );

    expect(res.status).toBe(3);
    const report = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    const target = report.results[0];
    expect(target.verdict).toBe('error');
    expect(target.baseline).toBe(baselinePath);
    expect(target.checks.find((c: { name: string }) => c.name === 'pixel_diff').message).toBe(
      'skipped due to capture error',
    );
    expect(report.summary.needs_baseline).toBe(0);
  }, 90_000);
});
