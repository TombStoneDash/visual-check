#!/usr/bin/env node
// Turns a visual-check JSON report into a GitHub job-summary block (stdout).
// Usage: node scripts/gate-summary.mjs <report.json> <project> <threshold-pct> <exit-code>
import { readFileSync, existsSync } from 'node:fs';

/** Verdicts listed under "Needs attention", in display order. */
const NEEDS_ATTENTION = { error: 0, fail: 1, needs_baseline: 2 };
const MAX_ATTENTION_ROWS = 10;

/** Markdown table cell: no pipes or line breaks from URLs or reasons. */
function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function diffCell(r) {
  if (typeof r.diff_percentage === 'number') return r.diff_percentage.toFixed(3);
  if ((r.reasons ?? []).some((reason) => reason.startsWith('pixel_diff: dimensions'))) return 'size changed';
  return '—';
}

export function gateSummary(report, { project, threshold, exitCode }) {
  const lines = [`## Visual Check: ${project}`, ''];
  if (!report) {
    lines.push(`No report was written (exit ${exitCode}). See the job log.`);
    return lines.join('\n') + '\n';
  }
  const s = report.summary;
  lines.push(
    `**Terminal state:** \`${report.terminal_state}\` (exit ${exitCode})`,
    `**Threshold:** ${threshold}% of pixels`,
    `**Targets:** ${s.total} total, ${s.passed} passed, ${s.failed} failed, ${s.needs_baseline} need a baseline, ${s.warnings} with warnings`,
    '',
  );
  // Targets that are red come first, whatever their diff: a size change, an
  // HTTP failure or an error has no diff percentage but is why the gate failed.
  const attention = report.results
    .filter((r) => Object.hasOwn(NEEDS_ATTENTION, r.verdict))
    .sort((a, b) => NEEDS_ATTENTION[a.verdict] - NEEDS_ATTENTION[b.verdict]);
  if (attention.length > 0) {
    lines.push('**Needs attention**', '', '| Page | Viewport | Diff % | Verdict | Reason |', '|---|---|---|---|---|');
    for (const r of attention.slice(0, MAX_ATTENTION_ROWS)) {
      lines.push(`| ${cell(r.url)} | ${cell(r.viewport)} | ${diffCell(r)} | ${r.verdict} | ${cell(r.reasons?.[0] ?? '')} |`);
    }
    if (attention.length > MAX_ATTENTION_ROWS) {
      lines.push('', `…and ${attention.length - MAX_ATTENTION_ROWS} more in the report.`);
    }
    lines.push('');
  }
  const top = report.results
    .filter((r) => !Object.hasOwn(NEEDS_ATTENTION, r.verdict) && typeof r.diff_percentage === 'number')
    .sort((a, b) => b.diff_percentage - a.diff_percentage)
    .slice(0, 3);
  if (top.length > 0) {
    lines.push('**Largest diffs that passed**', '', '| Page | Viewport | Diff % | Verdict |', '|---|---|---|---|');
    for (const r of top) lines.push(`| ${cell(r.url)} | ${cell(r.viewport)} | ${r.diff_percentage.toFixed(3)} | ${r.verdict} |`);
    lines.push('');
  }
  const missing = report.results.filter((r) => r.verdict === 'needs_baseline').length;
  if (missing > 0) lines.push(`${missing} target(s) have no baseline. Run the refresh-baselines workflow.`, '');
  lines.push('The HTML report and diff images are in the run artifacts.');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [file, project, threshold, exitCode] = process.argv.slice(2);
  const report = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  process.stdout.write(gateSummary(report, { project, threshold, exitCode }));
}
