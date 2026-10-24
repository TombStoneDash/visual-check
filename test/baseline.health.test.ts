import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBaseline, type BaselineCapturer } from '../src/commands/baseline.js';
import { urlToSlug } from '../src/capture.js';
import type { CaptureArtifact, ViewportSpec } from '../src/types.js';

const MOBILE: ViewportSpec = { name: 'mobile', width: 390, height: 844 };
const DESKTOP: ViewportSpec = { name: 'desktop', width: 1440, height: 900 };
const OLD = Buffer.from('approved-baseline');
const NEW = Buffer.from('new-capture');

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-baseline-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function dest(url: string, vp: ViewportSpec): string {
  return path.join(root, 'baselines', urlToSlug(url), `${vp.name}.png`);
}

async function seed(url: string, vp: ViewportSpec): Promise<void> {
  await fs.mkdir(path.dirname(dest(url, vp)), { recursive: true });
  await fs.writeFile(dest(url, vp), OLD);
}

/** Fake capturer: writes NEW to the output path, then reports `outcome`. */
function capturer(
  outcome: Partial<CaptureArtifact> & { write?: boolean; throws?: boolean },
): BaselineCapturer & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async capture(url, vp, outputPath) {
      paths.push(outputPath);
      if (outcome.write !== false) await fs.writeFile(outputPath, NEW);
      if (outcome.throws) throw new Error('browser crashed');
      return {
        url,
        viewport: vp.name,
        screenshotPath: outputPath,
        httpStatus: 200,
        consoleErrors: [],
        loadTimeMs: 42,
        ...outcome,
      };
    },
  };
}

async function leftovers(): Promise<string[]> {
  const all = await fs.readdir(path.join(root, 'baselines'), { recursive: true });
  return all.filter((f) => String(f).includes('.capturing-')).map(String);
}

const URL_A = 'https://a.test';

describe('runBaseline', () => {
  it('saves a healthy capture and never captures straight onto the baseline file', async () => {
    await seed(URL_A, MOBILE);
    const cap = capturer({ httpStatus: 200 });
    const lines: string[] = [];

    const [r] = await runBaseline({ urls: [URL_A], viewports: [MOBILE], root, capturer: cap, log: (l) => lines.push(l) });

    expect(r).toMatchObject({ saved: true, reason: null, httpStatus: 200 });
    expect(cap.paths[0]).not.toBe(dest(URL_A, MOBILE));
    expect(path.dirname(cap.paths[0]!)).toBe(path.dirname(dest(URL_A, MOBILE)));
    expect(await fs.readFile(dest(URL_A, MOBILE))).toEqual(NEW);
    expect(lines[0]).toContain('OK (HTTP 200, 42ms)');
    expect(await leftovers()).toEqual([]);
  });

  it.each([404, 500, 503])('does not save an HTTP %i page and keeps the existing baseline', async (status) => {
    await seed(URL_A, MOBILE);
    const lines: string[] = [];

    const [r] = await runBaseline({
      urls: [URL_A],
      viewports: [MOBILE],
      root,
      capturer: capturer({ httpStatus: status }),
      log: (l) => lines.push(l),
    });

    expect(r).toMatchObject({ saved: false, reason: `NOT SAVED: HTTP ${status}` });
    expect(await fs.readFile(dest(URL_A, MOBILE))).toEqual(OLD);
    expect(lines[0]).toContain('existing baseline kept');
    expect(await leftovers()).toEqual([]);
  });

  it('does not create a baseline from a 404 when none existed', async () => {
    const [r] = await runBaseline({ urls: [URL_A], viewports: [MOBILE], root, capturer: capturer({ httpStatus: 404 }), log: () => {} });
    expect(r!.saved).toBe(false);
    await expect(fs.access(path.dirname(dest(URL_A, MOBILE)))).rejects.toThrow();
  });

  it('keeps the baseline on a capture error, a missing HTTP response or a capture that wrote nothing', async () => {
    for (const outcome of [
      { error: 'navigation_timeout' },
      { httpStatus: null },
      { write: false },
    ] as const) {
      await seed(URL_A, MOBILE);
      const [r] = await runBaseline({ urls: [URL_A], viewports: [MOBILE], root, capturer: capturer(outcome), log: () => {} });
      expect(r!.saved, JSON.stringify(outcome)).toBe(false);
      expect(await fs.readFile(dest(URL_A, MOBILE))).toEqual(OLD);
    }
    expect(await leftovers()).toEqual([]);
  });

  it('keeps the baseline and cleans up when the capturer throws mid-capture', async () => {
    await seed(URL_A, MOBILE);
    const [r] = await runBaseline({ urls: [URL_A], viewports: [MOBILE], root, capturer: capturer({ throws: true }), log: () => {} });
    expect(r!.saved).toBe(false);
    expect(r!.reason).toMatch(/^ERROR: /);
    expect(await fs.readFile(dest(URL_A, MOBILE))).toEqual(OLD);
    expect(await leftovers()).toEqual([]);
  });

  it('keeps going after one bad target and reports each one', async () => {
    let n = 0;
    const mixed: BaselineCapturer = {
      async capture(url, vp, outputPath) {
        await fs.writeFile(outputPath, NEW);
        const httpStatus = n++ === 0 ? 404 : 200;
        return { url, viewport: vp.name, screenshotPath: outputPath, httpStatus, consoleErrors: [], loadTimeMs: 1 };
      },
    };
    const results = await runBaseline({ urls: [URL_A], viewports: [MOBILE, DESKTOP], root, capturer: mixed, log: () => {} });
    expect(results.map((r) => [r.viewport, r.saved])).toEqual([
      ['mobile', false],
      ['desktop', true],
    ]);
  });
});
