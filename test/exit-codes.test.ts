import { describe, expect, it } from 'vitest';
import { describeExitCode, exitCodeFor, VERDICT_EXIT_CODES } from '../src/exit-codes.js';

describe('VERDICT_EXIT_CODES', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(VERDICT_EXIT_CODES)).toBe(true);
    expect(() => {
      (VERDICT_EXIT_CODES as Record<string, number>).pass = 99;
    }).toThrow();
    expect(VERDICT_EXIT_CODES.pass).toBe(0);
  });

  it('maps every verdict to its documented code', () => {
    expect(VERDICT_EXIT_CODES).toEqual({
      pass: 0,
      warn: 0,
      needs_baseline: 2,
      fail: 1,
      error: 3,
    });
  });
});

describe('exitCodeFor', () => {
  it('returns 0 for pass', () => {
    expect(exitCodeFor('pass')).toBe(0);
  });

  it('returns 0 for warn by default', () => {
    expect(exitCodeFor('warn')).toBe(0);
  });

  it('returns 2 for needs_baseline', () => {
    expect(exitCodeFor('needs_baseline')).toBe(2);
  });

  it('returns 1 for fail', () => {
    expect(exitCodeFor('fail')).toBe(1);
  });

  it('returns 3 for error', () => {
    expect(exitCodeFor('error')).toBe(3);
  });

  it('returns 1 for warn when strictWarn is set', () => {
    expect(exitCodeFor('warn', { strictWarn: true })).toBe(1);
  });

  it('does not change non-warn verdicts when strictWarn is set', () => {
    expect(exitCodeFor('pass', { strictWarn: true })).toBe(0);
    expect(exitCodeFor('fail', { strictWarn: true })).toBe(1);
    expect(exitCodeFor('needs_baseline', { strictWarn: true })).toBe(2);
    expect(exitCodeFor('error', { strictWarn: true })).toBe(3);
  });

  it('returns 3 for an unknown verdict string', () => {
    expect(exitCodeFor('bogus')).toBe(3);
    expect(exitCodeFor('')).toBe(3);
  });

  it('returns 3 for an unknown verdict even with strictWarn', () => {
    expect(exitCodeFor('bogus', { strictWarn: true })).toBe(3);
  });
});

describe('describeExitCode', () => {
  it('describes each documented exit code in one line', () => {
    for (const code of [0, 1, 2, 3]) {
      const description = describeExitCode(code);
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
      expect(description).not.toContain('\n');
    }
  });

  it('falls back gracefully for an unrecognized code', () => {
    expect(describeExitCode(42)).toBeTruthy();
  });
});
