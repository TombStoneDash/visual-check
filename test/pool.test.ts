import { describe, it, expect } from 'vitest';
import { runPool } from '../src/pool.js';

describe('runPool', () => {
  it('runs all tasks and preserves order of results', async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => async () => i * 2);
    const results = await runPool(tasks, 3);
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.ok)).toBe(true);
    results.forEach((r, i) => {
      if (r.ok) expect(r.value).toBe(i * 2);
    });
  });

  it('respects concurrency cap', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return 1;
    });
    await runPool(tasks, 4);
    expect(maxInflight).toBeLessThanOrEqual(4);
    expect(maxInflight).toBeGreaterThanOrEqual(2);
  });

  it('captures individual rejections without aborting others', async () => {
    const tasks = [
      async () => 1,
      async () => {
        throw new Error('nope');
      },
      async () => 3,
    ];
    const results = await runPool(tasks, 2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect(results[2]!.ok).toBe(true);
    if (!results[1]!.ok) expect(results[1]!.error.message).toBe('nope');
  });

  it('handles empty task list', async () => {
    const r = await runPool([], 3);
    expect(r).toEqual([]);
  });

  it('works with concurrency > task count', async () => {
    const tasks = [async () => 'a', async () => 'b'];
    const r = await runPool(tasks, 100);
    expect(r.map((x) => (x.ok ? x.value : null))).toEqual(['a', 'b']);
  });

  it('calls onProgress per completion', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => async () => i);
    const seen: number[] = [];
    await runPool(tasks, 2, (r) => {
      if (r.ok) seen.push(r.value);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});
