import { DEFAULT_VIEWPORTS, ViewportSpec } from './types.js';

export class UsageError extends Error {
  override name = 'UsageError';
}

export function parseUrls(raw: string): string[] {
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) throw new UsageError('No URLs were given.');
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of entries) {
    const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(entry) ? entry : `https://${entry}`;
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new UsageError(`Invalid --urls entry: ${entry} (expected an http:// or https:// address)`);
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '') {
      throw new UsageError(`Invalid --urls entry: ${entry} (expected an http:// or https:// address)`);
    }
    const key = parsed.href;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(normalized);
  }
  return urls;
}

const VIEWPORT_TOKEN_RE = /^([^:]+):(\d+)x(\d+)$/;

/**
 * Parse `--viewports`. Each comma token is either a known viewport name
 * (`desktop`, keeps the DEFAULT_VIEWPORTS size) or `name:WIDTHxHEIGHT`
 * (`desktop:1280x800`, a known name at a custom size). Order follows
 * DEFAULT_VIEWPORTS; a name repeated at two different sizes is an error.
 */
export function parseViewports(raw: string | undefined): ViewportSpec[] {
  if (raw === undefined) return DEFAULT_VIEWPORTS;
  const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = DEFAULT_VIEWPORTS.map((v) => v.name);
  if (tokens.length === 0) {
    throw new UsageError(`No viewports were given. Valid names: ${valid.join(', ')}`);
  }
  const byName = new Map<string, ViewportSpec>();
  const unknown: string[] = [];
  for (const token of tokens) {
    const match = VIEWPORT_TOKEN_RE.exec(token);
    const name = match ? match[1]! : token;
    const def = DEFAULT_VIEWPORTS.find((v) => v.name === name);
    if (!def) {
      unknown.push(token);
      continue;
    }
    const width = match ? Number(match[2]) : def.width;
    const height = match ? Number(match[3]) : def.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new UsageError(
        `Invalid viewport size: ${token} (expected ${name}:WIDTHxHEIGHT with positive integers)`,
      );
    }
    const spec: ViewportSpec = { name, width, height };
    const previous = byName.get(name);
    if (previous && (previous.width !== width || previous.height !== height)) {
      throw new UsageError(
        `Viewport "${name}" was given twice with different sizes: ${formatViewportToken(previous)} and ${token}`,
      );
    }
    byName.set(name, spec);
  }
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown viewports: ${unknown.join(', ')}. Valid names: ${valid.join(', ')} (optionally name:WIDTHxHEIGHT, e.g. desktop:1280x800)`,
    );
  }
  return DEFAULT_VIEWPORTS.filter((v) => byName.has(v.name)).map((v) => byName.get(v.name)!);
}

/** Inverse of parseViewports for one spec: `name` at the default size, `name:WxH` otherwise. */
export function formatViewportToken(spec: ViewportSpec): string {
  const def = DEFAULT_VIEWPORTS.find((v) => v.name === spec.name);
  if (def && def.width === spec.width && def.height === spec.height) return spec.name;
  return `${spec.name}:${spec.width}x${spec.height}`;
}

const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function parseNumberOption(
  flag: string,
  raw: string,
  rule: { min?: number; max?: number; integer?: boolean; exclusiveMin?: boolean },
): number {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (
    // Plain decimal only: Number() alone also accepts 0x10, 0b11 and 0o7.
    !DECIMAL_RE.test(trimmed) || !Number.isFinite(value) ||
    (rule.integer && !Number.isInteger(value)) ||
    (rule.min !== undefined && (rule.exclusiveMin ? value <= rule.min : value < rule.min)) ||
    (rule.max !== undefined && value > rule.max)
  ) {
    const expected = [
      rule.integer ? 'a finite integer' : 'a finite number',
      ...(rule.min === undefined ? [] : [`${rule.exclusiveMin ? '>' : '>='} ${rule.min}`]),
      ...(rule.max === undefined ? [] : [`<= ${rule.max}`]),
    ].join(' ');
    throw new UsageError(`Invalid ${flag}: ${raw} (expected ${expected})`);
  }
  return value;
}
