// Smoke test for src/diff.ts — no browser required.
// Creates two synthetic PNGs (identical, then a small red patch) and
// verifies pixelmatch percentages land where we expect.
import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { diffPngs } from '../dist/diff.js';

const tmp = path.resolve('smoke-tmp');
await fs.mkdir(tmp, { recursive: true });

function solidPng(w, h, r, g, b, a = 255) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

function patchedPng(w, h, r, g, b, patchW, patchH) {
  const png = PNG.sync.read(solidPng(w, h, r, g, b));
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

// Case 1: identical images → 0% diff
const baseline = path.join(tmp, 'base.png');
const actualSame = path.join(tmp, 'same.png');
const diffSame = path.join(tmp, 'diff-same.png');
await fs.writeFile(baseline, solidPng(100, 100, 200, 200, 200));
await fs.writeFile(actualSame, solidPng(100, 100, 200, 200, 200));
const r1 = await diffPngs(baseline, actualSame, diffSame);
console.log('Case 1 (identical):', {
  diffPercentage: r1.diffPercentage,
  diffPixels: r1.diffPixels,
});
if (r1.diffPercentage !== 0) { console.error('FAIL: expected 0%'); process.exit(1); }

// Case 2: 10×10 red patch on a 100×100 canvas → 100/10000 = 1%
const actualPatched = path.join(tmp, 'patched.png');
const diffPatched = path.join(tmp, 'diff-patched.png');
await fs.writeFile(actualPatched, patchedPng(100, 100, 200, 200, 200, 10, 10));
const r2 = await diffPngs(baseline, actualPatched, diffPatched);
console.log('Case 2 (1% patch):', {
  diffPercentage: r2.diffPercentage.toFixed(3),
  diffPixels: r2.diffPixels,
});
if (Math.abs(r2.diffPercentage - 1.0) > 0.01) {
  console.error('FAIL: expected ~1%, got', r2.diffPercentage);
  process.exit(1);
}

// Case 3: dimension mismatch
const smaller = path.join(tmp, 'smaller.png');
const diffDim = path.join(tmp, 'diff-dim.png');
await fs.writeFile(smaller, solidPng(50, 50, 200, 200, 200));
const r3 = await diffPngs(baseline, smaller, diffDim);
console.log('Case 3 (dim mismatch):', {
  dimensionMismatch: r3.dimensionMismatch,
  diffPercentage: r3.diffPercentage,
});
if (!r3.dimensionMismatch) { console.error('FAIL: expected dimensionMismatch'); process.exit(1); }

// Verify diff image was emitted for Case 2
const diffStat = await fs.stat(diffPatched);
if (diffStat.size <= 0) { console.error('FAIL: diff image empty'); process.exit(1); }
console.log('Case 2 diff image:', diffStat.size, 'bytes');

// Cleanup
await fs.rm(tmp, { recursive: true, force: true });
console.log('\n✓ diff engine smoke test PASSED');
