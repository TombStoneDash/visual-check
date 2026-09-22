import { describe, expect, it } from 'vitest';
import { parseNumberOption, parseUrls, parseViewports, UsageError } from '../src/cli-args.js';
import { DEFAULT_VIEWPORTS } from '../src/types.js';

describe('parseUrls', () => {
  it('trims, ignores empty entries, and defaults bare hosts to HTTPS', () => {
    expect(parseUrls(' example.com, http://local.test, https://secure.test, ')).toEqual([
      'https://example.com', 'http://local.test', 'https://secure.test',
    ]);
  });
  it.each(['', ',', '   ', ' , , '])('rejects an empty list %j', (raw) => {
    expect(() => parseUrls(raw)).toThrow(UsageError);
    expect(() => parseUrls(raw)).toThrow('No URLs were given.');
  });
});

describe('parseViewports', () => {
  it('defaults to all viewports', () => {
    expect(parseViewports(undefined)).toEqual(DEFAULT_VIEWPORTS);
  });
  it('deduplicates and preserves default order', () => {
    expect(parseViewports('desktop, mobile,desktop').map((v) => v.name)).toEqual(['mobile', 'desktop']);
  });
  it('accepts a single viewport', () => {
    expect(parseViewports(' tablet ')).toEqual([DEFAULT_VIEWPORTS[1]]);
  });
  it.each(['dekstop,phone', 'mobile,dekstop,phone'])('names every unknown and all valid names: %s', (raw) => {
    expect(() => parseViewports(raw)).toThrow(UsageError);
    expect(() => parseViewports(raw)).toThrow('Unknown viewports: dekstop, phone. Valid names: mobile, tablet, desktop');
  });
  it.each(['', ',', '   '])('rejects empty selection %j', (raw) => {
    expect(() => parseViewports(raw)).toThrow(UsageError);
  });
});

describe('parseNumberOption', () => {
  it.each(['0', ' 5.5 ', '100'])('accepts threshold %j', (raw) => {
    expect(parseNumberOption('--threshold', raw, { min: 0, max: 100 })).toBe(Number(raw));
  });
  it.each(['5abc', '', '   ', 'NaN', 'Infinity', '-Infinity', '-1', '101'])('rejects threshold %j', (raw) => {
    const parse = () => parseNumberOption('--threshold', raw, { min: 0, max: 100 });
    expect(parse).toThrow(UsageError);
    expect(parse).toThrow(`Invalid --threshold: ${raw} (expected a finite number >= 0 <= 100)`);
  });
  it.each(['1', '16'])('accepts concurrency boundary %s', (raw) => {
    expect(parseNumberOption('--concurrency', raw, { min: 1, max: 16, integer: true })).toBe(Number(raw));
  });
  it.each(['0', '17', '1.5'])('rejects concurrency %s', (raw) => {
    expect(() => parseNumberOption('--concurrency', raw, { min: 1, max: 16, integer: true })).toThrow(UsageError);
  });
  it.each(['--load-time-warn', '--signed-url-ttl'])('requires a positive integer for %s', (flag) => {
    const rule = { min: 0, exclusiveMin: true, integer: true };
    expect(parseNumberOption(flag, ' 1 ', rule)).toBe(1);
    for (const raw of ['0', '-1', '1.5', '5abc']) {
      expect(() => parseNumberOption(flag, raw, rule)).toThrow(UsageError);
    }
  });
});
