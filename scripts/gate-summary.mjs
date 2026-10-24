#!/usr/bin/env node
// Turns a visual-check JSON report into a GitHub job-summary block (stdout).
// Usage: node scripts/gate-summary.mjs <report.json> <project> <threshold-pct> <exit-code>
import { readFileSync, existsSync } from 'node:fs';

/** Most targets listed under "Needs attention" before the rest are counted. */
const MAX_PROBLEMS = 10;

/** One line of plain text, safe inside a Markdown table cell. */
function cell(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}

/** Inline code that a backtick in the value cannot break out of. */
function code(value) {
  return '`' + String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/`/g, "'") + '`';
}

export function gateSummary(report, { project, threshold, exitCode }) {
  const lines = [`## Visual Check: ${cell(project) || '(no project)'}`, ''];
  if (!report || !report.summary || !Array.isArray(report.results)) {
    lines.push(
      report ? `The report could not be read (exit ${exitCode}). See the job log.` : `No report was written (exit ${exitCode}). See the job log.`,
    );
    return lines.join('\n') + '\n';
  }
  const s = report.summary;
  lines.push(
    `**Terminal state:** \`${report.terminal_state}\` (exit ${exitCode})`,
    `**Threshold:** ${threshold}% of pixels`,
    `**Targets:** ${s.total} total, ${s.passed} passed, ${s.failed} failed, ${s.errors ?? 0} errored, ${s.needs_baseline} need a baseline, ${s.warnings} with warnings`,
    '',
  );
  const top = [...report.results]
    .filter((r) => typeof r.diff_percentage === 'number')
    .sort((a, b) => b.diff_percentage - a.diff_percentage)
    .slice(0, 3);
  if (top.length > 0) {
    lines.push('| Page | Viewport | Diff % | Verdict |', '|---|---|---|---|');
    for (const r of top) {
      lines.push(`| ${cell(r.url)} | ${cell(r.viewport)} | ${r.diff_percentage.toFixed(3)} | ${cell(r.verdict)} |`);
    }
    lines.push('');
  }

  // Errors and fails with no diff % (HTTP 404, capture timeout, ...) never
  // reach the diff table above; list them with their first reason.
  const problems = report.results
    .filter((r) => r.verdict === 'error' || (r.verdict === 'fail' && typeof r.diff_percentage !== 'number'))
    .sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'error' ? -1 : 1));
  if (problems.length > 0) {
    lines.push('**Needs attention:**', '');
    for (const r of problems.slice(0, MAX_PROBLEMS)) {
      const reason = Array.isArray(r.reasons) && r.reasons.length > 0 ? ` — ${cell(r.reasons[0])}` : '';
      lines.push(`- ${code(r.url)} @ ${cell(r.viewport)}: **${cell(r.verdict)}**${reason}`);
    }
    if (problems.length > MAX_PROBLEMS) lines.push(`- …and ${problems.length - MAX_PROBLEMS} more in the report`);
    lines.push('');
  }

  const missing = report.results.filter((r) => r.verdict === 'needs_baseline').length;
  if (missing > 0) lines.push(`${missing} target(s) have no baseline. Run the refresh-baselines workflow.`, '');
  lines.push('The HTML report and diff images are in the run artifacts.');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [file, project, threshold, exitCode] = process.argv.slice(2);
  let report = null;
  if (file && existsSync(file)) {
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // A truncated report must not fail the step and hide the real exit code.
      report = {};
    }
  }
  process.stdout.write(gateSummary(report, { project, threshold, exitCode }));
}
