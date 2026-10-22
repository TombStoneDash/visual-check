import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { gateSummary } from '../scripts/gate-summary.mjs';
// @ts-expect-error plain .mjs script without types
import { readProjectId } from '../scripts/gate-project.mjs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('thresholds.json', () => {
  it('matches the THRESHOLDS.md table row for row', () => {
    const table: Record<string, number> = {};
    for (const m of read('THRESHOLDS.md').matchAll(/^\| ([a-z.]+) \| ([0-9.]+)% \|/gm)) {
      table[m[1]!] = Number(m[2]);
    }
    expect(Object.keys(table).length).toBeGreaterThan(0);
    expect(JSON.parse(read('thresholds.json'))).toEqual(table);
  });
});

describe('gate action', () => {
  it('references no secret other than GITHUB_TOKEN', () => {
    for (const file of ['action.yml', 'examples/consumer/visual-check.yml']) {
      const refs = read(file).match(/secrets\.[A-Za-z_]+/g) ?? [];
      expect(refs.filter((r) => r !== 'secrets.GITHUB_TOKEN')).toEqual([]);
    }
  });
});

describe('gate-threshold.mjs', () => {
  const script = fileURLToPath(new URL('../scripts/gate-threshold.mjs', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 15_000 });

  it('prints the thresholds.json value for a known project', () => {
    const r = run('prelithic');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(String(JSON.parse(read('thresholds.json')).prelithic));
  });

  it('lets an explicit threshold win', () => {
    expect(run('nope', '0.5').stdout).toBe('0.5');
  });

  it.each(['menkaure', 'toString', 'constructor', '__proto__', ''])('exits 3 with no stdout for unknown project %j', (project) => {
    const r = run(project);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('no threshold for project');
  });
});

describe('gate-project.mjs', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'vc-gate-project-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads projectId from .json, .mjs and .js configs', async () => {
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ projectId: 'json-proj', routes: [] }));
    writeFileSync(path.join(dir, 'b.mjs'), "export default { projectId: 'mjs-proj', routes: [] };\n");
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(path.join(dir, 'c.js'), "export default { projectId: ' js-proj ', routes: [] };\n");
    expect(await readProjectId(path.join(dir, 'a.json'))).toBe('json-proj');
    expect(await readProjectId(path.join(dir, 'b.mjs'))).toBe('mjs-proj');
    expect(await readProjectId(path.join(dir, 'c.js'))).toBe('js-proj');
  });

  it('prints the projectId from the CLI, and exits 3 on an unreadable config', () => {
    const script = fileURLToPath(new URL('../scripts/gate-project.mjs', import.meta.url));
    writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ projectId: 'prelithic' }));
    writeFileSync(path.join(dir, 'bad.json'), '{ not json');
    const ok = spawnSync(process.execPath, [script, path.join(dir, 'ok.json')], { encoding: 'utf8', timeout: 15_000 });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe('prelithic');
    const bad = spawnSync(process.execPath, [script, path.join(dir, 'bad.json')], { encoding: 'utf8', timeout: 15_000 });
    expect(bad.status).toBe(3);
    expect(bad.stderr).toContain('could not read projectId');
  });
});

