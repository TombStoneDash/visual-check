import {
  CaptureArtifact,
  CheckMode,
  CheckResult,
  TargetResult,
  Verdict,
} from './types.js';
import { sanitizeCaptureError } from './capture.js';
import { DiffResult } from './diff.js';

/**
 * V1 check severity policy. Blocking checks can fail a target;
 * warn checks degrade the verdict to 'warn' but keep `pass: true`.
 */
export const V1_CHECK_MODES: Record<string, CheckMode> = {
  pixel_diff: 'blocking',
  http_status: 'blocking',
  console_errors: 'warn',
  load_time: 'warn',
};

// -- Check 1: Pixel diff -----------------------------------------------------

export function checkPixelDiff(
  diff: DiffResult | null,
  thresholdPct: number,
  baselineExists: boolean,
): CheckResult {
  const mode = V1_CHECK_MODES.pixel_diff;
  if (!baselineExists) {
    return {
      name: 'pixel_diff',
      mode,
      status: 'skip',
      message: 'no baseline — target needs baseline capture',
      blocking: false,
    };
  }
  if (!diff) {
    return {
      name: 'pixel_diff',
      mode,
      status: 'error',
      message: 'diff could not be computed',
      blocking: true,
    };
  }
  if (diff.dimensionMismatch) {
    return {
      name: 'pixel_diff',
      mode,
      status: 'fail',
      message: `dimensions ${diff.actualDimensions.width}×${diff.actualDimensions.height} ≠ baseline ${diff.baselineDimensions.width}×${diff.baselineDimensions.height}`,
      metric: 100,
      threshold: thresholdPct,
      blocking: true,
    };
  }
  const pass = diff.diffPercentage <= thresholdPct;
  return {
    name: 'pixel_diff',
    mode,
    status: pass ? 'pass' : 'fail',
    message: pass
      ? `pixel diff ${diff.diffPercentage.toFixed(3)}% within threshold`
      : `pixel diff ${diff.diffPercentage.toFixed(3)}% > ${thresholdPct}%`,
    metric: Number(diff.diffPercentage.toFixed(3)),
    threshold: thresholdPct,
    blocking: !pass,
  };
}

// -- Check 2: HTTP status ----------------------------------------------------

export function checkHttpStatus(cap: CaptureArtifact): CheckResult {
  const mode = V1_CHECK_MODES.http_status;
  if (cap.error) {
    return {
      name: 'http_status',
      mode,
      status: 'error',
      message: `navigation error: ${sanitizeCaptureError(cap.error)}`,
      blocking: true,
    };
  }
  if (cap.httpStatus === null) {
    return {
      name: 'http_status',
      mode,
      status: 'fail',
      message: 'no HTTP response received',
      blocking: true,
    };
  }
  const ok = cap.httpStatus >= 200 && cap.httpStatus < 400;
  return {
    name: 'http_status',
    mode,
    status: ok ? 'pass' : 'fail',
    message: `HTTP ${cap.httpStatus}`,
    metric: cap.httpStatus,
    threshold: '< 400',
    blocking: !ok,
  };
}

// -- Check 3: Console errors -------------------------------------------------

export function checkConsoleErrors(cap: CaptureArtifact): CheckResult {
  const mode = V1_CHECK_MODES.console_errors;
  const count = cap.consoleErrors.length;
  if (count === 0) {
    return {
      name: 'console_errors',
      mode,
      status: 'pass',
      message: 'no console errors',
      metric: 0,
      blocking: false,
    };
  }
  return {
    name: 'console_errors',
    mode,
    status: 'warn',
    message: `${count} console error(s): ${cap.consoleErrors
      .slice(0, 3)
      .map((e) => e.slice(0, 80))
      .join(' | ')}${count > 3 ? ' | ...' : ''}`,
    metric: count,
    threshold: 0,
    blocking: false,
  };
}

// -- Check 4: Load time ------------------------------------------------------

export function checkLoadTime(cap: CaptureArtifact, warnMs: number): CheckResult {
  const mode = V1_CHECK_MODES.load_time;
  if (cap.error) {
    return {
      name: 'load_time',
      mode,
      status: 'skip',
      message: 'skipped due to capture error',
      blocking: false,
    };
  }
  const ok = cap.loadTimeMs <= warnMs;
  return {
    name: 'load_time',
    mode,
    status: ok ? 'pass' : 'warn',
    message: ok
      ? `load time ${cap.loadTimeMs}ms within budget`
      : `load time ${cap.loadTimeMs}ms > ${warnMs}ms`,
    metric: cap.loadTimeMs,
    threshold: warnMs,
    blocking: false,
  };
}

// -- Verdict aggregation -----------------------------------------------------

/**
 * Aggregate per-check results into a single target verdict.
 *
 * Precedence: error > fail > needs_baseline > warn > pass
 */
export function aggregateVerdict(
  checks: CheckResult[],
  baselineExists: boolean,
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];

  const hasError = checks.some((c) => c.status === 'error');
  if (hasError) {
    for (const c of checks) {
      if (c.status === 'error') reasons.push(`${c.name}: ${c.message}`);
    }
    return { verdict: 'error', reasons };
  }

  const hasBlockingFail = checks.some(
    (c) => c.status === 'fail' && c.mode === 'blocking',
  );
  if (hasBlockingFail) {
    for (const c of checks) {
      if (c.status === 'fail' && c.mode === 'blocking') {
        reasons.push(`${c.name}: ${c.message}`);
      }
    }
    return { verdict: 'fail', reasons };
  }

  if (!baselineExists) {
    reasons.push('pixel_diff: no baseline for this target');
    // still report warnings so the operator sees everything
    for (const c of checks) {
      if (c.status === 'warn') reasons.push(`${c.name}: ${c.message}`);
    }
    return { verdict: 'needs_baseline', reasons };
  }

  const hasWarn = checks.some((c) => c.status === 'warn');
  if (hasWarn) {
    for (const c of checks) {
      if (c.status === 'warn') reasons.push(`${c.name}: ${c.message}`);
    }
    return { verdict: 'warn', reasons };
  }

  return { verdict: 'pass', reasons: [] };
}

/**
 * Compose a TargetResult from capture + diff + baseline state.
 */
export function buildTargetResult(params: {
  cap: CaptureArtifact;
  diff: DiffResult | null;
  baselineExists: boolean;
  baselinePath: string;
  pixelDiffThresholdPct: number;
  loadTimeWarnMs: number;
}): TargetResult {
  const { cap, diff, baselineExists, baselinePath, pixelDiffThresholdPct, loadTimeWarnMs } =
    params;

  const checks: CheckResult[] = [
    checkHttpStatus(cap),
    checkPixelDiff(diff, pixelDiffThresholdPct, baselineExists),
    checkConsoleErrors(cap),
    checkLoadTime(cap, loadTimeWarnMs),
  ];

  const { verdict, reasons } = aggregateVerdict(checks, baselineExists);
  const pass = verdict === 'pass' || verdict === 'warn';

  return {
    url: cap.url,
    viewport: cap.viewport,
    verdict,
    pass,
    status: cap.httpStatus,
    diff_percentage: diff && !diff.dimensionMismatch ? Number(diff.diffPercentage.toFixed(3)) : null,
    screenshot: cap.screenshotPath,
    baseline: baselineExists ? baselinePath : null,
    diff_image: diff?.diffImagePath ?? null,
    changed_region: diff && !diff.dimensionMismatch ? (diff.changedRegion ?? null) : null,
    console_errors: cap.consoleErrors.length,
    load_time_ms: cap.loadTimeMs,
    reasons,
    checks,
  };
}
