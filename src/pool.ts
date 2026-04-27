/**
 * Minimal fixed-concurrency promise pool.
 *
 * Keeps the dep surface at zero (no p-limit) and the failure semantics
 * explicit: rejections are surfaced per-item via the result tuple, so
 * one broken capture never aborts the whole run.
 */

export type PoolResult<T> =
  | { ok: true; value: T; index: number }
  | { ok: false; error: Error; index: number };

export async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (result: PoolResult<T>) => void,
): Promise<PoolResult<T>[]> {
  const cap = Math.max(1, Math.floor(concurrency));
  const results: PoolResult<T>[] = new Array(tasks.length);
  let next = 0;

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(cap, tasks.length); w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= tasks.length) return;
          try {
            const value = await tasks[idx]!();
            const r: PoolResult<T> = { ok: true, value, index: idx };
            results[idx] = r;
            onProgress?.(r);
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            const r: PoolResult<T> = { ok: false, error: err, index: idx };
            results[idx] = r;
            onProgress?.(r);
          }
        }
      })(),
    );
  }

  await Promise.all(workers);
  return results;
}
