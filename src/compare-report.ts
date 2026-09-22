import type { Verdict } from './types.js';
import { contrastRatio } from './report-theme.js';

/**
 * One side of a baseline-vs-current comparison. `image` is the raw
 * screenshot bytes (e.g. a PNG buffer read by the caller) — this module
 * never touches the filesystem, so callers own reading files into buffers.
 */
export interface CompareReportSide {
  url: string;
  image?: Buffer | null;
}

export interface CompareReportResult {
  baseline: CompareReportSide;
  current: CompareReportSide;
  verdict: Verdict;
  diffPercentage: number | null;
  httpStatus: number | null;
  consoleErrors: string[];
  loadTimeMs: number;
  /** Optional visual diff image (e.g. pixelmatch output), shown as a third column. */
  diffImage?: Buffer | null;
}

// Re-exported so callers (and this module's own readability test) can check
// any colour pair used below against WCAG AA without duplicating the
// relative-luminance math already implemented for the other HTML report.
export { contrastRatio };

// Single source of truth for every colour used by the stylesheet below.
// Every text/background pair here is >= 4.5:1 (checked by
// test/compare-report.readability.test.ts) — pick new colours from here,
// never hard-code a hex value directly in the template.
const COLORS = {
  pageBg: '#fafafa',
  figureBg: '#f0f0f0',
  tableHeadBg: '#eeeeee',
  muted: '#595959',
  pass: '#0b6b46',
  passBg: '#e2f5ec',
  warn: '#8a4a00',
  warnBg: '#fbeee0',
  fail: '#a3221f',
  failBg: '#fbe4e4',
  error: '#333333',
  errorBg: '#eeeeee',
  needsBaseline: '#34366e',
  needsBaselineBg: '#eef1fa',
} as const;

const VERDICT_META: Record<Verdict, { label: string; color: string; bg: string }> = {
  pass: { label: 'PASS', color: COLORS.pass, bg: COLORS.passBg },
  warn: { label: 'WARN', color: COLORS.warn, bg: COLORS.warnBg },
  fail: { label: 'FAIL', color: COLORS.fail, bg: COLORS.failBg },
  error: { label: 'ERROR', color: COLORS.error, bg: COLORS.errorBg },
  needs_baseline: { label: 'NEEDS BASELINE', color: COLORS.needsBaseline, bg: COLORS.needsBaselineBg },
};

// Every fg/bg pair the stylesheet renders, so a readability test can walk
// this list and assert contrast + presence in the output instead of the
// list silently drifting from what the CSS actually declares.
export const COMPARE_REPORT_COLOR_PAIRS: ReadonlyArray<{ name: string; fg: string; bg: string }> = [
  { name: 'banner-pass', fg: COLORS.pass, bg: COLORS.passBg },
  { name: 'banner-warn', fg: COLORS.warn, bg: COLORS.warnBg },
  { name: 'banner-fail', fg: COLORS.fail, bg: COLORS.failBg },
  { name: 'banner-error', fg: COLORS.error, bg: COLORS.errorBg },
  { name: 'banner-needs_baseline', fg: COLORS.needsBaseline, bg: COLORS.needsBaselineBg },
  { name: 'check-pass', fg: COLORS.pass, bg: COLORS.pageBg },
  { name: 'check-warn', fg: COLORS.warn, bg: COLORS.pageBg },
  { name: 'check-fail', fg: COLORS.fail, bg: COLORS.pageBg },
  { name: 'check-skip', fg: COLORS.muted, bg: COLORS.pageBg },
  { name: 'muted-on-page', fg: COLORS.muted, bg: COLORS.pageBg },
  { name: 'muted-on-figure', fg: COLORS.muted, bg: COLORS.figureBg },
  { name: 'console-error', fg: COLORS.fail, bg: COLORS.pageBg },
];

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function toDataUri(image: Buffer | null | undefined): string | null {
  if (!image || image.length === 0) return null;
  return `data:image/png;base64,${image.toString('base64')}`;
}

function imageFigure(label: string, uri: string | null): string {
  if (!uri) {
    return `<figure class="missing"><figcaption>${esc(label)}</figcaption><div class="placeholder">No image captured</div></figure>`;
  }
  return `<figure><figcaption>${esc(label)}</figcaption><img src="${uri}" alt="${esc(label)}"/></figure>`;
}

interface CheckRow {
  name: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
}

// Rounds to at most 3 decimal places and drops trailing zeros, so
// 0.1 + 0.2 renders "0.3%" instead of "0.30000000000000004%".
function formatPercent(n: number): string {
  return `${Math.round(n * 1000) / 1000}`;
}

const STATUS_GLYPH: Record<CheckRow['status'], string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
  skip: '–',
};

const CHECK_STATUS_COLOR: Record<CheckRow['status'], string> = {
  pass: COLORS.pass,
  warn: COLORS.warn,
  fail: COLORS.fail,
  skip: COLORS.muted,
};

