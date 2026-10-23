import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/ is rebuilt by test/global-setup.ts, which scripts/smoke-diff.mjs imports.
const script = fileURLToPath(new URL('../scripts/smoke-diff.mjs', import.meta.url));

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('scripts/smoke-diff.mjs', () => {
  it('passes without touching a smoke-tmp folder in the current directory', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-check-smoke-cwd-'));
    tmpDirs.push(cwd);
    // A user folder that happens to be called smoke-tmp must survive the run.
    const keep = path.join(cwd, 'smoke-tmp', 'keep.txt');
    await fs.mkdir(path.dirname(keep), { recursive: true });
    await fs.writeFile(keep, 'mine');

    const out = execFileSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    expect(out).toContain('diff engine smoke test PASSED');

    expect(await fs.readFile(keep, 'utf8')).toBe('mine');
    expect(await fs.readdir(path.join(cwd, 'smoke-tmp'))).toEqual(['keep.txt']);
    expect(await fs.readdir(cwd)).toEqual(['smoke-tmp']);
  });
});
