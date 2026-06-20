import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RunReceipt, RunReport } from './types.js';

export function receiptPathFor(jsonPath: string): string {
  const parsed = path.parse(jsonPath);
  return path.join(parsed.dir, `${parsed.name}.receipt.json`);
}

export function nextActionFor(report: RunReport): string {
  if (report.terminal_state === 'SHIPPED_PROVEN') {
    return 'Deploy gate passed with proof artifacts; safe to continue.';
  }
  if (report.terminal_state === 'READY_TO_REVIEW') {
    return 'Open the HTML report, review warnings, missing baselines, or visual diffs, then promote or fix.';
  }
  return 'Assign the failed runtime or HTTP assertion owner before retrying.';
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
