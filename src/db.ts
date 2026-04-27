/**
 * Supabase Postgres wrapper — Phase 2.
 *
 * Uses PostgREST directly via `fetch` so we do not add a runtime
 * dependency. Tests stub global `fetch`.
 */
import { BaselineLane, RunReport, TargetResult } from './types.js';

export interface BaselineRow {
  id: string;
  project_id: string;
  url: string;
  viewport: string;
  lane_os: BaselineLane['os'];
  lane_runner: BaselineLane['runner'];
  storage_path: string;
  approved: boolean;
  approved_by: string | null;
  approved_at: string;
  run_id: string | null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function supabaseUrl(): string {
  return requireEnv('SUPABASE_URL').replace(/\/+$/, '');
}

function serviceKey(): string {
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY');
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = serviceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function rest(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const url = `${supabaseUrl()}/rest/v1${path}`;
  const res = await fetch(url, {
    method: init.method,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
    body: init.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST ${init.method} ${path} failed: ${res.status} ${text}`);
  }
  return res;
}

/**
 * Insert the run-level row. Idempotent via upsert on primary key.
 */
export async function insertRun(
  run: RunReport,
  projectId: string,
  htmlReportPath: string | null,
): Promise<void> {
  const row = {
    id: run.run_id,
    project_id: projectId,
    deployment_url: run.deploymentUrl ?? '',
    branch: run.branch ?? null,
    commit_sha: run.commitSha ?? null,
    verdict: deriveRunVerdict(run),
    summary: run.summary,
    config: run.config,
    html_report_path: htmlReportPath,
    finished_at: new Date().toISOString(),
  };
  await rest('/visual_check_runs', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
}

/**
 * Insert one row per target result. All inserts share the run id so a
 * single POST with an array is a single DB round-trip.
 */
export async function insertResults(
  runId: string,
  results: TargetResult[],
  storageKeys?: {
    screenshots?: Record<string, string>;
    diffs?: Record<string, string>;
    baselines?: Record<string, string>;
  },
): Promise<void> {
  if (results.length === 0) return;
  const rows = results.map((r) => {
    const k = `${r.url}|${r.viewport}`;
    return {
      run_id: runId,
      url: r.url,
      viewport: r.viewport,
      verdict: r.verdict,
      diff_percentage: r.diff_percentage,
      load_time_ms: r.load_time_ms,
      console_errors: r.console_errors,
      http_status: r.status,
      screenshot_path: storageKeys?.screenshots?.[k] ?? null,
      baseline_path: storageKeys?.baselines?.[k] ?? null,
      diff_image_path: storageKeys?.diffs?.[k] ?? null,
      checks: r.checks,
      reasons: r.reasons,
    };
  });
  await rest('/visual_check_results', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
}

/**
 * Mark prior approved baselines for (project, url, viewport, lane) as
 * unapproved, then insert the new one. The uniqueness constraint on the
 * table is (project, url, viewport, lane_os, lane_runner, approved) so
 * we cannot leave two approved rows behind.
 */
export async function upsertBaseline(
  projectId: string,
  url: string,
  viewport: string,
  lane: BaselineLane,
  storagePath: string,
  runId: string,
  approvedBy?: string,
): Promise<void> {
  // Deactivate existing active baseline for this target, if any.
  const deactivateQuery = [
    `project_id=eq.${encodeURIComponent(projectId)}`,
    `url=eq.${encodeURIComponent(url)}`,
    `viewport=eq.${encodeURIComponent(viewport)}`,
    `lane_os=eq.${encodeURIComponent(lane.os)}`,
    `lane_runner=eq.${encodeURIComponent(lane.runner)}`,
    `approved=eq.true`,
  ].join('&');
  await rest(`/visual_check_baselines?${deactivateQuery}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ approved: false }),
  });

  // Insert the new approved row.
  await rest('/visual_check_baselines', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      project_id: projectId,
      url,
      viewport,
      lane_os: lane.os,
      lane_runner: lane.runner,
      storage_path: storagePath,
      approved: true,
      approved_by: approvedBy ?? null,
      run_id: runId,
    }),
  });
}

export async function getActiveBaseline(
  projectId: string,
  url: string,
  viewport: string,
  lane: BaselineLane,
): Promise<BaselineRow | null> {
  const q = [
    `project_id=eq.${encodeURIComponent(projectId)}`,
    `url=eq.${encodeURIComponent(url)}`,
    `viewport=eq.${encodeURIComponent(viewport)}`,
    `lane_os=eq.${encodeURIComponent(lane.os)}`,
    `lane_runner=eq.${encodeURIComponent(lane.runner)}`,
    `approved=eq.true`,
    `limit=1`,
  ].join('&');
  const res = await rest(`/visual_check_baselines?${q}`, { method: 'GET' });
  const rows = (await res.json()) as BaselineRow[];
  return rows.length > 0 ? rows[0]! : null;
}

/**
 * Pull a run + its per-target results. Used by `promote` so we can find
 * the passed targets and their screenshot storage keys.
 */
export async function getRun(
  runId: string,
): Promise<{ run: {
  id: string;
  project_id: string;
  verdict: string;
  config: RunReport['config'];
  html_report_path: string | null;
}; results: Array<{
  url: string;
  viewport: string;
  verdict: string;
  screenshot_path: string | null;
}> } | null> {
  const runRes = await rest(
    `/visual_check_runs?id=eq.${encodeURIComponent(runId)}&limit=1`,
    { method: 'GET' },
  );
  const runRows = (await runRes.json()) as Array<{
    id: string;
    project_id: string;
    verdict: string;
    config: RunReport['config'];
    html_report_path: string | null;
  }>;
  if (runRows.length === 0) return null;
  const resultsRes = await rest(
    `/visual_check_results?run_id=eq.${encodeURIComponent(runId)}`,
    { method: 'GET' },
  );
  const results = (await resultsRes.json()) as Array<{
    url: string;
    viewport: string;
    verdict: string;
    screenshot_path: string | null;
  }>;
  return { run: runRows[0]!, results };
}

function deriveRunVerdict(run: RunReport): string {
  const s = run.summary;
  if (s.errors > 0) return 'error';
  if (s.failed > 0) return 'fail';
  if (s.needs_baseline > 0) return 'needs_baseline';
  if (s.warnings > 0) return 'warn';
  return 'pass';
}
