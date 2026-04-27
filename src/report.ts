import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BaselineLane,
  RunReport,
  RunSummary,
  TargetResult,
  ViewportSpec,
} from './types.js';

export function summarize(results: TargetResult[]): RunSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.verdict === 'pass').length,
    failed: results.filter((r) => r.verdict === 'fail').length,
    warnings: results.filter((r) => r.verdict === 'warn').length,
    errors: results.filter((r) => r.verdict === 'error').length,
    needs_baseline: results.filter((r) => r.verdict === 'needs_baseline').length,
  };
}

export function buildReport(params: {
  urls: string[];
  viewports: ViewportSpec[];
  pixelDiffThreshold: number;
  loadTimeWarnMs: number;
  results: TargetResult[];
  lane: BaselineLane;
}): RunReport {
  const { urls, viewports, pixelDiffThreshold, loadTimeWarnMs, results, lane } = params;
  const summary = summarize(results);
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    run_id: `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    config: {
      urls,
      viewports: viewports.map((v) => v.name),
      pixel_diff_threshold: pixelDiffThreshold,
      load_time_warn_ms: loadTimeWarnMs,
      lane,
    },
    results,
    summary,
    pass: summary.failed === 0 && summary.errors === 0 && summary.needs_baseline === 0,
  };
}

export async function writeJsonReport(report: RunReport, outPath: string): Promise<void> {
  const abs = path.resolve(outPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(report, null, 2));
}

const LABEL: Record<TargetResult['verdict'], string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  error: 'ERROR',
  needs_baseline: 'NEEDS_BASELINE',
};

export function formatTargetLine(r: TargetResult): string {
  const tail = r.reasons.length ? ` — ${r.reasons.join('; ')}` : '';
  return `${LABEL[r.verdict].padEnd(14)} ${r.url} @ ${r.viewport} (${r.load_time_ms}ms)${tail}`;
}

export function formatSummary(s: RunSummary): string {
  return [
    `  total:          ${s.total}`,
    `  passed:         ${s.passed}`,
    `  warnings:       ${s.warnings}`,
    `  failed:         ${s.failed}`,
    `  errors:         ${s.errors}`,
    `  needs_baseline: ${s.needs_baseline}`,
  ].join('\n');
}
