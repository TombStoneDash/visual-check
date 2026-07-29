/**
 * Visual Check shared type contracts.
 *
 * These types are designed to be forward-compatible with the V2 spec
 * (Next.js control plane + Supabase + MCP). V1 CLI uses a subset.
 */

export type Theme = 'light' | 'dark';

export type CheckName =
  | 'pixel_diff'
  | 'http_status'
  | 'console_errors'
  | 'load_time'
  // V2 checks (stubbed, not implemented in V1):
  | 'broken_images'
  | 'text_rendering'
  | 'responsive_breakpoints'
  | 'dark_mode'
  | 'og_preview'
  | 'accessibility';

export type CheckMode = 'blocking' | 'warn' | 'skip';

export type Verdict = 'pass' | 'fail' | 'warn' | 'needs_baseline' | 'error';

export type TerminalState =
  | 'SHIPPED_PROVEN'
  | 'READY_TO_REVIEW'
  | 'BLOCKED_WITH_OWNER';

export type RunAssertionName =
  | 'capture_completed'
  | 'http_healthy'
  | 'baselines_present'
  | 'visual_diff_within_threshold'
  | 'nonblocking_checks_clean';

export interface RunAssertion {
  name: RunAssertionName;
  status: 'pass' | 'fail';
  message: string;
  owner?: 'runtime' | 'site-owner' | 'review-owner';
}

export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

/** Pixel-space bounding box of the differing region between baseline and current. */
export interface ChangedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORTS: ViewportSpec[] = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/**
 * Stable capture lane (per V2 spec §2.2).
 * V1 keys baselines by OS so a Windows-captured baseline never compares
 * against a Linux or macOS capture — Playwright renders identical pages
 * slightly differently across OSes and the diff would flap otherwise.
 */
export interface BaselineLane {
  browser: 'chromium';
  os: 'macos' | 'linux' | 'windows';
  runner:
    | 'macmini-local'
    | 'thinkcentre-local'
    | 'lenovo-local'
    | 'browserbase-cloud';
  theme?: Theme;
}

export interface CaptureArtifact {
  url: string;
  viewport: string;
  screenshotPath: string;
  httpStatus: number | null;
  /** Closed, bounded diagnostic categories; never raw page or request text. */
  consoleErrors: string[];
  loadTimeMs: number;
  error?: string;
}

export interface CheckResult {
  name: CheckName;
  mode: CheckMode;
  status: 'pass' | 'fail' | 'warn' | 'skip' | 'error';
  message: string;
  metric?: number | string;
  threshold?: number | string;
  blocking: boolean;
}

export interface TargetResult {
  url: string;
  viewport: string;
  verdict: Verdict;
  /** Top-level pass flag (true if pass or warn) */
  pass: boolean;
  status: number | null;
  diff_percentage: number | null;
  screenshot: string;
  baseline: string | null;
  diff_image: string | null;
  /** Bounding box of the changed pixels, when a diff was computed. */
  changed_region?: ChangedRegion | null;
  console_errors: number;
  load_time_ms: number;
  reasons: string[];
  checks: CheckResult[];
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  /** Targets with any runtime/check error; may overlap another verdict count. */
  errors: number;
  needs_baseline: number;
}

export interface RunStorageKeys {
  htmlReport?: string;
  /** Keyed by `${url}|${viewport}` */
  screenshots?: Record<string, string>;
  diffs?: Record<string, string>;
  baselines?: Record<string, string>;
}

export interface RunReport {
  /** Machine-readable schema version */
  schema_version: 1;
  timestamp: string;
  run_id: string;
  /** Phase 2: Daisy deploy-gate context. Optional for backward compat with
   *  local-only `run` invocations. */
  projectId?: string;
  deploymentUrl?: string;
  branch?: string;
  commitSha?: string;
  storageKeys?: RunStorageKeys;
  config: {
    urls: string[];
    viewports: string[];
    pixel_diff_threshold: number;
    load_time_warn_ms: number;
    lane: BaselineLane;
  };
  results: TargetResult[];
  summary: RunSummary;
  assertions: RunAssertion[];
  terminal_state: TerminalState;
  /** True iff every target is pass or warn (no fail/error/needs_baseline) */
  pass: boolean;
}

export interface RunReceipt {
  schema_version: 1;
  timestamp: string;
  run_id: string;
  terminal_state: TerminalState;
  pass: boolean;
  summary: RunSummary;
  assertions: RunAssertion[];
  artifacts: {
    json?: string;
    html?: string;
    receipt: string;
    storage?: RunStorageKeys;
  };
  context: {
    projectId?: string;
    deploymentUrl?: string;
    branch?: string;
    commitSha?: string;
    urls: string[];
    viewports: string[];
  };
  next_action: string;
}

export interface CapturerOptions {
  headless?: boolean;
  locale?: string;
  timezoneId?: string;
  navigationTimeoutMs?: number;
}

export interface RunCliOptions {
  urls: string[];
  viewports: ViewportSpec[];
  outRoot: string;
  pixelDiffThreshold: number;
  loadTimeWarnMs: number;
  jsonOutPath?: string;
}
