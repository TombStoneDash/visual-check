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

export function parseViewports(raw: string | undefined): ViewportSpec[] {
  if (raw === undefined) return DEFAULT_VIEWPORTS;
  const wanted = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  const valid = DEFAULT_VIEWPORTS.map((v) => v.name);
  const unknown = wanted.filter((name) => !valid.includes(name));
  if (unknown.length > 0 || wanted.length === 0) {
    throw new UsageError(
      `${unknown.length ? `Unknown viewports: ${unknown.join(', ')}.` : 'No viewports were given.'} Valid names: ${valid.join(', ')}`,
    );
  }
  return DEFAULT_VIEWPORTS.filter((v) => wanted.includes(v.name));
}

export function parseNumberOption(
  flag: string,
  raw: string,
  rule: { min?: number; max?: number; integer?: boolean; exclusiveMin?: boolean },
): number {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (
    trimmed === '' || !Number.isFinite(value) ||
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
