import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { diffPngs } from '../src/diff.js';
import { checkPixelDiff } from '../src/checks.js';

function solidPng(w: number, h: number, r: number, g: number, b: number): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-check-diff-unwritable-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** A regular file standing where the diffs directory should be — mkdir(dirname) must fail. */
async function unwritableDiffPath(dir: string): Promise<string> {
  const blocker = path.join(dir, 'diffs');
  await fs.writeFile(blocker, 'not a directory');
  return path.join(blocker, 'home', 'desktop.png');
}

describe('diffPngs — same-size images, diff image cannot be written', () => {
  it('still returns the computed result with no image instead of throwing', async () => {
    const dir = await mkTmp();
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    await fs.writeFile(a, solidPng(10, 10, 200, 200, 200));
    const png = PNG.sync.read(solidPng(10, 10, 200, 200, 200));
    // 2×1 red patch at (3,4) → 2 of 100 pixels differ.
    for (const x of [3, 4]) {
      const i = (4 * 10 + x) << 2;
      png.data[i] = 255;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
    }
    await fs.writeFile(b, PNG.sync.write(png));

    const r = await diffPngs(a, b, await unwritableDiffPath(dir));
    expect(r.dimensionMismatch).toBe(false);
    expect(r.diffPixels).toBe(2);
    expect(r.totalPixels).toBe(100);
    expect(r.diffPercentage).toBeCloseTo(2, 5);
    expect(r.changedRegion).toEqual({ x: 3, y: 4, width: 2, height: 1 });
    expect(r.diffImagePath).toBeNull();
  });

  it('identical screenshots still pass the pixel_diff check (not a blocking error)', async () => {
    const dir = await mkTmp();
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    await fs.writeFile(a, solidPng(10, 10, 50, 60, 70));
    await fs.writeFile(b, solidPng(10, 10, 50, 60, 70));

    // Mirror the callers: a throw from diffPngs becomes a null diff.
    let diff = null;
    try {
      diff = await diffPngs(a, b, await unwritableDiffPath(dir));
    } catch {
      diff = null;
    }
    const check = checkPixelDiff(diff, 0.1, true);
    expect(check.status).toBe('pass');
    expect(check.blocking).toBe(false);
  });
});
