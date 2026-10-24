/**
 * `visual-check approve` — local baseline approval from a reviewed run.
 *
 * `baseline` recaptures every page and saves the new pictures without
 * anyone looking at them. `approve` instead takes a JSON report from a
 * `run` (or `deploy-gate`/`compare`) that a person has already reviewed,
 * and copies exactly the screenshots in that report into
 * `<out>/baselines/<slug>/<viewport>.png`. What was reviewed is what
 * becomes the baseline.
 *
 * Safety rules:
 * - Only `needs_baseline` targets are approvable by default. `fail`
 *   targets need `--accept-fail`, and only when the pixel diff is the sole
 *   failing check (a 404 page is never a baseline).
 * - `pass`, `warn` and `error` targets are never copied.
 * - An existing baseline is never overwritten silently: a `needs_baseline`
 *   target whose baseline has appeared since the run is skipped, and an
 *   accepted `fail` moves the old baseline to `baselines/.history/` first.
 * - Every approval is appended to `baselines/approvals.jsonl`.
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { urlToSlug } from '../capture.js';
import { UsageError } from '../cli-args.js';
import type { RunReport, TargetResult } from '../types.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ApproveSelection {
  url: string;
  viewport: string;
}

export interface ApproveOptions {
  report: RunReport;
  /** Workspace root; baselines go under `<root>/baselines/`. */
  root: string;
  /** Only these targets; every approvable target when omitted. */
  selected?: ApproveSelection[];
  /** Also accept `fail` targets whose only failing check is the pixel diff. */
  acceptFail?: boolean;
  approvedBy?: string;
  /** Report what would be approved without writing anything. */
  dryRun?: boolean;
  /** Injected for tests. */
  now?: () => Date;
}

export interface ApprovedTarget {
  url: string;
  viewport: string;
  verdict: TargetResult['verdict'];
  source: string;
  baseline: string;
  /** Where the replaced baseline was moved, when there was one. */
  previous: string | null;
  sha256: string;
}

export interface SkippedTarget {
  url: string;
  viewport: string;
  reason: string;
}

export interface ApproveResult {
  approved: ApprovedTarget[];
  skipped: SkippedTarget[];
  /** `<root>/baselines/approvals.jsonl`, or null on a dry run / nothing approved. */
  log: string | null;
}

/** Parse `--select "url@viewport,url@viewport"`. The last `@` splits. */
export function parseApproveSelection(raw: string): ApproveSelection[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new UsageError('--select needs at least one "url@viewport" pair');
  }
  return entries.map((entry) => {
    const at = entry.lastIndexOf('@');
    if (at <= 0 || at === entry.length - 1) {
      throw new UsageError(`Invalid --select entry (want "url@viewport"): ${entry}`);
    }
    return { url: entry.slice(0, at), viewport: entry.slice(at + 1) };
  });
}

/** Throw unless `parsed` has the report fields `approve` relies on. */
export function assertApprovableReport(parsed: unknown, label: string): asserts parsed is RunReport {
  const r = parsed as Partial<RunReport> | null;
  const ok =
    typeof r === 'object' &&
    r !== null &&
    r.schema_version === 1 &&
    Array.isArray(r.results) &&
    r.results.every(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        typeof t.url === 'string' &&
        typeof t.viewport === 'string' &&
        typeof t.verdict === 'string' &&
        typeof t.screenshot === 'string',
    );
  if (!ok) {
    throw new UsageError(
      `${label} is not a Visual Check report (expected schema_version 1 with results that each have url, viewport, verdict and screenshot)`,
    );
  }
}

function sameTarget(a: ApproveSelection, b: ApproveSelection): boolean {
  return a.url === b.url && a.viewport === b.viewport;
}

/** Why this target may not be approved, or null when it may. */
function refusal(t: TargetResult, acceptFail: boolean): string | null {
  switch (t.verdict) {
    case 'needs_baseline':
      return null;
    case 'fail': {
      if (!acceptFail) return 'verdict fail — pass --accept-fail to re-baseline an intentional change';
      const failing = (t.checks ?? []).filter((c) => c.status === 'fail' || c.status === 'error');
      const other = failing.filter((c) => c.name !== 'pixel_diff');
      if (other.length > 0) {
        return `verdict fail on ${other.map((c) => c.name).join(', ')} — only a pixel-diff failure can be re-baselined`;
      }
      return null;
    }
    case 'pass':
    case 'warn':
      return `verdict ${t.verdict} — already matches its baseline`;
    case 'error':
      return 'verdict error — the capture did not complete, so there is nothing to approve';
    default:
      return `unknown verdict ${String(t.verdict)}`;
  }
}

