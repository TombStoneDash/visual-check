import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RunReport, TargetResult, Verdict } from './types.js';

/**
 * Single-file HTML report. No server, no dashboard — just a standalone
 * artifact that a human can open and scan in 15 seconds to triage a
 * failure. Screenshots are embedded as data URIs so the file is fully
 * portable (email it, upload it to Supabase, attach it to a Telegram
 * alert — it always renders).
 */
export async function renderHtmlReport(report: RunReport, outPath: string): Promise<void> {
  const abs = path.resolve(outPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const html = await buildHtml(report);
  await fs.writeFile(abs, html, 'utf8');
}

/** Convenience: given a JSON report path, give back the adjacent HTML path. */
export function htmlReportPathFor(jsonPath: string): string {
  const parsed = path.parse(jsonPath);
  return path.join(parsed.dir, `${parsed.name}.html`);
}

async function toDataUri(filePath: string | null): Promise<string | null> {
  if (!filePath) return null;
  try {
    const buf = await fs.readFile(filePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const VERDICT_META: Record<Verdict, { label: string; color: string; bg: string }> = {
  pass: { label: 'PASS', color: '#0a6', bg: '#e6f9f0' },
  warn: { label: 'WARN', color: '#b45', bg: '#fdf2e6' },
  fail: { label: 'FAIL', color: '#c22', bg: '#fde8e8' },
  error: { label: 'ERROR', color: '#333', bg: '#eee' },
  needs_baseline: { label: 'NEEDS BASELINE', color: '#55a', bg: '#eef1fa' },
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

async function renderTarget(t: TargetResult, idx: number): Promise<string> {
  const v = VERDICT_META[t.verdict];
  const [baselineUri, screenshotUri, diffUri] = await Promise.all([
    toDataUri(t.baseline),
    toDataUri(t.screenshot),
    toDataUri(t.diff_image),
  ]);
  const cellImg = (uri: string | null, label: string): string =>
    uri
      ? `<figure><figcaption>${label}</figcaption><img src="${uri}" alt="${label}"/></figure>`
      : `<figure class="missing"><figcaption>${label}</figcaption><div class="placeholder">—</div></figure>`;

  const reasonsHtml = t.reasons.length
    ? `<ul class="reasons">${t.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
    : '';

  const checksHtml = t.checks
    .map((c) => {
      const cls =
        c.status === 'pass' ? 'check-pass' : c.status === 'warn' ? 'check-warn' : c.status === 'fail' ? 'check-fail' : c.status === 'error' ? 'check-err' : 'check-skip';
      return `<tr class="${cls}">
        <td><code>${esc(c.name)}</code></td>
        <td>${esc(c.status)}</td>
        <td>${esc(c.mode)}</td>
        <td>${esc(c.message)}</td>
      </tr>`;
    })
    .join('');

  return `
    <section class="target" id="target-${idx}">
      <header>
        <span class="badge" style="color:${v.color};background:${v.bg}">${v.label}</span>
        <h2>${esc(t.url)}</h2>
        <div class="meta">
          <span>viewport: <b>${esc(t.viewport)}</b></span>
          <span>status: <b>${t.status ?? '—'}</b></span>
          <span>diff: <b>${t.diff_percentage != null ? t.diff_percentage + '%' : '—'}</b></span>
          <span>load: <b>${t.load_time_ms}ms</b></span>
          <span>console errs: <b>${t.console_errors}</b></span>
        </div>
      </header>
      ${reasonsHtml}
      <div class="triptych">
        ${cellImg(baselineUri, 'Baseline')}
        ${cellImg(screenshotUri, 'Actual')}
        ${cellImg(diffUri, 'Diff')}
      </div>
      <details>
        <summary>Per-check detail</summary>
        <table class="checks">
          <thead><tr><th>check</th><th>status</th><th>mode</th><th>message</th></tr></thead>
          <tbody>${checksHtml}</tbody>
        </table>
      </details>
    </section>
  `;
}

async function buildHtml(report: RunReport): Promise<string> {
  const overall = VERDICT_META[report.pass ? 'pass' : 'fail'];
  const targets = await Promise.all(report.results.map((r, i) => renderTarget(r, i)));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Visual Check — ${esc(report.run_id)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0; padding: 0; background: #fafafa; color: #111; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    .target { background: #1a1a1a; border-color: #2a2a2a; }
    figure { background: #0f0f0f; border-color: #2a2a2a; }
    thead { background: #1f1f1f; }
    tr { border-color: #2a2a2a; }
    details summary { color: #aaa; }
  }
  header.top { padding: 24px 32px; background: #fff; border-bottom: 1px solid #eaeaea; position: sticky; top: 0; z-index: 10; }
  @media (prefers-color-scheme: dark) { header.top { background: #191919; border-color: #2a2a2a; } }
  header.top h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
  header.top .sub { color: #666; font-size: 12px; }
  header.top .counts { margin-top: 12px; display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; }
  header.top .counts span { padding: 4px 10px; border-radius: 999px; background: #f1f1f1; }
  @media (prefers-color-scheme: dark) { header.top .counts span { background: #252525; } }
  .overall { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: 600; font-size: 13px; margin-left: 8px; }
  main { padding: 24px 32px; max-width: 1400px; margin: 0 auto; }
  .target { margin: 0 0 24px; padding: 20px; background: #fff; border: 1px solid #eaeaea; border-radius: 8px; }
  .target header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .target h2 { margin: 0; font-size: 15px; font-weight: 500; word-break: break-all; flex: 1 1 auto; }
  .badge { font-size: 11px; font-weight: 700; letter-spacing: .5px; padding: 3px 10px; border-radius: 4px; }
  .meta { width: 100%; display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: #666; }
  .meta b { color: inherit; }
  .reasons { margin: 8px 0 16px; padding-left: 20px; color: #c22; font-size: 13px; }
  .triptych { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  figure { margin: 0; background: #f5f5f5; border: 1px solid #eaeaea; border-radius: 4px; overflow: hidden; }
  figure figcaption { font-size: 11px; font-weight: 600; padding: 6px 10px; color: #666; border-bottom: 1px solid #eaeaea; text-transform: uppercase; letter-spacing: .5px; }
  figure img { width: 100%; height: auto; display: block; }
  figure .placeholder { height: 120px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 20px; }
  details { margin-top: 12px; }
  details summary { cursor: pointer; font-size: 12px; color: #666; padding: 4px 0; }
  table.checks { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  table.checks th, table.checks td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  table.checks thead { background: #fafafa; }
  tr.check-pass td:nth-child(2) { color: #0a6; font-weight: 600; }
  tr.check-warn td:nth-child(2) { color: #b45; font-weight: 600; }
  tr.check-fail td:nth-child(2) { color: #c22; font-weight: 600; }
  tr.check-err  td:nth-child(2) { color: #333; font-weight: 600; }
  tr.check-skip td { color: #999; }
  code { font: 12px/1 ui-monospace, Menlo, Consolas, monospace; }
</style>
</head>
<body>
  <header class="top">
    <h1>Visual Check <span class="overall" style="color:${overall.color};background:${overall.bg}">${overall.label}</span></h1>
    <div class="sub">
      run <code>${esc(report.run_id)}</code> · ${esc(report.timestamp)} · lane
      <code>${esc(report.config.lane.browser)}/${esc(report.config.lane.os)}/${esc(report.config.lane.runner)}</code>
      · terminal <code>${esc(report.terminal_state)}</code>
    </div>
    <div class="counts">
      <span>total: <b>${report.summary.total}</b></span>
      <span>passed: <b>${report.summary.passed}</b></span>
      <span>warnings: <b>${report.summary.warnings}</b></span>
      <span>failed: <b>${report.summary.failed}</b></span>
      <span>errors: <b>${report.summary.errors}</b></span>
      <span>needs baseline: <b>${report.summary.needs_baseline}</b></span>
      <span>threshold: <b>${report.config.pixel_diff_threshold}%</b></span>
      <span>load warn: <b>${report.config.load_time_warn_ms}ms</b></span>
    </div>
  </header>
  <main>
    ${targets.join('\n')}
  </main>
</body>
</html>`;
}
