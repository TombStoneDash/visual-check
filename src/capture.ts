import { chromium, Browser } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CaptureArtifact, CapturerOptions, ViewportSpec } from './types.js';

export const CAPTURE_ERROR_CATEGORIES = [
  'navigation_aborted',
  'redirect_loop',
  'resource_not_found',
  'name_resolution_failed',
  'network_unavailable',
  'tls_failed',
  'navigation_timeout',
  'capture_failed',
] as const;

export type CaptureErrorCategory = (typeof CAPTURE_ERROR_CATEGORIES)[number];

const CAPTURE_ERROR_CATEGORY_SET = new Set<string>(CAPTURE_ERROR_CATEGORIES);

const CHROMIUM_ERROR_CATEGORIES = new Map<string, CaptureErrorCategory>([
  ['net::ERR_ABORTED', 'navigation_aborted'],
  ['net::ERR_TOO_MANY_REDIRECTS', 'redirect_loop'],
  ['net::ERR_FILE_NOT_FOUND', 'resource_not_found'],
  ['net::ERR_NAME_NOT_RESOLVED', 'name_resolution_failed'],
  ['net::ERR_CONNECTION_REFUSED', 'network_unavailable'],
  ['net::ERR_CONNECTION_RESET', 'network_unavailable'],
  ['net::ERR_CONNECTION_CLOSED', 'network_unavailable'],
  ['net::ERR_INTERNET_DISCONNECTED', 'network_unavailable'],
  ['net::ERR_ADDRESS_UNREACHABLE', 'network_unavailable'],
  ['net::ERR_CERT_AUTHORITY_INVALID', 'tls_failed'],
  ['net::ERR_CERT_COMMON_NAME_INVALID', 'tls_failed'],
  ['net::ERR_CERT_DATE_INVALID', 'tls_failed'],
  ['net::ERR_SSL_PROTOCOL_ERROR', 'tls_failed'],
  ['net::ERR_FAILED', 'capture_failed'],
]);

/**
 * Reduce browser/runtime failures to a small, operator-useful vocabulary.
 *
 * Playwright error messages include the navigated URL and a call log. URLs
 * may contain signed preview query strings, so raw messages must never enter
 * reports, receipts, or user-facing reasons.
 */
export function sanitizeCaptureError(value: unknown): CaptureErrorCategory {
  const raw = value instanceof Error ? value.message : String(value);
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (CAPTURE_ERROR_CATEGORY_SET.has(firstLine)) return firstLine as CaptureErrorCategory;
  const diagnosticPrefix = firstLine.replace(/\s+at\s+(?:https?|file):\/\/.*$/i, '');
  const chromiumDiagnostic = diagnosticPrefix.replace(/^page\.goto:\s*/i, '');
  const trustedCategory = CHROMIUM_ERROR_CATEGORIES.get(chromiumDiagnostic);
  if (trustedCategory) return trustedCategory;
  if (/\b(?:timeout|timed out)\b/i.test(diagnosticPrefix)) return 'navigation_timeout';
  return 'capture_failed';
}

export const CONSOLE_DIAGNOSTIC_CATEGORIES = [
  'console_error',
  'page_error',
  'request_failed:script',
  'request_failed:stylesheet',
  'request_failed:image',
  'request_failed:font',
] as const;

export type ConsoleDiagnosticCategory = (typeof CONSOLE_DIAGNOSTIC_CATEGORIES)[number];

const CONSOLE_DIAGNOSTIC_CATEGORY_SET = new Set<string>(CONSOLE_DIAGNOSTIC_CATEGORIES);

/**
 * Collapse page-controlled console/request text to a closed category set.
 * The report retains event counts and resource kind without copying raw page
 * text, request URLs, query strings, or browser log detail.
 */
export function sanitizeConsoleDiagnostic(value: unknown): ConsoleDiagnosticCategory {
  const diagnostic = String(value);
  return CONSOLE_DIAGNOSTIC_CATEGORY_SET.has(diagnostic)
    ? (diagnostic as ConsoleDiagnosticCategory)
    : 'console_error';
}

/**
 * Capturer wraps Playwright with the stable-capture rules from V2 spec §4.4:
 *   - disable CSS animations/transitions
 *   - wait for fonts before capture
 *   - fixed locale, timezone, DPR
 *   - reduced motion
 *
 * V1 only captures the above-the-fold viewport (not fullPage) to keep
 * baselines stable against pages that lazy-load content on scroll.
 */
export class Capturer {
  private browser: Browser | null = null;
  private readonly opts: Required<CapturerOptions>;

  constructor(opts: CapturerOptions = {}) {
    this.opts = {
      headless: opts.headless ?? true,
      locale: opts.locale ?? 'en-US',
      timezoneId: opts.timezoneId ?? 'America/Los_Angeles',
      navigationTimeoutMs: opts.navigationTimeoutMs ?? 30_000,
    };
  }

  async start(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: this.opts.headless });
  }

  async stop(): Promise<void> {
    if (!this.browser) return;
    await this.browser.close();
    this.browser = null;
  }

  async capture(
    url: string,
    viewport: ViewportSpec,
    outputPath: string,
  ): Promise<CaptureArtifact> {
    if (!this.browser) throw new Error('Capturer not started. Call start() first.');

    const consoleErrors: string[] = [];
    let httpStatus: number | null = null;
    let error: string | undefined;
    const start = Date.now();

    const context = await this.browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      locale: this.opts.locale,
      timezoneId: this.opts.timezoneId,
      reducedMotion: 'reduce',
      colorScheme: 'light',
    });

    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push('console_error');
    });
    page.on('pageerror', () => {
      consoleErrors.push('page_error');
    });
    page.on('requestfailed', (req) => {
      // Only count resource failures that block rendering
      const rt = req.resourceType();
      if (rt === 'script' || rt === 'stylesheet' || rt === 'image' || rt === 'font') {
        consoleErrors.push(sanitizeConsoleDiagnostic(`request_failed:${rt}`));
      }
    });

    try {
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.opts.navigationTimeoutMs,
      });
      // file:// navigation never yields an HTTP response — treat a
      // successful local-page load as "200" rather than "no response".
      httpStatus = response ? response.status() : url.startsWith('file:') ? 200 : null;

      // Stable-capture: disable animations, hide caret
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
            caret-color: transparent !important;
          }
          html { scroll-behavior: auto !important; }
        `,
      });

      // Wait for fonts to eliminate flicker in text rendering
      await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      });

      // Give layout one frame to settle after style injection
      await page.waitForTimeout(200);

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await page.screenshot({
        path: outputPath,
        fullPage: false,
        animations: 'disabled',
      });
    } catch (e) {
      error = sanitizeCaptureError(e);
    } finally {
      await context.close();
    }

    return {
      url,
      viewport: viewport.name,
      screenshotPath: outputPath,
      httpStatus,
      consoleErrors,
      loadTimeMs: Date.now() - start,
      error,
    };
  }
}

/**
 * Convert a URL into a stable filesystem slug used for per-target paths.
 * https://trashalert.io/pricing → "trashalert-io_pricing"
 */
export function urlToSlug(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/\./g, '-');
    const pathSeg =
      u.pathname === '/' || u.pathname === ''
        ? ''
        : u.pathname.replace(/\/$/, '').replace(/\//g, '_');
    return `${host}${pathSeg}`;
  } catch {
    return url.replace(/[^a-z0-9]/gi, '_');
  }
}
