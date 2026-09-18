import type { Verdict } from './types.js';

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

const VERDICT_META: Record<Verdict, { label: string; color: string; bg: string }> = {
  pass: { label: 'PASS', color: '#0a6', bg: '#e6f9f0' },
  warn: { label: 'WARN', color: '#b45', bg: '#fdf2e6' },
  fail: { label: 'FAIL', color: '#c22', bg: '#fde8e8' },
  error: { label: 'ERROR', color: '#333', bg: '#eee' },
  needs_baseline: { label: 'NEEDS BASELINE', color: '#55a', bg: '#eef1fa' },
};

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

function buildChecks(result: CompareReportResult): CheckRow[] {
  const { httpStatus, diffPercentage, verdict, consoleErrors, loadTimeMs } = result;

  const httpOk = httpStatus !== null && httpStatus >= 200 && httpStatus < 400;
  const diffStatus: CheckRow['status'] =
    diffPercentage === null ? 'skip' : verdict === 'fail' ? 'fail' : verdict === 'warn' ? 'warn' : 'pass';

  return [
    {
      name: 'http_status',
      status: httpStatus === null ? 'fail' : httpOk ? 'pass' : 'fail',
      message: httpStatus === null ? 'no response' : `HTTP ${httpStatus}`,
    },
    {
      name: 'pixel_diff',
      status: diffStatus,
      message: diffPercentage === null ? 'not compared' : `${diffPercentage}% difference`,
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
        <td>${esc(r.status)}</td>
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Visual Check Compare</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0; padding: 0; background: #fafafa; color: #111; }
  main { padding: 24px 32px; max-width: 1400px; margin: 0 auto; }
  .banner { padding: 16px 24px; font-weight: 700; font-size: 16px; letter-spacing: .5px; color: ${v.color}; background: ${v.bg}; border-bottom: 1px solid rgba(0,0,0,.08); }
  .meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: #666; margin: 16px 0; }
  .meta b { color: inherit; }
  .gallery { display: grid; grid-template-columns: repeat(${images.length}, 1fr); gap: 12px; margin: 16px 0; }
  figure { margin: 0; background: #f5f5f5; border: 1px solid #eaeaea; border-radius: 4px; overflow: hidden; }
  figure figcaption { font-size: 11px; font-weight: 600; padding: 6px 10px; color: #666; border-bottom: 1px solid #eaeaea; word-break: break-all; }
  figure img { width: 100%; height: auto; display: block; }
  figure .placeholder { height: 120px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px; }
  table.checks { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; }
  table.checks th, table.checks td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  table.checks thead { background: #f1f1f1; }
  tr.check-pass td:nth-child(2) { color: #0a6; font-weight: 600; }
  tr.check-warn td:nth-child(2) { color: #b45; font-weight: 600; }
  tr.check-fail td:nth-child(2) { color: #c22; font-weight: 600; }
  tr.check-skip td:nth-child(2) { color: #999; }
  .console-errors { margin: 8px 0; padding-left: 20px; color: #b45; font-size: 12px; }
  code { font: 12px/1 ui-monospace, Menlo, Consolas, monospace; }
</style>
</head>
<body>
  <div class="banner">${v.label}</div>
  <main>
    <div class="meta">
      <span>baseline: <b>${esc(result.baseline.url)}</b></span>
      <span>current: <b>${esc(result.current.url)}</b></span>
      <span>status: <b>${result.httpStatus ?? '—'}</b></span>
      <span>diff: <b>${result.diffPercentage != null ? result.diffPercentage + '%' : '—'}</b></span>
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