function buildChecks(result: CompareReportResult): CheckRow[] {
  const { httpStatus, diffPercentage, verdict, consoleErrors, loadTimeMs } = result;

  const httpOk = httpStatus !== null && httpStatus >= 200 && httpStatus < 400;
  // pixel_diff must describe the pixels, not the overall verdict: a run
  // that failed on HTTP status or console errors with an identical
  // screenshot is not a pixel failure, and 0% diff is always a pass.
  const diffStatus: CheckRow['status'] =
    diffPercentage === null
      ? 'skip'
      : diffPercentage === 0
        ? 'pass'
        : verdict === 'fail'
          ? 'fail'
          : verdict === 'warn'
            ? 'warn'
            : 'pass';

  return [
    {
      name: 'http_status',
      status: httpStatus === null ? 'fail' : httpOk ? 'pass' : 'fail',
      message: httpStatus === null ? 'no response' : `HTTP ${httpStatus}`,
    },
    {
      name: 'pixel_diff',
      status: diffStatus,
      message: diffPercentage === null ? 'not compared' : `${formatPercent(diffPercentage)}% difference`,
    },
    {
      name: 'console_errors',
      status: consoleErrors.length === 0 ? 'pass' : 'warn',
      message: `${consoleErrors.length} error${consoleErrors.length === 1 ? '' : 's'}`,
    },
    {
      name: 'load_time',
      status: 'skip',
      message: `${loadTimeMs}ms`,
    },
  ];
}

function checksTable(rows: CheckRow[]): string {
  const body = rows
    .map(
      (r) => `<tr class="check-${r.status}">
        <td><code>${esc(r.name)}</code></td>
        <td>${STATUS_GLYPH[r.status]} ${esc(r.status)}</td>
        <td>${esc(r.message)}</td>
      </tr>`,
    )
    .join('');
  return `<table class="checks">
    <thead><tr><th>check</th><th>status</th><th>detail</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/**
 * Render a baseline-vs-current compare result as a single self-contained
 * HTML string: no external assets, no scripts, screenshots inlined as data
 * URIs. Pure and synchronous — the caller is responsible for reading any
 * screenshot files into buffers before calling this.
 */
export function renderCompareReport(result: CompareReportResult): string {
  const v = VERDICT_META[result.verdict];
  const baselineUri = toDataUri(result.baseline.image);
  const currentUri = toDataUri(result.current.image);
  const diffUri = toDataUri(result.diffImage);

  const consoleErrorsHtml = result.consoleErrors.length
    ? `<ul class="console-errors">${result.consoleErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '';

  const images = [
    imageFigure(`Baseline — ${result.baseline.url}`, baselineUri),
    imageFigure(`Current — ${result.current.url}`, currentUri),
  ];
  if (diffUri) images.push(imageFigure('Diff', diffUri));

  const diffMeta = result.diffPercentage != null ? `${formatPercent(result.diffPercentage)}%` : '—';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Visual Check Compare</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 16px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 0; background: ${COLORS.pageBg}; color: #111; }
  main { padding: 24px 32px; max-width: 1400px; margin: 0 auto; }
  .banner { padding: 16px 24px; font-weight: 700; font-size: 18px; letter-spacing: .5px; color: ${v.color}; background: ${v.bg}; border-bottom: 1px solid rgba(0,0,0,.08); }
  .meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; color: ${COLORS.muted}; margin: 16px 0; }
  .meta b { color: inherit; }
  .gallery { display: grid; grid-template-columns: repeat(${images.length}, 1fr); gap: 12px; margin: 16px 0; }
  figure { margin: 0; background: ${COLORS.figureBg}; border: 1px solid #eaeaea; border-radius: 4px; overflow: hidden; }
  figure figcaption { font-size: 14px; font-weight: 600; padding: 6px 10px; color: ${COLORS.muted}; border-bottom: 1px solid #eaeaea; word-break: break-all; }
  figure img { width: 100%; height: auto; display: block; }
  figure .placeholder { height: 120px; display: flex; align-items: center; justify-content: center; color: ${COLORS.muted}; font-size: 14px; }
  table.checks { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  table.checks th, table.checks td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  table.checks thead { background: ${COLORS.tableHeadBg}; }
  tr.check-pass td:nth-child(2) { color: ${CHECK_STATUS_COLOR.pass}; font-weight: 600; }
  tr.check-warn td:nth-child(2) { color: ${CHECK_STATUS_COLOR.warn}; font-weight: 600; }
  tr.check-fail td:nth-child(2) { color: ${CHECK_STATUS_COLOR.fail}; font-weight: 600; }
  tr.check-skip td:nth-child(2) { color: ${CHECK_STATUS_COLOR.skip}; }
  .console-errors { margin: 8px 0; padding-left: 20px; color: ${COLORS.fail}; font-size: 14px; }
  code { font: 14px/1 ui-monospace, Menlo, Consolas, monospace; }
</style>
</head>
<body>
  <div class="banner">${v.label}</div>
  <main>
    <div class="meta">
      <span>baseline: <b>${esc(result.baseline.url)}</b></span>
      <span>current: <b>${esc(result.current.url)}</b></span>
      <span>status: <b>${result.httpStatus ?? '—'}</b></span>
      <span>diff: <b>${diffMeta}</b></span>
      <span>load: <b>${result.loadTimeMs}ms</b></span>
      <span>console errors: <b>${result.consoleErrors.length}</b></span>
    </div>
    <div class="gallery">${images.join('\n')}</div>
    ${consoleErrorsHtml}
    ${checksTable(buildChecks(result))}
  </main>
</body>
</html>`;
}
