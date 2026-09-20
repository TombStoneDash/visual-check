import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { diffPngs } from '../src/diff.js';

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

function isMagenta(data: Buffer, width: number, x: number, y: number): boolean {
  const i = (y * width + x) << 2;
  return data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255 && data[i + 3] === 255;
}

const tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-check-diff-mismatch-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('diffPngs — dimension mismatch diff image', () => {
  it('taller actual: writes a diff image sized to the max canvas, magenta on the added band', async () => {
    const tmp = await mkTmp();
    const a = path.join(tmp, 'baseline.png');
    const b = path.join(tmp, 'actual.png');
    const d = path.join(tmp, 'diff.png');
    await fs.writeFile(a, solidPng(10, 10, 200, 200, 200));
    await fs.writeFile(b, solidPng(10, 14, 200, 200, 200));

    const r = await diffPngs(a, b, d);

    // Contract fields unchanged.
    expect(r.dimensionMismatch).toBe(true);
    expect(r.diffPercentage).toBe(100);
    expect(r.diffPixels).toBe(-1);
    expect(r.totalPixels).toBe(100);
    expect(r.changedRegion).toBeNull();
    expect(r.baselineDimensions).toEqual({ width: 10, height: 10 });
    expect(r.actualDimensions).toEqual({ width: 10, height: 14 });

    // New: a real diff image at the max(width) x max(height) canvas size.
    expect(r.diffImagePath).toBe(d);
    const stat = await fs.stat(d);
    expect(stat.size).toBeGreaterThan(0);
    const decoded = PNG.sync.read(await fs.readFile(d));
    expect(decoded.width).toBe(10);
    expect(decoded.height).toBe(14);

    // Rows 10-13 (the grown band, absent from the baseline) are magenta.
    for (let y = 10; y < 14; y++) {
      for (let x = 0; x < 10; x++) {
        expect(isMagenta(decoded.data, decoded.width, x, y)).toBe(true);
      }
    }
    // Row 0 (present in both, identical content) is not magenta.
    for (let x = 0; x < 10; x++) {
      expect(isMagenta(decoded.data, decoded.width, x, 0)).toBe(false);
    }

    expect(r.sizeDelta).toEqual({ width: 0, height: 4 });
  });

  it('shorter actual: canvas stays at baseline size, missing band is magenta', async () => {
    const tmp = await mkTmp();
    const a = path.join(tmp, 'baseline.png');
    const b = path.join(tmp, 'actual.png');
    const d = path.join(tmp, 'diff.png');
    await fs.writeFile(a, solidPng(10, 10, 200, 200, 200));
    await fs.writeFile(b, solidPng(10, 6, 200, 200, 200));

    const r = await diffPngs(a, b, d);

    expect(r.dimensionMismatch).toBe(true);
    expect(r.diffPercentage).toBe(100);
    expect(r.diffPixels).toBe(-1);
    expect(r.totalPixels).toBe(100);
    expect(r.changedRegion).toBeNull();

    const decoded = PNG.sync.read(await fs.readFile(d));
    expect(decoded.width).toBe(10);
    expect(decoded.height).toBe(10);

    // Rows 6-9 exist only in the baseline — the missing band is magenta.
    for (let y = 6; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        expect(isMagenta(decoded.data, decoded.width, x, y)).toBe(true);
      }
    }

    expect(r.sizeDelta).toEqual({ width: 0, height: -4 });
  });

  it('width change: canvas widens, missing/added column band is magenta', async () => {
    const tmp = await mkTmp();
    const a = path.join(tmp, 'baseline.png');
    const b = path.join(tmp, 'actual.png');
    const d = path.join(tmp, 'diff.png');
    await fs.writeFile(a, solidPng(10, 10, 200, 200, 200));
    await fs.writeFile(b, solidPng(16, 10, 200, 200, 200));

    const r = await diffPngs(a, b, d);

    expect(r.dimensionMismatch).toBe(true);
    const decoded = PNG.sync.read(await fs.readFile(d));
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(10);

    for (let y = 0; y < 10; y++) {
      for (let x = 10; x < 16; x++) {
        expect(isMagenta(decoded.data, decoded.width, x, y)).toBe(true);
      }
    }

    expect(r.sizeDelta).toEqual({ width: 6, height: 0 });
  });

  it('identical sizes: sizeDelta is null/undefined and behaviour is unchanged', async () => {
    const tmp = await mkTmp();
    const a = path.join(tmp, 'baseline.png');
    const b = path.join(tmp, 'actual.png');
    const d = path.join(tmp, 'diff.png');
    await fs.writeFile(a, solidPng(10, 10, 200, 200, 200));
    await fs.writeFile(b, solidPng(10, 10, 200, 200, 200));

    const r = await diffPngs(a, b, d);

    expect(r.dimensionMismatch).toBe(false);
    expect(r.diffPercentage).toBe(0);
    expect(r.diffPixels).toBe(0);
    expect(r.diffImagePath).toBe(d);
    expect(r.sizeDelta ?? null).toBeNull();
  });

  it('unwritable diffOutputPath: falls back to no image, contract fields intact, does not throw', async () => {
    const tmp = await mkTmp();
    const a = path.join(tmp, 'baseline.png');
    const b = path.join(tmp, 'actual.png');
    // A regular file standing in where a directory is expected — mkdir(dirname) must fail.
    const blocker = path.join(tmp, 'blocker-file');
    const d = path.join(blocker, 'diff.png');
    await fs.writeFile(a, solidPng(10, 10, 200, 200, 200));
    await fs.writeFile(b, solidPng(10, 14, 200, 200, 200));
    await fs.writeFile(blocker, 'not a directory');

    const r = await diffPngs(a, b, d);

    expect(r.dimensionMismatch).toBe(true);
    expect(r.diffPercentage).toBe(100);
    expect(r.diffPixels).toBe(-1);
    expect(r.totalPixels).toBe(100);
    expect(r.changedRegion).toBeNull();
    expect(r.diffImagePath).toBeNull();
    expect(r.sizeDelta).toEqual({ width: 0, height: 4 });
  });
});