async function readPng(file: string): Promise<Buffer> {
  const buf = await fs.readFile(file);
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  return buf;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** A history path that does not exist yet (never overwrite an older backup). */
async function freeHistoryPath(baselineRoot: string, slug: string, viewport: string, stamp: string): Promise<string> {
  const dir = path.join(baselineRoot, '.history', slug);
  for (let n = 0; ; n++) {
    const candidate = path.join(dir, `${viewport}.${stamp}${n === 0 ? '' : `-${n}`}.png`);
    if (!(await exists(candidate))) return candidate;
  }
}

export async function runApprove(opts: ApproveOptions): Promise<ApproveResult> {
  const now = opts.now ?? (() => new Date());
  const baselineRoot = path.join(path.resolve(opts.root), 'baselines');
  const results = opts.report.results;

  if (opts.selected) {
    const unknown = opts.selected.filter((s) => !results.some((t) => sameTarget(t, s)));
    if (unknown.length > 0) {
      throw new UsageError(
        `--select names target(s) not in the report: ${unknown.map((s) => `${s.url}@${s.viewport}`).join(', ')}`,
      );
    }
  }

  const approved: ApprovedTarget[] = [];
  const skipped: SkippedTarget[] = [];
  const seen: ApproveSelection[] = [];

  for (const t of results) {
    if (opts.selected && !opts.selected.some((s) => sameTarget(t, s))) continue;
    const skip = (reason: string) => skipped.push({ url: t.url, viewport: t.viewport, reason });

    if (seen.some((s) => sameTarget(t, s))) {
      skip('listed twice in the report — approved the first entry only');
      continue;
    }
    seen.push({ url: t.url, viewport: t.viewport });

    const why = refusal(t, opts.acceptFail === true);
    if (why) {
      skip(why);
      continue;
    }

    const slug = urlToSlug(t.url);
    if (!/^[A-Za-z0-9._-]+$/.test(t.viewport) || t.viewport.startsWith('.')) {
      skip(`viewport name "${t.viewport}" is not a safe file name`);
      continue;
    }
    const dest = path.join(baselineRoot, slug, `${t.viewport}.png`);
    const source = path.resolve(t.screenshot);

    let png: Buffer;
    try {
      png = await readPng(source);
    } catch (err) {
      const msg = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'file not found' : (err as Error).message;
      skip(`screenshot ${source}: ${msg}`);
      continue;
    }

    const hasBaseline = await exists(dest);
    if (t.verdict === 'needs_baseline' && hasBaseline) {
      skip(`a baseline appeared at ${dest} after this run — re-run and review again`);
      continue;
    }

    const sha256 = createHash('sha256').update(png).digest('hex');
    let previous: string | null = null;
    if (hasBaseline) {
      previous = await freeHistoryPath(
        baselineRoot,
        slug,
        t.viewport,
        now().toISOString().replace(/[:.]/g, '-'),
      );
    }

    if (!opts.dryRun) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (previous) {
        await fs.mkdir(path.dirname(previous), { recursive: true });
        await fs.rename(dest, previous);
      }
      // COPYFILE_EXCL: if something else wrote a baseline in the meantime,
      // fail instead of clobbering it.
      await fs.copyFile(source, dest, fsConstants.COPYFILE_EXCL);
    }

    approved.push({
      url: t.url,
      viewport: t.viewport,
      verdict: t.verdict,
      source,
      baseline: dest,
      previous,
      sha256,
    });
  }

  let log: string | null = null;
  if (!opts.dryRun && approved.length > 0) {
    log = path.join(baselineRoot, 'approvals.jsonl');
    const at = now().toISOString();
    const lines = approved.map((a) =>
      JSON.stringify({
        approved_at: at,
        approved_by: opts.approvedBy ?? null,
        run_id: opts.report.run_id ?? null,
        url: a.url,
        viewport: a.viewport,
        verdict: a.verdict,
        source: a.source,
        baseline: a.baseline,
        previous: a.previous,
        sha256: a.sha256,
      }),
    );
    await fs.appendFile(log, lines.join('\n') + '\n');
  }

  return { approved, skipped, log };
}
