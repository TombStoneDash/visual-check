import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ChangedRegion } from './types.js';

export interface DiffResult {
  /** 0–100 percentage of pixels that differ */
  diffPercentage: number;
  diffPixels: number;
  totalPixels: number;
  diffImagePath: string | null;
  /** True if baseline vs actual dimensions didn't match — forces fail */
  dimensionMismatch: boolean;
  baselineDimensions: { width: number; height: number };
  actualDimensions: { width: number; height: number };
  /** Bounding box of the differing pixels, in baseline pixel coordinates.
   *  Null when there is no diff, or dimensions didn't match (no
   *  pixel-aligned comparison was possible). */
  changedRegion?: ChangedRegion | null;
  /** actual minus baseline, in pixels. Null/undefined when sizes match. */
  sizeDelta?: { width: number; height: number } | null;
}

/** Refuse to allocate a diff canvas larger than this many pixels. */
const MAX_DIFF_CANVAS_PIXELS = 60_000_000;

/**
 * Copy `src` onto a `width`x`height` transparent canvas, anchored at the
 * top-left. Used to pad both images to the same size before diffing when
 * their dimensions don't match.
 */
function padToCanvas(src: PNG, width: number, height: number): PNG {
  const padded = new PNG({ width, height });
  PNG.bitblt(src, padded, 0, 0, Math.min(src.width, width), Math.min(src.height, height), 0, 0);
  return padded;
}

/**
 * Build a best-effort diff image for a dimension mismatch: pads both images
 * onto a shared max(width) x max(height) canvas, runs pixelmatch over the
 * padded pair, then paints every pixel that only exists in one of the two
 * original images (the grown/shrunk band) solid magenta so it's obvious
 * what changed. Returns null (never throws) if the image can't be built.
 */
async function writeMismatchDiffImage(
  baseline: PNG,
  actual: PNG,
  diffOutputPath: string,
  opts: DiffOptions,
): Promise<string | null> {
  try {
    const width = Math.max(baseline.width, actual.width);
    const height = Math.max(baseline.height, actual.height);
    if (width * height > MAX_DIFF_CANVAS_PIXELS) return null;

    const paddedBaseline = padToCanvas(baseline, width, height);
    const paddedActual = padToCanvas(actual, width, height);
    const diff = new PNG({ width, height });
    pixelmatch(
      paddedBaseline.data,
      paddedActual.data,
      diff.data,
      width,
      height,
      {
        threshold: opts.threshold ?? 0.1,
        includeAA: opts.includeAA ?? false,
      },
    );

    for (let y = 0; y < height; y++) {
      const inBaselineRow = y < baseline.height;
      const inActualRow = y < actual.height;
      for (let x = 0; x < width; x++) {
        const inBaseline = inBaselineRow && x < baseline.width;
        const inActual = inActualRow && x < actual.width;
        if (inBaseline !== inActual) {
          const i = (y * width + x) << 2;
          diff.data[i] = 255;
          diff.data[i + 1] = 0;
          diff.data[i + 2] = 255;
          diff.data[i + 3] = 255;
        }
      }
    }

    await fs.mkdir(path.dirname(diffOutputPath), { recursive: true });
    await fs.writeFile(diffOutputPath, PNG.sync.write(diff));
    return diffOutputPath;
  } catch {
    return null;
  }
}

/**
 * Scan a pixelmatch diff image for its bounding box of "real difference"
 * pixels (pixelmatch draws these using its exact `diffColor`, default
 * opaque red). Anti-aliasing-only pixels are drawn in a different color
 * and are intentionally excluded, matching the `diffPixels` count.
 */
function boundingBoxOfDiffPixels(diffImage: PNG, width: number, height: number): ChangedRegion | null {
  const { data } = diffImage;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const i = (rowOffset + x) * 4;
      if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export interface DiffOptions {
  /** pixelmatch per-pixel threshold, 0–1. Lower is stricter. Default 0.1. */
  threshold?: number;
  /** Include anti-aliasing differences in diff count. Default false. */
  includeAA?: boolean;
}

/**
 * Diff two PNG files and emit a diff image.
 *
 * Returns a structured result; callers decide whether the percentage
 * exceeds their threshold for a fail verdict.
 */
export async function diffPngs(
  baselinePath: string,
  actualPath: string,
  diffOutputPath: string,
  opts: DiffOptions = {},
): Promise<DiffResult> {
  const [baselineBuf, actualBuf] = await Promise.all([
    fs.readFile(baselinePath),
    fs.readFile(actualPath),
  ]);

  const baseline = PNG.sync.read(baselineBuf);
  const actual = PNG.sync.read(actualBuf);

  const baselineDimensions = { width: baseline.width, height: baseline.height };
  const actualDimensions = { width: actual.width, height: actual.height };

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    const diffImagePath = await writeMismatchDiffImage(baseline, actual, diffOutputPath, opts);
    return {
      diffPercentage: 100,
      diffPixels: -1,
      totalPixels: baseline.width * baseline.height,
      diffImagePath,
      dimensionMismatch: true,
      baselineDimensions,
      actualDimensions,
      changedRegion: null,
      sizeDelta: {
        width: actual.width - baseline.width,
        height: actual.height - baseline.height,
      },
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    baseline.data,
    actual.data,
    diff.data,
    width,
    height,
    {
      threshold: opts.threshold ?? 0.1,
      includeAA: opts.includeAA ?? false,
    },
  );
  const totalPixels = width * height;
  const diffPercentage = (diffPixels / totalPixels) * 100;
  const changedRegion = diffPixels > 0 ? boundingBoxOfDiffPixels(diff, width, height) : null;

  await fs.mkdir(path.dirname(diffOutputPath), { recursive: true });
  await fs.writeFile(diffOutputPath, PNG.sync.write(diff));

  return {
    diffPercentage,
    diffPixels,
    totalPixels,
    diffImagePath: diffOutputPath,
    dimensionMismatch: false,
    baselineDimensions,
    actualDimensions,
    changedRegion,
  };
}

/**
 * Check whether a file exists without throwing.
 */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
