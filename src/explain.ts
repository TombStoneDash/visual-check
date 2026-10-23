/**
 * `visual-check explain` — turns a RunReport into a few short plain-words
 * sentences (and optionally speech), for a reader who wants the verdict
 * without the JSON/HTML. No browser, no network: reads an existing report.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { RunReport, TargetResult, TerminalState } from './types.js';

const VIEWPORT_LABELS: Record<string, string> = {
  mobile: 'phone',
  tablet: 'tablet',
  desktop: 'desktop',
};

function viewportLabel(name: string): string {
  return VIEWPORT_LABELS[name] ?? name;
}

/**
 * Short spoken name for a target: host (with any non-default port), path
 * and query, without the scheme or a leading "www.". The port and query are
 * kept because they name different pages: localhost:3000 is not
 * localhost:4000, and /p?id=1 is not /p?id=2.
 */
function siteLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host.replace(/^www\./, '');
    const pathPart = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${host}${pathPart}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Whole-percent wording: anything below 1% reads as "under 1%", not "0%". */
function formatChangedPct(pct: number): string {
  if (pct < 1) return 'under 1%';
  return `${Math.round(pct)}%`;
}

type ProblemKind = 'did_not_load' | 'could_not_check' | 'looks_different' | 'no_baseline';

const KIND_ORDER: ProblemKind[] = ['did_not_load', 'could_not_check', 'looks_different', 'no_baseline'];

/**
 * Most target results map to a single plain-words problem, but a 'fail'
 * verdict can stem from either a bad HTTP check or a pixel diff — the
 * former ("did not load") is strictly more actionable than the latter
 * ("looks different"), so it wins when a target somehow has both.
 */
function kindFor(result: TargetResult): ProblemKind | null {
  if (result.verdict === 'error') return 'could_not_check';
  if (result.verdict === 'fail') {
    const httpFailed = result.checks.some((c) => c.name === 'http_status' && c.status === 'fail');
    return httpFailed ? 'did_not_load' : 'looks_different';
  }
  if (result.verdict === 'needs_baseline') return 'no_baseline';
  return null;
}

interface ProblemGroup {
  kind: ProblemKind;
  site: string;
  viewports: Set<string>;
  status: number | null;
  statusSeen: boolean;
  dimensionMismatch: boolean;
  maxDiffPct: number;
}

function viewportsPhraseFor(group: ProblemGroup, allViewports: string[]): string {
  if (allViewports.length > 0 && allViewports.every((v) => group.viewports.has(v))) {
    return 'on every screen size';
  }
  const ordered = allViewports.filter((v) => group.viewports.has(v));
  const extra = [...group.viewports].filter((v) => !allViewports.includes(v));
  return `on ${listPhrase([...ordered, ...extra].map(viewportLabel))}`;
}

function sentenceFor(group: ProblemGroup, allViewports: string[]): string {
  const viewportsPhrase = viewportsPhraseFor(group, allViewports);
  switch (group.kind) {
    case 'did_not_load': {
      const statusText = group.status !== null ? `error ${group.status}` : 'no response';
      return `${group.site} did not load ${viewportsPhrase} (${statusText}).`;
    }
    case 'could_not_check':
      return `${group.site} could not be checked ${viewportsPhrase}.`;
    case 'looks_different': {
      const diffText = group.dimensionMismatch
        ? 'the page size changed'
        : `${formatChangedPct(group.maxDiffPct)} changed`;
      return `${group.site} looks different ${viewportsPhrase} (${diffText}).`;
    }
    case 'no_baseline':
      return `${group.site} has no approved picture yet ${viewportsPhrase}.`;
  }
}

const TERMINAL_SENTENCE: Record<TerminalState, string> = {
  SHIPPED_PROVEN: 'Safe to continue.',
  READY_TO_REVIEW: 'Someone should open the report and look at the pictures.',
  BLOCKED_WITH_OWNER: 'Blocked: the pages that did not load need fixing first.',
};

export interface Explanation {
  headline: string;
  sentences: string[];
  text: string;
}

export function explainReport(report: RunReport): Explanation {
  const results = report.results;
  const total = results.length;
  const fineCount = results.filter((r) => r.pass).length;

  const headline =
    total === 0
      ? 'Nothing was checked.'
      : total === 1
        ? fineCount === 1
          ? '1 page checked. It is fine.'
          : '1 page checked. It has a problem.'
        : `${total} pages checked. ${fineCount} are fine.`;

  const allViewports = report.config.viewports;
  const groups = new Map<string, ProblemGroup>();
  const order: string[] = [];

  for (const result of results) {
    const kind = kindFor(result);
    if (!kind) continue;
    const site = siteLabel(result.url);
    // Group by the exact target, not its label: two targets that read alike
    // (http:// vs https://, www. vs bare) must not pool their screen sizes.
    const key = `${kind}|${result.url}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        kind,
        site,
        viewports: new Set(),
        status: null,
        statusSeen: false,
        dimensionMismatch: false,
        maxDiffPct: 0,
      };
      groups.set(key, group);
      order.push(key);
    }
    group.viewports.add(result.viewport);
    if (kind === 'did_not_load' && !group.statusSeen) {
      group.status = result.status;
      group.statusSeen = true;
    }
    if (kind === 'looks_different') {
      if (result.diff_percentage === null) {
        group.dimensionMismatch = true;
      } else if (result.diff_percentage > group.maxDiffPct) {
        group.maxDiffPct = result.diff_percentage;
      }
    }
  }

  const orderedGroups = order
    .map((key) => groups.get(key)!)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const allProblemSentences = orderedGroups.map((g) => sentenceFor(g, allViewports));

  let problemSentences: string[];
  if (allProblemSentences.length <= 4) {
    problemSentences = allProblemSentences;
  } else {
    const remaining = allProblemSentences.length - 3;
    problemSentences = [
      ...allProblemSentences.slice(0, 3),
      `And ${remaining} more problem${remaining === 1 ? '' : 's'}.`,
    ];
  }

  const sentences = [...problemSentences];
  if (problemSentences.length === 0 && report.summary.warnings > 0) {
    const count = report.summary.warnings;
    sentences.push(`${count} ${count === 1 ? 'page' : 'pages'} loaded with small warnings.`);
  }
  sentences.push(TERMINAL_SENTENCE[report.terminal_state]);

  const text = [headline, ...sentences].join(' ');
  return { headline, sentences, text };
}

export interface SpeakDeps {
  spawn?: typeof nodeSpawn;
  existsSync?: typeof nodeExistsSync;
  platform?: NodeJS.Platform;
  sayPath?: string;
}

/**
 * Speak `text` aloud via macOS `say`. Never shells out through a shell
 * (args passed as an array), and never throws: a missing binary or
 * non-macOS platform degrades to a stderr notice, and a `say` failure is
 * ignored once it has been spawned — explain's job is to inform, not to
 * fail a script because the machine has no audio device.
 */
export async function speak(text: string, deps: SpeakDeps = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const sayPath = deps.sayPath ?? '/usr/bin/say';
  const existsSync = deps.existsSync ?? nodeExistsSync;

  if (platform !== 'darwin' || !existsSync(sayPath)) {
    process.stderr.write('(speech is only available on macOS)\n');
    return;
  }

  const spawn = deps.spawn ?? nodeSpawn;
  await new Promise<void>((resolve) => {
    const child = spawn(sayPath, [text], { stdio: 'ignore' });
    child.on('error', () => resolve());
    child.on('exit', () => resolve());
  });
}
