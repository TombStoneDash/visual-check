/**
 * Telegram alerts — Phase 2.
 *
 * Fires when a deploy-gate run produces any non-pass verdict. The message
 * includes a short summary + a signed URL to the full HTML report.
 *
 * Tests stub global `fetch`.
 */
import { RunReport } from './types.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const EMOJI: Record<string, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  error: '🔥',
  needs_baseline: '📸',
};

/** Max failing-target lines to inline in the Telegram message body. The full
 *  list always lives in the HTML report; the message just teases the first N. */
const MAX_TELEGRAM_FAILING = 10;
export const TELEGRAM_MAX_CHARS = 4000;

function shorten(input: string, maxChars: number): string {
  return input.length > maxChars ? input.slice(0, maxChars - 1) + '…' : input;
}

export function buildTelegramMessage(run: RunReport, signedReportUrl: string): string {
  const verdict = deriveVerdict(run);
  const emoji = EMOJI[verdict] ?? 'ℹ️';
  const project = run.projectId ?? 'visual-check';
  const s = run.summary;
  const header = `${emoji} <b>Visual Check ${verdict.toUpperCase()}</b> — <code>${escapeHtml(project)}</code>`;
  const meta: string[] = [];
  if (run.deploymentUrl) meta.push(`Deploy: ${escapeHtml(shorten(run.deploymentUrl, 120))}`);
  if (run.branch) meta.push(`Branch: <code>${escapeHtml(run.branch)}</code>`);
  if (run.commitSha) meta.push(`Commit: <code>${escapeHtml(run.commitSha.slice(0, 7))}</code>`);
  const summaryLine =
    `Targets: ${s.total} · ✅ ${s.passed} · ⚠️ ${s.warnings} · ❌ ${s.failed} · 🔥 ${s.errors} · 📸 ${s.needs_baseline}`;

  const failingTargets = run.results.filter(
    (r) => r.verdict === 'fail' || r.verdict === 'error' || r.verdict === 'needs_baseline',
  );
  const cap = Math.min(failingTargets.length, MAX_TELEGRAM_FAILING);
  const failing = failingTargets.slice(0, cap).map((r) => {
    const reason = r.reasons[0] ?? r.verdict;
    return `• <code>${escapeHtml(shorten(r.url, 120))}</code> @ ${escapeHtml(r.viewport)} — ${escapeHtml(shorten(reason, 160))}`;
  });
  const link = `\n\n<a href="${escapeHtml(signedReportUrl).replace(/"/g, '&quot;')}">Open HTML report</a>`;
  const render = (): string => {
    const overflowCount = failingTargets.length - failing.length;
    const overflowLine =
      overflowCount > 0 ? `…and ${overflowCount} more in the HTML report` : null;
    const failingBlock =
      failingTargets.length > 0
        ? ['', '<b>Failing:</b>', ...failing, ...(overflowLine ? [overflowLine] : [])].join('\n')
        : '';
    return [header, ...meta, '', summaryLine, failingBlock].filter(Boolean).join('\n') + link;
  };

  let message = render();
  while (message.length > TELEGRAM_MAX_CHARS && failing.length > 0) {
    failing.pop();
    message = render();
  }
  // An oversized fixed section cannot fit without corrupting the report link
  // or discarding required context. Never return an over-budget payload.
  if (message.length > TELEGRAM_MAX_CHARS) {
    throw new Error('Telegram header, metadata, summary and report link exceed the character budget');
  }
  return message;
}

export async function sendTelegramAlert(
  run: RunReport,
  signedReportUrl: string,
): Promise<void> {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requireEnv('TELEGRAM_CHAT_ID');
  const text = buildTelegramMessage(run, signedReportUrl);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

function deriveVerdict(run: RunReport): string {
  const s = run.summary;
  if (s.errors > 0) return 'error';
  if (s.failed > 0) return 'fail';
  if (s.needs_baseline > 0) return 'needs_baseline';
  if (s.warnings > 0) return 'warn';
  return 'pass';
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
