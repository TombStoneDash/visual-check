/**
 * Minimal fixed-concurrency promise pool.
 *
 * Keeps the dep surface at zero (no p-limit) and the failure semantics
 * explicit: rejections are surfaced per-item via the result tuple, so
 * one broken capture never aborts the whole run.
 *
 * Guarantees:
 * - `concurrency` is sanitised: anything that is not a finite number >= 1
 *   (NaN, 0, negative, non-numbers from plain-JS callers) becomes 1;
 *   `Infinity` runs every task at once.
 * - the returned array always has exactly `tasks.length` entries, one per
 *   task, in task order -- there are never empty slots.
 * - a task entry that is not a function, or that throws synchronously
 *   instead of returning a promise, still produces an `{ ok: false }`
 *   result for that index and never rejects the pool; non-`Error`
 *   rejections are wrapped with `new Error(String(e))`.
 * - the per-task result is computed and stored before `onProgress` is
 *   invoked, and `onProgress` is called exactly once per task inside its
 *   own try/catch, so a throwing `onProgress` can never change the
 *   stored result and can never abort the pool.
 */

export type PoolResult<T> =
  | { ok: true; value: T; index: number }
  | { ok: false; error: Error; index: number };

function sanitizeConcurrency(concurrency: number, taskCount: number): number {
  if (typeof concurrency !== 'number') return 1;
  if (concurrency === Infinity) return taskCount;
  if (!Number.isFinite(concurrency)) return 1;
  const floored = Math.floor(concurrency);
  return floored >= 1 ? floored : 1;
}

async function runTask<T>(task: () => Promise<T>): Promise<T> {
  if (typeof task !== 'function') {
    throw new Error('pool task is not a function');
  }
  return task();
}

function reportProgress<T>(
  onProgress: ((result: PoolResult<T>) => void) | undefined,
  result: PoolResult<T>,
): void {
  if (!onProgress) return;
  try {
    onProgress(result);
  } catch {
    // Swallowed intentionally: a throwing progress callback must never
    // change the stored result or abort the pool.
  }
}

export async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (result: PoolResult<T>) => void,
): Promise<PoolResult<T>[]> {
  const cap = sanitizeConcurrency(concurrency, tasks.length);
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
            const value = await runTask(tasks[idx]!);
            const r: PoolResult<T> = { ok: true, value, index: idx };
            results[idx] = r;
            reportProgress(onProgress, r);
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            const r: PoolResult<T> = { ok: false, error: err, index: idx };
            results[idx] = r;
            reportProgress(onProgress, r);
          }
        }
      })(),
    );
  }

  await Promise.all(workers);
  return results;
}
