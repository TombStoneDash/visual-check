import { Verdict } from './types.js';

export const USAGE_OR_FATAL_EXIT_CODE = 3;

/**
 * Process exit code contract for a verdict. Consumed by the CLI (wiring is a
 * later task) and by any agent that needs to script against `visual-check`
 * without re-deriving these numbers.
 */
export const VERDICT_EXIT_CODES: Readonly<Record<Verdict, number>> = Object.freeze({
  pass: 0,
  warn: 0,
  needs_baseline: 2,
  fail: 1,
  error: 3,
});

export interface ExitCodeOptions {
  /** When true, a `warn` verdict exits non-zero (1) instead of 0. */
  strictWarn?: boolean;
}

const UNKNOWN_VERDICT_EXIT_CODE = 3;

/**
 * Resolves the process exit code for a verdict. Unknown/unrecognized verdict
 * strings map to the `error` exit code (3) rather than throwing, since this
 * is meant to be safe to call from CLI glue code with unvalidated input.
 */
export function exitCodeFor(verdict: string, opts: ExitCodeOptions = {}): number {
  if (!Object.prototype.hasOwnProperty.call(VERDICT_EXIT_CODES, verdict)) {
    return UNKNOWN_VERDICT_EXIT_CODE;
  }
  const code = VERDICT_EXIT_CODES[verdict as Verdict];
  if (opts.strictWarn && verdict === 'warn') {
    return 1;
  }
  return code;
}

const EXIT_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'success: verdict was pass, or warn without --strict-warn',
  1: 'failure: verdict was fail, or warn with --strict-warn enabled',
  2: 'needs_baseline: no baseline exists yet to compare against',
  3: 'error: verdict was error, the command was used incorrectly, or the CLI crashed',
};

const DEFAULT_DESCRIPTION = 'unrecognized exit code';

/** One-line human/agent-readable meaning for a `visual-check` exit code. */
export function describeExitCode(code: number): string {
  return EXIT_CODE_DESCRIPTIONS[code] ?? DEFAULT_DESCRIPTION;
}