describe('gate action threshold step', () => {
  // The Resolve targets step's `run: |` block, run the way GitHub runs it.
  const step = (() => {
    const yml = read('action.yml');
    const block = yml.slice(yml.indexOf('- name: Resolve targets'), yml.indexOf('- name: Refresh baselines'));
    return block
      .slice(block.indexOf('run: |') + 'run: |'.length + 1)
      .split('\n')
      .map((l) => l.replace(/^ {8}/, ''))
      .join('\n');
  })();
  const repo = fileURLToPath(new URL('..', import.meta.url));

  function runStep(env: Record<string, string>) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vc-gate-step-'));
    const output = path.join(dir, 'output');
    writeFileSync(output, '');
    try {
      const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step], {
        encoding: 'utf8',
        timeout: 15_000,
        env: { PATH: process.env.PATH!, VC: repo, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, MODE: 'gate', BASE_URL: '', THRESHOLD: '', PROJECT: '', ...env },
      });
      return { ...r, output: readFileSync(output, 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 3 with an error annotation, and writes no threshold= output, for a project not in thresholds.json', () => {
    const r = runStep({ PROJECT: 'menkaure', CONFIG: 'unused.json' });
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("::error::Visual Check has no threshold for project 'menkaure'");
    expect(r.output).not.toContain('threshold=');
  });

  it('exits 3 when no project is given and the config cannot be read', () => {
    const r = runStep({ CONFIG: path.join(os.tmpdir(), 'vc-missing-config.json') });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('could not read projectId');
    expect(r.output).not.toContain('threshold=');
  });

  it('reads the project from a .json config and writes its threshold', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vc-gate-cfg-'));
    try {
      const config = path.join(dir, 'c.json');
      writeFileSync(config, JSON.stringify({ projectId: 'prelithic' }));
      // config-targets needs dist/; only the threshold lines matter here, so the
      // step may fail after writing them when dist/ is not built.
      const r = runStep({ CONFIG: config });
      expect(r.output).toContain('project=prelithic\n');
      expect(r.output).toContain(`threshold=${JSON.parse(read('thresholds.json')).prelithic}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('gateSummary', () => {
  const report = {
    terminal_state: 'READY_TO_REVIEW',
    summary: { total: 4, passed: 2, failed: 1, warnings: 0, errors: 0, needs_baseline: 1 },
    results: [
      { url: 'https://a/', viewport: 'mobile', diff_percentage: 0.01, verdict: 'pass' },
      { url: 'https://a/', viewport: 'desktop', diff_percentage: 2.5, verdict: 'fail' },
      { url: 'https://a/b', viewport: 'mobile', diff_percentage: 0.2, verdict: 'pass' },
      { url: 'https://a/c', viewport: 'mobile', diff_percentage: 0.1, verdict: 'pass' },
      { url: 'https://a/d', viewport: 'mobile', diff_percentage: null, verdict: 'needs_baseline' },
    ],
  };

  const rowsOf = (out: string) => out.split('\n').filter((l) => l.startsWith('| https://'));

  it('names project, threshold, terminal state; red targets first, then the top passing diffs', () => {
    const out: string = gateSummary(report, { project: 'prelithic', threshold: '0.12', exitCode: '1' });
    expect(out).toContain('Visual Check: prelithic');
    expect(out).toContain('`READY_TO_REVIEW` (exit 1)');
    expect(out).toContain('0.12% of pixels');
    const rows = rowsOf(out);
    expect(rows).toEqual([
      '| https://a/ | desktop | 2.500 | fail |  |',
      '| https://a/d | mobile | — | needs_baseline |  |',
      '| https://a/b | mobile | 0.200 | pass |',
      '| https://a/c | mobile | 0.100 | pass |',
      '| https://a/ | mobile | 0.010 | pass |',
    ]);
    expect(out).toContain('1 target(s) have no baseline');
  });

  it('lists size-change, HTTP and error targets that have no diff number, ahead of passing diffs', () => {
    const out: string = gateSummary(
      {
        terminal_state: 'BLOCKED_WITH_OWNER',
        summary: { total: 4, passed: 1, failed: 2, warnings: 0, errors: 1, needs_baseline: 0 },
        results: [
          { url: 'https://a.com/about', viewport: 'desktop', diff_percentage: 0.02, verdict: 'pass', reasons: [] },
          {
            url: 'https://a.com/',
            viewport: 'mobile',
            diff_percentage: null,
            verdict: 'fail',
            reasons: ['pixel_diff: dimensions 390×900 ≠ baseline 390×844'],
          },
          {
            url: 'https://b.com/?x=1|2',
            viewport: 'desktop',
            diff_percentage: null,
            verdict: 'fail',
            reasons: ['http_status: HTTP 404'],
          },
          { url: 'https://c.com/', viewport: 'tablet', diff_percentage: null, verdict: 'error', reasons: ['capture: timeout'] },
        ],
      },
      { project: 'p', threshold: '0.1', exitCode: '3' },
    );
    const rows = rowsOf(out);
    expect(rows).toEqual([
      '| https://c.com/ | tablet | — | error | capture: timeout |',
      '| https://a.com/ | mobile | size changed | fail | pixel_diff: dimensions 390×900 ≠ baseline 390×844 |',
      '| https://b.com/?x=1\\|2 | desktop | — | fail | http_status: HTTP 404 |',
      '| https://a.com/about | desktop | 0.020 | pass |',
    ]);
  });

  it('caps the needs-attention table and says how many more there are', () => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      url: `https://a/${i}`,
      viewport: 'desktop',
      diff_percentage: 5,
      verdict: 'fail',
      reasons: ['pixel_diff: over'],
    }));
    const out: string = gateSummary(
      { terminal_state: 'READY_TO_REVIEW', summary: { total: 12, passed: 0, failed: 12, warnings: 0, errors: 0, needs_baseline: 0 }, results },
      { project: 'p', threshold: '1', exitCode: '1' },
    );
    expect(rowsOf(out)).toHaveLength(10);
    expect(out).toContain('…and 2 more in the report.');
  });

  it('says so when no report was written', () => {
    expect(gateSummary(null, { project: 'x', threshold: '1', exitCode: '3' })).toContain('No report was written (exit 3)');
  });
});
