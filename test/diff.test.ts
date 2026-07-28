import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { diffPngs, fileExists } from '../src/diff.js';

const tmp = path.resolve('test-tmp-diff');

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

function patchedPng(
  w: number,
  h: number,
  bgR: number,
  bgG: number,
  bgB: number,
  patchW: number,
  patchH: number,
): Buffer {
  const png = PNG.sync.read(solidPng(w, h, bgR, bgG, bgB));
  for (let y = 0; y < patchH; y++) {
    for (let x = 0; x < patchW; x++) {
      const idx = (y * w + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

beforeAll(async () => {
  await fs.mkdir(tmp, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('diffPngs', () => {
  it('returns 0% for identical images', async () => {
    const a = path.join(tmp, 'a.png');
    const b = path.join(tmp, 'b.png');
    const d = path.join(tmp, 'da.png');
    await fs.writeFile(a, solidPng(50, 50, 200, 200, 200));
    await fs.writeFile(b, solidPng(50, 50, 200, 200, 200));
    const r = await diffPngs(a, b, d);
    expect(r.diffPercentage).toBe(0);
    expect(r.diffPixels).toBe(0);
    expect(r.dimensionMismatch).toBe(false);
  });

  it('returns the right percentage for known-size patch', async () => {
    const a = path.join(tmp, 'a2.png');
    const b = path.join(tmp, 'b2.png');
    const d = path.join(tmp, 'd2.png');
    await fs.writeFile(a, solidPng(100, 100, 200, 200, 200));
    // 10×10 red patch on 100×100 = 100/10000 = 1%
    await fs.writeFile(b, patchedPng(100, 100, 200, 200, 200, 10, 10));
    const r = await diffPngs(a, b, d);
    expect(r.diffPercentage).toBeCloseTo(1.0, 2);
    expect(r.diffPixels).toBe(100);
  });

  it('flags dimension mismatch as 100% diff', async () => {
    const a = path.join(tmp, 'a3.png');
    const b = path.join(tmp, 'b3.png');
    const d = path.join(tmp, 'd3.png');
    await fs.writeFile(a, solidPng(100, 100, 200, 200, 200));
    await fs.writeFile(b, solidPng(50, 50, 200, 200, 200));
    const r = await diffPngs(a, b, d);
    expect(r.dimensionMismatch).toBe(true);
    expect(r.diffPercentage).toBe(100);
    expect(r.baselineDimensions).toEqual({ width: 100, height: 100 });
    expect(r.actualDimensions).toEqual({ width: 50, height: 50 });
  });

  it('writes a diff image file', async () => {
    const a = path.join(tmp, 'a4.png');
    const b = path.join(tmp, 'b4.png');
    const d = path.join(tmp, 'd4.png');
    await fs.writeFile(a, solidPng(50, 50, 200, 200, 200));
    await fs.writeFile(b, patchedPng(50, 50, 200, 200, 200, 5, 5));
    await diffPngs(a, b, d);
    const stat = await fs.stat(d);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('computes the bounding box of the changed region for a known patch', async () => {
    const a = path.join(tmp, 'a5.png');
    const b = path.join(tmp, 'b5.png');
    const d = path.join(tmp, 'd5.png');
    await fs.writeFile(a, solidPng(100, 100, 200, 200, 200));
    // Patch occupies pixels [0..9] x [0..9] (top-left corner).
    await fs.writeFile(b, patchedPng(100, 100, 200, 200, 200, 10, 10));
    const r = await diffPngs(a, b, d);
    expect(r.changedRegion).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('returns a null changed region for identical images', async () => {
    const a = path.join(tmp, 'a6.png');
    const b = path.join(tmp, 'b6.png');
    const d = path.join(tmp, 'd6.png');
    await fs.writeFile(a, solidPng(20, 20, 10, 10, 10));
    await fs.writeFile(b, solidPng(20, 20, 10, 10, 10));
    const r = await diffPngs(a, b, d);
    expect(r.changedRegion).toBeNull();
  });

  it('returns a null changed region on dimension mismatch', async () => {
    const a = path.join(tmp, 'a7.png');
    const b = path.join(tmp, 'b7.png');
    const d = path.join(tmp, 'd7.png');
    await fs.writeFile(a, solidPng(100, 100, 200, 200, 200));
    await fs.writeFile(b, solidPng(50, 50, 200, 200, 200));
    const r = await diffPngs(a, b, d);
    expect(r.changedRegion).toBeNull();
  });
});

describe('fileExists', () => {
  it('returns true for existing file', async () => {
    const p = path.join(tmp, 'exists.png');
    await fs.writeFile(p, solidPng(10, 10, 0, 0, 0));
    expect(await fileExists(p)).toBe(true);
  });
  it('returns false for missing file', async () => {
    expect(await fileExists(path.join(tmp, 'nope.png'))).toBe(false);
  });
});
