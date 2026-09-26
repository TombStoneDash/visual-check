import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProjectConfigFile, resolveConfigTargets } from '../src/project-config.js';

// Example configs under examples/projects/ go through the real config-targets loader.
// They are examples only: nothing may build, publish or run them automatically.

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'examples/projects');

const EXPECTED: Record<string, { baseUrl: string; urls: string[]; viewports: string[] }> = {
  'pyramid-builder.config.mjs': {
    baseUrl: 'https://prelithic.com',
    urls: ['/', '/dedicate', '/builders', '/ledger', '/stream'].map((p) => `https://prelithic.com${p}`),
    viewports: ['mobile', 'desktop'],
  },
  'project-circle-browser.config.mjs': {
    baseUrl: 'https://project-circle-browser.vercel.app',
    urls: ['/', '/privacy.html', '/support.html'].map((p) => `https://project-circle-browser.vercel.app${p}`),
    viewports: ['mobile', 'desktop'],
  },
  'mission-control.config.mjs': {
    baseUrl: 'http://localhost:3333',
    urls: ['/', '/status', '/tasks', '/decisions', '/deploys', '/hermes'].map((p) => `http://localhost:3333${p}`),
    viewports: ['desktop'],
  },
};

describe('examples/projects configs', () => {
  it('contains exactly the expected example files', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file}: loads and resolves to the documented URLs and viewports`, async () => {
      const config = await loadProjectConfigFile(path.join(dir, file));
      const { urls, viewports, warnings } = resolveConfigTargets(config, expected.baseUrl);
      expect(urls).toEqual(expected.urls);
      expect(viewports.map((v) => v.name)).toEqual(expected.viewports);
      // Keys the CLI does not apply yet are reported, never silently dropped.
      expect(warnings).toContain('checks is not applied by config-targets yet');
      // The usage line in the file header matches the tested base URL.
      expect(readFileSync(path.join(dir, file), 'utf8')).toContain(
        `config-targets --config examples/projects/${file} --base-url ${expected.baseUrl}`,
      );
    });
  }

  it('keeps Mission Control status-only and says how, since checks are not applied yet', async () => {
    const config = await loadProjectConfigFile(path.join(dir, 'mission-control.config.mjs'));
    expect((config.checks as Record<string, string>).pixel_diff).toBe('skip');
    expect(readFileSync(path.join(dir, 'mission-control.config.mjs'), 'utf8')).toMatch(
      /do\s*(\/\/\s*)?not capture baselines for this board/,
    );
  });

  it('type-checks against ProjectConfig in visual-check.config.example.ts', () => {
    const tsc = createRequire(__filename).resolve('typescript/bin/tsc');
    const files = Object.keys(EXPECTED).map((f) => path.join('examples/projects', f));
    // Throws with the compiler output if any example does not match the ProjectConfig type.
    execFileSync(
      process.execPath,
      [tsc, '--noEmit', '--allowJs', '--checkJs', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
        '--target', 'ES2022', '--skipLibCheck', ...files],
      { cwd: root, stdio: 'pipe' },
    );
  }, 60_000);

  it('is never built, published or run by a workflow', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files.some((f) => f.startsWith('examples'))).toBe(false);
    const tsconfig = JSON.parse(readFileSync(path.join(root, 'tsconfig.json'), 'utf8')) as { include: string[] };
    expect(tsconfig.include).toEqual(['src/**/*']);
    const workflows = path.join(root, '.github/workflows');
    for (const wf of readdirSync(workflows)) {
      expect(readFileSync(path.join(workflows, wf), 'utf8')).not.toContain('examples/projects');
    }
  });
});
