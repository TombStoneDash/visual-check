/**
 * Example project config matching the V2 spec (§3.2). The V1 CLI does
 * not read this file yet — it takes URLs via flags. This example is
 * here so you can commit a per-repo config alongside code today and
 * the V2 runner will pick it up as-is.
 *
 * Usage (V2):
 *   import { defineConfig } from '@noui/visual-check';
 */

import type {
  CheckName,
  CheckMode,
  ViewportSpec,
  BaselineLane,
} from './src/types.js';

export interface ProjectConfig {
  projectId: string;
  baseBranch: string;
  routes: RouteSpec[];
  viewports: ViewportSpec[];
  themes: Array<'light' | 'dark'>;
  checks: Record<CheckName, CheckMode>;
  performanceBudget?: PerformanceBudget;
  lane: BaselineLane;
}

export interface RouteSpec {
  id: string;
  path: string;
  authProfile?: string;
  waitFor?: { selector?: string; timeoutMs?: number; networkIdle?: boolean };
  maskSelectors?: string[];
  ignoreSelectors?: string[];
  criticalSelectors?: string[];
  criticalLinks?: string[];
  checks?: CheckName[];
}

export interface PerformanceBudget {
  lighthousePerformanceMin?: number;
  maxRequests?: number;
  maxTotalJsKb?: number;
  maxLcpMs?: number;
  maxCls?: number;
}

// Example config for TrashAlert — copy/paste into any repo.
const config: ProjectConfig = {
  projectId: 'trashalert-web',
  baseBranch: 'main',
  routes: [
    {
      id: 'home',
      path: '/',
      waitFor: { selector: 'main', timeoutMs: 10_000, networkIdle: true },
      criticalSelectors: ['header', 'main', 'footer', '[data-cta="book-demo"]'],
      criticalLinks: ['/for-property-managers', '/pricing'],
      ignoreSelectors: ['[data-dynamic-clock]'],
    },
    {
      id: 'pm-page',
      path: '/for-property-managers',
      waitFor: { selector: 'main', timeoutMs: 10_000, networkIdle: true },
      criticalSelectors: ['h1', '[data-cta="start-trial"]'],
    },
    {
      id: 'narpm',
      path: '/narpm',
      waitFor: { selector: 'main', timeoutMs: 10_000, networkIdle: true },
    },
  ],
  viewports: [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ],
  themes: ['light'],
  checks: {
    pixel_diff: 'blocking',
    http_status: 'blocking',
    console_errors: 'warn',
    load_time: 'warn',
    // V2 checks — stubbed for config forward-compat
    broken_images: 'blocking',
    text_rendering: 'blocking',
    responsive_breakpoints: 'blocking',
    dark_mode: 'warn',
    og_preview: 'warn',
    accessibility: 'warn',
  },
  performanceBudget: {
    lighthousePerformanceMin: 75,
    maxRequests: 120,
    maxTotalJsKb: 500,
    maxLcpMs: 2500,
    maxCls: 0.1,
  },
  lane: {
    browser: 'chromium',
    os: 'macos',
    runner: 'macmini-local',
  },
};

export default config;
