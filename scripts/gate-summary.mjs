#!/usr/bin/env node
// Turns a visual-check JSON report into a GitHub job-summary block (stdout).
// Usage: node scripts/gate-summary.mjs <report.json> <project> <threshold-pct> <exit-code>
import { readFileSync, existsSync } from 'node:fs';

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
  const top = [...report.results]
    .filter((r) => typeof r.diff_percentage === 'number')
    .sort((a, b) => b.diff_percentage - a.diff_percentage)
    .slice(0, 3);
  if (top.length > 0) {
    lines.push('| Page | Viewport | Diff % | Verdict |', '|---|---|---|---|');
    for (const r of top) lines.push(`| ${r.url} | ${r.viewport} | ${r.diff_percentage.toFixed(3)} | ${r.verdict} |`);
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
