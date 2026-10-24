import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FILES = [
  '.github/workflows/ci.yml',
  '.github/workflows/visual-check.yml',
  'action.yml',
  'examples/consumer/visual-check.yml',
];

// Last major of each action that still ran on the deprecated node20 runtime.
const NODE20_MAJORS: Record<string, number> = {
  'actions/checkout': 4,
  'actions/setup-node': 4,
  'actions/cache': 4,
  'actions/upload-artifact': 5,
};

describe('workflow runtimes', () => {
  it('no workflow or the action pins end-of-life Node 20', () => {
    for (const file of FILES) {
      for (const m of read(file).matchAll(/node-version:\s*["']?(\d+)/g)) {
        expect(Number(m[1]), `${file}: node-version ${m[1]}`).toBeGreaterThanOrEqual(22);
      }
    }
  });

  it('every official action is on a node24-runtime major', () => {
    for (const file of FILES) {
      for (const m of read(file).matchAll(/uses:\s*(actions\/[a-z-]+)@v(\d+)/g)) {
        const last = NODE20_MAJORS[m[1]!];
        if (last === undefined) continue;
        expect(Number(m[2]), `${file}: ${m[1]}@v${m[2]}`).toBeGreaterThan(last);
      }
    }
  });
});
