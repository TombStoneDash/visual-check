import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FILES = [
  '.github/workflows/visual-check.yml',
  '.github/workflows/ci.yml',
  'action.yml',
  'examples/consumer/visual-check.yml',
];

/** The shell text of every `run:` step: the inline value or the indented block under it. */
function runBlocks(yaml: string): string[] {
  const lines = yaml.split('\n');
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const indent = m[1]!.length;
    const body = [m[2]!];
    while (i + 1 < lines.length) {
      const next = lines[i + 1]!;
      if (next.trim() !== '' && next.search(/\S/) <= indent) break;
      body.push(next);
      i++;
    }
    blocks.push(body.join('\n'));
  }
  return blocks;
}

describe('workflow shell steps', () => {
  it('finds the run steps it checks', () => {
    expect(runBlocks(read('.github/workflows/visual-check.yml')).join('\n')).toContain('deploy-gate');
  });

  it.each(FILES)('%s passes dispatch/action inputs to run: only through env', (file) => {
    for (const block of runBlocks(read(file))) {
      expect(block).not.toMatch(/\$\{\{[^}]*\b(github\.event\.|inputs\.)/);
    }
  });

  it.each(FILES)('%s runs the CLI from this checkout, never an npm download', (file) => {
    expect(read(file)).not.toMatch(/npx\s+(@noui\/)?visual-check\b/);
  });

  it('builds before running dist/cli.js', () => {
    const blocks = runBlocks(read('.github/workflows/visual-check.yml'));
    const build = blocks.findIndex((b) => /npm run build/.test(b));
    const gate = blocks.findIndex((b) => /node dist\/cli\.js deploy-gate/.test(b));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(build);
  });
});
