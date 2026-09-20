import { describe, it, expect } from 'vitest';
import { runPool } from '../src/pool.js';
import type { PoolResult } from '../src/pool.js';

describe('runPool hardening: concurrency sanitisation', () => {
  const badConcurrencies: Array<[string, number]> = [
    ['NaN', NaN],
    ['0', 0],
    ['-3', -3],
    ['undefined', undefined as unknown as number],
    ["'4' (string)", '4' as unknown as number],
  ];

  for (const [label, concurrency] of badConcurrencies) {
    it(`still runs every task when concurrency is ${label}`, async () => {
      const tasks = Array.from({ length: 6 }, (_, i) => async () => i);
      const results = await runPool(tasks, concurrency);
      expect(results).toHaveLength(6);
      expect(results.filter(Boolean).length).toBe(tasks.length);
      expect(results.every((r) => r.ok)).toBe(true);
    });
  }

  it('Infinity runs every task', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const tasks = Array.from({ length: 8 }, () => async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 1));
      inflight--;
      return true;
    });
    const results = await runPool(tasks, Infinity);
    expect(results.filter(Boolean).length).toBe(tasks.length);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(maxInflight).toBe(8);
  });

  it('2.9 caps concurrency at 2 running simultaneously', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return true;
    });
    const results = await runPool(tasks, 2.9);
    expect(results.filter(Boolean).length).toBe(tasks.length);
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxInflight).toBeGreaterThanOrEqual(2);
  });
});

describe('runPool hardening: onProgress isolation', () => {
  it('onProgress throwing on every call never changes stored results and still resolves', async () => {
    const tasks = [
      async () => 1,
      async () => {
        throw new Error('boom');
      },
      async () => 3,
      async () => {
        throw new Error('boom-2');
      },
    ];
    const seenIndexes: number[] = [];
    const results = await runPool(tasks, 2, (r) => {
      seenIndexes.push(r.index);
      throw new Error('progress callback always throws');
    });

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ ok: true, value: 1, index: 0 });
    expect(results[1]!.ok).toBe(false);
    if (!results[1]!.ok) expect(results[1]!.error.message).toBe('boom');
    expect(results[2]).toEqual({ ok: true, value: 3, index: 2 });
    expect(results[3]!.ok).toBe(false);
    if (!results[3]!.ok) expect(results[3]!.error.message).toBe('boom-2');

    expect(seenIndexes.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('onProgress throwing only for failures still resolves and lets later tasks run', async () => {
    const tasks = [
      async () => 1,
      async () => {
        throw new Error('fails');
      },
      async () => 3,
    ];
    const seenIndexes: number[] = [];
    const results = await runPool(tasks, 1, (r) => {
      seenIndexes.push(r.index);
      if (!r.ok) throw new Error('progress throws on failure');
    });

    expect(results).toHaveLength(3);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect(results[2]!.ok).toBe(true);
    expect(seenIndexes).toEqual([0, 1, 2]);
  });
});

describe('runPool hardening: malformed tasks', () => {
  it('a task that throws synchronously becomes an ok:false result', async () => {
    const tasks = [
      async () => 1,
      () => {
        throw new Error('sync throw');
      },
      async () => 3,
    ];
    const results = await runPool(tasks as Array<() => Promise<number>>, 2);
    expect(results).toHaveLength(3);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    if (!results[1]!.ok) expect(results[1]!.error.message).toBe('sync throw');
    expect(results[2]!.ok).toBe(true);
  });

  it('a task that rejects with a string is wrapped in an Error', async () => {
    const tasks = [async () => {
      // eslint-disable-next-line prefer-promise-reject-errors
      return Promise.reject('string rejection');
    }];
    const results = await runPool(tasks, 1);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    if (!results[0]!.ok) {
      expect(results[0]!.error).toBeInstanceOf(Error);
      expect(results[0]!.error.message).toBe('string rejection');
    }
  });

  it('a non-function entry becomes an ok:false result and never rejects the pool', async () => {
    const tasks = [async () => 1, 'not-a-function' as unknown as () => Promise<number>, async () => 3];
    const results = await runPool(tasks, 3);
    expect(results).toHaveLength(3);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect(results[2]!.ok).toBe(true);
  });
});

describe('runPool hardening: ordering at scale', () => {
  it('50 tasks with concurrency 7 keep index order in the results array', async () => {
    const tasks = Array.from({ length: 50 }, (_, i) => async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      return i;
    });
    const results: PoolResult<number>[] = await runPool(tasks, 7);
    expect(results).toHaveLength(50);
    expect(results.filter(Boolean).length).toBe(50);
    results.forEach((r, i) => {
      expect(r.index).toBe(i);
      if (r.ok) expect(r.value).toBe(i);
    });
  });
});
