import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

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
    return {
      diffPercentage: 100,
      diffPixels: -1,
      totalPixels: baseline.width * baseline.height,
      diffImagePath: null,
      dimensionMismatch: true,
      baselineDimensions,
      actualDimensions,
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
