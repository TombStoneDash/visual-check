import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RunAssertionName, RunReceipt, RunReport } from './types.js';

export function receiptPathFor(jsonPath: string): string {
  const parsed = path.parse(jsonPath);
  return path.join(parsed.dir, `${parsed.name}.receipt.json`);
}

export function nextActionFor(report: RunReport): string {
  if (report.terminal_state === 'SHIPPED_PROVEN') {
    return 'Deploy gate passed with proof artifacts; safe to continue.';
  }

  const { assertions, summary } = report;
  const isProblem = (name: RunAssertionName) =>
    assertions.some((assertion) => assertion.name === name && assertion.status !== 'pass');

  const problems: string[] = [];
  if (isProblem('capture_completed') && summary.errors > 0) {
    problems.push(`${summary.errors} target(s) failed to capture - re-run the capture.`);
  }
  if (isProblem('http_healthy') && summary.failed > 0) {
    problems.push(`${summary.failed} target(s) need site-owner investigation.`);
  }
  if (isProblem('baselines_present') && summary.needs_baseline > 0) {
    problems.push(
      `${summary.needs_baseline} target(s) have no approved baseline - review and promote.`,
    );
  }
  if (isProblem('visual_diff_within_threshold') && summary.failed > 0) {
    problems.push(
      `${summary.failed} target(s) changed visually - open the HTML report and approve or fix.`,
    );
  }
  if (isProblem('nonblocking_checks_clean') && summary.warnings > 0) {
    problems.push(`${summary.warnings} target(s) have warnings to review.`);
  }

  if (problems.length === 0) {
    return 'Open the HTML report and review the run.';
  }

  const limited = problems.slice(0, 3);
  if (problems.length > 3) {
    limited.push('And more in the report.');
  }
  return limited.join(' ');
}

export function buildReceipt(params: {
  report: RunReport;
  receiptPath: string;
  jsonPath?: string;
  htmlPath?: string;
}): RunReceipt {
  const { report, receiptPath, jsonPath, htmlPath } = params;
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    run_id: report.run_id,
    terminal_state: report.terminal_state,
    pass: report.pass,
    summary: report.summary,
    assertions: report.assertions,
    artifacts: {
      ...(jsonPath ? { json: path.resolve(jsonPath) } : {}),
      ...(htmlPath ? { html: path.resolve(htmlPath) } : {}),
      receipt: path.resolve(receiptPath),
      ...(report.storageKeys ? { storage: report.storageKeys } : {}),
    },
    context: {
      projectId: report.projectId,
      deploymentUrl: report.deploymentUrl,
      branch: report.branch,
      commitSha: report.commitSha,
      urls: report.config.urls,
      viewports: report.config.viewports,
    },
    next_action: nextActionFor(report),
  };
}

export async function writeReceipt(params: {
  report: RunReport;
  receiptPath: string;
  jsonPath?: string;
  htmlPath?: string;
}): Promise<RunReceipt> {
  const abs = path.resolve(params.receiptPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const receipt = buildReceipt({ ...params, receiptPath: abs });
  await fs.writeFile(abs, JSON.stringify(receipt, null, 2));
  return receipt;
}
