/**
 * Programmatic entry point. V1 CLI is the primary surface;
 * this export keeps the door open for the V2 runner and SDK
 * to reuse capture/diff/checks without forking the code.
 */
export * from './types.js';
export { Capturer, urlToSlug } from './capture.js';
export { diffPngs, fileExists } from './diff.js';
export type { DiffResult, DiffOptions } from './diff.js';
export {
  checkPixelDiff,
  checkHttpStatus,
  checkConsoleErrors,
  checkLoadTime,
  aggregateVerdict,
  buildTargetResult,
  V1_CHECK_MODES,
} from './checks.js';
export {
  buildAssertions,
  terminalStateForAssertions,
  summarize,
  buildReport,
  writeJsonReport,
  formatTargetLine,
  formatSummary,
} from './report.js';
export { renderHtmlReport, htmlReportPathFor } from './html-report.js';
export { buildReceipt, nextActionFor, receiptPathFor, writeReceipt } from './receipt.js';
export { runPool } from './pool.js';
export type { PoolResult } from './pool.js';
export { resolveCompareTarget, buildCompareTargetResult, runCompare } from './commands/compare.js';
export type {
  CompareTarget,
  CompareOptions,
  CompareRunResult,
} from './commands/compare.js';
