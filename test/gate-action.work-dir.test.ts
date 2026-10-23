import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** The `run: |` script of an action.yml step, dedented. */
function stepScript(name: string): string {
  const yml = readFileSync(path.join(repo, 'action.yml'), 'utf8');
  const start = yml.indexOf(`- name: ${name}\n`);
  const end = yml.indexOf('\n    - name:', start + 1);
  const block = yml.slice(start, end === -1 ? undefined : end);
  return block
    .slice(block.indexOf('run: |') + 'run: |'.length + 1)
    .split('\n')
    .map((l) => l.replace(/^ {8}/, ''))
    .join('\n');
}

let tmp: string;
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Run the Gate step like GitHub does (bash -eo pipefail) with a stub CLI that
 * crashes before writing report.json, and a stale report from an earlier call.
 */
function runGate(over: Record<string, string> = {}) {
  const vc = path.join(tmp, 'vc');
  mkdirSync(path.join(vc, 'dist'), { recursive: true });
  mkdirSync(path.join(vc, 'scripts'), { recursive: true });
  writeFileSync(path.join(vc, 'dist', 'cli.js'), 'process.exit(3);\n');
  copyFileSync(path.join(repo, 'scripts', 'gate-summary.mjs'), path.join(vc, 'scripts', 'gate-summary.mjs'));

  const work = path.join(tmp, 'work');
  mkdirSync(path.join(work, 'baselines'), { recursive: true });
  writeFileSync(path.join(work, 'report.json'), JSON.stringify({ terminal_state: 'SHIPPED_PROVEN', results: [] }));
  writeFileSync(path.join(work, 'baselines', 'stale.png'), 'old');

  const out = path.join(tmp, `out-${Math.random().toString(36).slice(2)}`);
  const res = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', stepScript('Gate')], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      VC: vc,
      WORK: work,
      DIR: path.join(tmp, 'baselines'),
      URLS: 'https://example.com',
      VIEWPORTS: 'mobile',
      THRESHOLD: '0.1',
      PROJECT: 'my proj/x',
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
      GITHUB_JOB: 'gate',
      GITHUB_RUN_ATTEMPT: '1',
      ...over,
    },
  });
  return { res, work, outputs: existsSync(out) ? readFileSync(out, 'utf8') : '' };
}

describe('action.yml Gate step', () => {
  it('never reports an earlier call\'s report or reuses its baselines', () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'vc-gate-step-'));
    const { res, work, outputs } = runGate();
    expect(res.status, res.stderr).toBe(0);
    expect(outputs).toContain('exit_code=3');
    expect(outputs).not.toContain('terminal_state=');
    expect(existsSync(path.join(work, 'baselines', 'stale.png'))).toBe(false);
    expect(readFileSync(path.join(tmp, 'summary.md'), 'utf8')).toContain('No report was written (exit 3)');
  });

  it('gives every call its own artifact name', () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'vc-gate-step-'));
    const names = [runGate(), runGate()].map((r) => /^artifact=(.*)$/m.exec(r.outputs)?.[1]);
    expect(names[0]).toMatch(/^visual-check-my-proj-x-gate-1-[0-9a-f]{8}$/);
    expect(names[1]).toMatch(/^visual-check-my-proj-x-gate-1-[0-9a-f]{8}$/);
    expect(names[0]).not.toBe(names[1]);
  });

  it('refuses a baseline-dir inside its work dir instead of deleting it', () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'vc-gate-step-'));
    const { res, work } = runGate({ DIR: path.join(tmp, 'work', 'baselines') });
    expect(res.status).toBe(3);
    expect(existsSync(path.join(work, 'baselines', 'stale.png'))).toBe(true);
  });
});
