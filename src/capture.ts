import { chromium, Browser } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CaptureArtifact, CapturerOptions, ViewportSpec } from './types.js';

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
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`PageError: ${err.message}`);
    });
    page.on('requestfailed', (req) => {
      // Only count resource failures that block rendering
      const rt = req.resourceType();
      if (rt === 'script' || rt === 'stylesheet' || rt === 'image' || rt === 'font') {
        consoleErrors.push(`RequestFailed(${rt}): ${req.url()}`);
      }
    });

    try {
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.opts.navigationTimeoutMs,
      });
      httpStatus = response?.status() ?? null;

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
      error = e instanceof Error ? e.message : String(e);
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
