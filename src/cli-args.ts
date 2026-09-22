import { DEFAULT_VIEWPORTS, ViewportSpec } from './types.js';

export class UsageError extends Error {
  override name = 'UsageError';
}

export function parseUrls(raw: string): string[] {
  const urls = raw.split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => (/^https?:\/\//.test(s) ? s : `https://${s}`));
  if (urls.length === 0) throw new UsageError('No URLs were given.');
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
