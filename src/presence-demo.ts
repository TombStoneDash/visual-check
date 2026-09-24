/**
 * Daisy Presence demo panel + hosted demo site renderer.
 *
 * Mirrors `apps/daisy-presence` (DaisyPresenceCore) from
 * TombStoneDash/daisy-personal-assistant: the same seven states, the same
 * snapshot fields, the same fail-closed rule. Every snapshot here is
 * synthetic and labeled as such — this module never reads Hermes state and
 * never claims to. It is pure and synchronous: no filesystem, no network.
 */

export const PRESENCE_STATES = [
  'OFFLINE',
  'IDLE',
  'THINKING',
  'BUILDING',
  'WAITING_FOR_HUDSON',
  'BLOCKED',
  'DONE',
] as const;

export type PresenceState = (typeof PRESENCE_STATES)[number];

export interface PresenceSnapshot {
  state: PresenceState;
  task: string | null;
  project: string | null;
  worker: string | null;
  model: string | null;
  machine: string | null;
  /** ISO timestamp of the last dispatch heartbeat, or null when unknown. */
  lastHeartbeat: string | null;
  /** ISO timestamp of the worker event the elapsed figure is based on. */
  referenceEventAt: string | null;
  latestAction: string | null;
  blocker: string | null;
  nextAction: string | null;
  proofCitation: string | null;
  isStale: boolean;
  isUnverified: boolean;
  freshnessReason: string | null;
}

/** Glyph + word for the menu-bar pulse, same table as PulseSummary.swift. */
export interface MiniMood {
  glyph: string;
  word: string;
}

const DEMO_REFERENCE_MS = 1_800_000_000 * 1000;

function iso(offsetSeconds: number): string {
  return new Date(DEMO_REFERENCE_MS + offsetSeconds * 1000).toISOString();
}

function demoStep(
  state: Exclude<PresenceState, 'OFFLINE'>,
  offsetSeconds: number,
  nextAction: string,
  blocker: string | null = null,
): PresenceSnapshot {
  const at = iso(offsetSeconds);
  return {
    state,
    task: 'DEMO-TASK-0001',
    project: 'DEMO',
    worker: 'daisy-demo-worker',
    model: 'demo-model',
    machine: 'demo-machine.local',
    lastHeartbeat: at,
    referenceEventAt: at,
    latestAction: `daisy-demo-worker reported ${state}`,
    blocker,
    nextAction,
    proofCitation: `demo://receipts/${state.toLowerCase()}`,
    isStale: false,
    isUnverified: false,
    freshnessReason: null,
  };
}

/** The fail-closed default: no data source, no claims. Mirrors PresenceSnapshot.offline(reason:). */
export function offlineSnapshot(reason: string): PresenceSnapshot {
  return {
    state: 'OFFLINE',
    task: null,
    project: null,
    worker: null,
    model: null,
    machine: null,
    lastHeartbeat: null,
    referenceEventAt: null,
    latestAction: null,
    blocker: null,
    nextAction: null,
    proofCitation: null,
    isStale: true,
    isUnverified: true,
    freshnessReason: reason,
  };
}

/**
 * One snapshot per state, in the order the app's DemoSequence plays them,
 * plus the OFFLINE fail-closed case first. Synthetic, clearly labeled.
 */
export const DEMO_SNAPSHOTS: readonly PresenceSnapshot[] = [
  offlineSnapshot('demo: no Hermes state files on this machine — fail closed'),
  demoStep('IDLE', 0, 'Assign or start a task'),
  demoStep('THINKING', 30, 'Continue monitoring — worker is active'),
  demoStep('BUILDING', 90, 'Continue monitoring — worker is active'),
  demoStep('BLOCKED', 180, 'Resolve the reported blocker before continuing', 'demo: required approval not yet granted'),
  demoStep('WAITING_FOR_HUDSON', 210, 'Wait for Hudson to respond, then resume the task'),
  demoStep('DONE', 300, 'No action needed — task complete'),
];

/** Same fail-closed rule as PulseSummary.miniMood: unverified always reads offline. */
export function miniMood(snapshot: PresenceSnapshot): MiniMood {
  if (snapshot.isUnverified) return { glyph: '○', word: 'offline' };
  switch (snapshot.state) {
    case 'BUILDING':
      return { glyph: '●', word: 'building' };
    case 'THINKING':
      return { glyph: '◐', word: 'thinking' };
    case 'BLOCKED':
      return { glyph: '■', word: 'blocked' };
    case 'WAITING_FOR_HUDSON':
      return { glyph: '◔', word: 'waiting' };
    case 'DONE':
      return { glyph: '✓', word: 'done' };
    case 'IDLE':
    case 'OFFLINE':
      return { glyph: '○', word: snapshot.state === 'IDLE' ? 'idle' : 'offline' };
  }
}

export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

const STATE_COLOR: Record<PresenceState, string> = {
  OFFLINE: '#565f89',
  IDLE: '#7aa2f7',
  THINKING: '#bb9af7',
  BUILDING: '#9ece6a',
  WAITING_FOR_HUDSON: '#e0af68',
  BLOCKED: '#f7768e',
  DONE: '#73daca',
};

export function stateColor(state: PresenceState): string {
  return STATE_COLOR[state];
}

function row(label: string, value: string | null): string {
  return `<div class="row"><span class="k">${esc(label)}</span><span class="v">${value === null ? '—' : esc(value)}</span></div>`;
}

function fmtTime(isoString: string | null): string | null {
  if (!isoString) return null;
  return isoString.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

/**
 * Elapsed time between this snapshot's `referenceEventAt` and the given
 * reference "now" ISO string. When `referenceEventAtIso` is null or fails to
 * parse, falls back to the snapshot's own `referenceEventAt` so a card
 * rendered on its own reads `0s` instead of borrowing an unrelated clock.
 */
export function elapsedLabel(s: PresenceSnapshot, referenceEventAtIso: string | null): string | null {
  if (!s.referenceEventAt) return null;
  const ref = Date.parse(s.referenceEventAt);
  const parsedNow = referenceEventAtIso ? Date.parse(referenceEventAtIso) : NaN;
  const now = Number.isNaN(parsedNow) ? ref : parsedNow;
  const secs = Math.max(0, Math.round((now - ref) / 1000));
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

/** Render one popover card, the same rows PopoverContentView.swift shows. */
export function renderPopover(s: PresenceSnapshot, index: number, referenceEventAtIso: string | null = null): string {
  const flag =
    s.isStale && s.isUnverified
      ? 'Stale & unverified'
      : s.isStale
        ? 'Stale'
        : s.isUnverified
          ? 'Unverified'
          : '';
  const mood = miniMood(s);
  return `<article class="popover" data-state="${esc(s.state)}" data-index="${index}" ${index === 0 ? '' : 'hidden'} aria-label="Daisy Presence ${esc(s.state)}">
  <header style="--c:${stateColor(s.state)}">
    <span class="glyph" aria-hidden="true">${esc(mood.glyph)}</span>
    <h3>${esc(s.state)}</h3>
    ${flag ? `<span class="flag">⚠ ${esc(flag)}</span>` : ''}
  </header>
  <div class="rows">
    ${row('Task', s.task)}
    ${row('Project', s.project)}
    ${row('Worker / Model / Machine', [s.worker, s.model, s.machine].map((x) => x ?? '—').join(' / '))}
    ${row('Elapsed', elapsedLabel(s, referenceEventAtIso))}
    ${row('Last heartbeat', fmtTime(s.lastHeartbeat))}
    ${row('Latest action', s.latestAction)}
    ${row('Blocker', s.blocker)}
    ${row('Next action', s.nextAction)}
    ${row('Proof citation', s.proofCitation)}
  </div>
  ${s.freshnessReason ? `<p class="reason">${esc(s.freshnessReason)}</p>` : ''}
</article>`;
}

/** The whole Presence panel: a menu-bar mock, the state strip, and one popover per snapshot. */
export function renderPresencePanel(snapshots: readonly PresenceSnapshot[] = DEMO_SNAPSHOTS): string {
  const first = snapshots[0];
  const firstMood = first ? miniMood(first) : { glyph: '○', word: 'offline' };
  let referenceNow: string | null = null;
  let referenceNowMs = -Infinity;
  for (const s of snapshots) {
    if (!s.referenceEventAt) continue;
    const ms = Date.parse(s.referenceEventAt);
    if (Number.isNaN(ms) || ms <= referenceNowMs) continue;
    referenceNow = s.referenceEventAt;
    referenceNowMs = ms;
  }
  const strip = snapshots
    .map(
      (s, i) =>
        `<button class="state-btn" data-index="${i}" style="--c:${stateColor(s.state)}" aria-pressed="${i === 0}"><kbd>${i + 1}</kbd> ${esc(s.state)}</button>`,
    )
    .join('');
  return `<section id="presence" class="presence" aria-label="Daisy Presence demo panel">
  <div class="menubar" role="img" aria-label="macOS menu bar with the Daisy Presence item">
    <span class="apple">&#63743;</span><span class="app">Finder</span>
    <span class="spacer"></span>
    <span class="menubar-item" id="menubar-item"><span class="glyph" style="color:${stateColor(first?.state ?? 'OFFLINE')}">${esc(firstMood.glyph)}</span> Daisy · <span id="menubar-word">${esc(firstMood.word)}</span></span>
    <span class="clock">9:41 AM</span>
  </div>
  <div class="strip" role="tablist" aria-label="Presence states">${strip}</div>
  <div class="popovers">${snapshots.map((s, i) => renderPopover(s, i, referenceNow)).join('\n')}</div>
  <p class="note">Synthetic snapshot, same seven states and the same fail-closed rule as the shipped menu-bar app. Press <kbd>1</kbd>–<kbd>${snapshots.length}</kbd> or <kbd>Space</kbd> to step. OFFLINE is the only state the app may invent on its own.</p>
</section>`;
}

export interface CompareCard {
  /** "pass" | "fail" */
  name: string;
  verdict: string;
  /** e.g. "0%" or "12.5%" */
  diffLabel: string;
  threshold: string;
  reportHref: string;
  screenshots: { label: string; src: string }[];
}

export interface DemoSiteInput {
  presence: readonly PresenceSnapshot[];
  compare: CompareCard[];
  dmgUrl: string;
  dmgSha256: string | null;
  presenceRepoUrl: string;
  visualCheckRepoUrl: string;
  daisyDeskSpecUrl: string;
  builtAt: string;
}

function compareCard(c: CompareCard): string {
  const shots = c.screenshots
    .map((s) => `<figure><img src="${esc(s.src)}" alt="${esc(s.label)}" loading="lazy"/><figcaption>${esc(s.label)}</figcaption></figure>`)
    .join('');
  return `<article class="card verdict-${esc(c.verdict)}">
  <header><span class="badge">${esc(c.verdict.toUpperCase())}</span><h3>${esc(c.name)}</h3><span class="meta">pixel diff ${esc(c.diffLabel)} · threshold ${esc(c.threshold)}</span></header>
  <div class="shots">${shots}</div>
  <a class="btn" href="${esc(c.reportHref)}">Open full report</a>
</article>`;
}

/** Render the whole hosted demo page as one self-contained HTML string. */
export function renderDemoSite(input: DemoSiteInput): string {
  const cards = input.compare.map(compareCard).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Daisy Presence + Visual Check</title>
<meta name="description" content="A menu-bar agent presence for macOS and deploy-time visual verification, both live and testable."/>
<style>
  :root { --bg:#1a1b26; --bg2:#24283b; --bg3:#2f3549; --fg:#c0caf5; --dim:#9aa5ce; --line:#3b4261; --accent:#7aa2f7; --ok:#9ece6a; --bad:#f7768e; }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif; }
  a { color:var(--accent); }
  main { max-width:1080px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:2rem; margin:0 0 6px; letter-spacing:-.01em; }
  h2 { font-size:1.25rem; margin:48px 0 12px; border-bottom:1px solid var(--line); padding-bottom:8px; }
  h3 { margin:0; font-size:1rem; }
  p.lead { color:var(--dim); margin:0 0 18px; max-width:64ch; }
  kbd { font:12px ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--bg3); border:1px solid var(--line); border-radius:4px; padding:1px 5px; }
  .btn { display:inline-block; background:var(--accent); color:#1a1b26; font-weight:600; padding:9px 14px; border-radius:6px; text-decoration:none; }
  .btn.secondary { background:var(--bg3); color:var(--fg); border:1px solid var(--line); }
  .ctas { display:flex; gap:10px; flex-wrap:wrap; margin:14px 0 6px; }
  .presence { background:var(--bg2); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .menubar { display:flex; align-items:center; gap:14px; padding:6px 12px; background:#111827; color:#e5e7eb; font-size:13px; border-bottom:1px solid var(--line); }
  .menubar .apple { font-size:15px; } .menubar .app { font-weight:600; } .menubar .spacer { flex:1; }
  .menubar-item { background:rgba(255,255,255,.08); border-radius:5px; padding:2px 8px; }
  .strip { display:flex; flex-wrap:wrap; gap:6px; padding:12px; border-bottom:1px solid var(--line); }
  .state-btn { background:var(--bg3); color:var(--fg); border:1px solid var(--line); border-left:4px solid var(--c); border-radius:6px; padding:6px 10px; font:13px inherit; cursor:pointer; }
  .state-btn[aria-pressed="true"] { background:var(--c); color:#1a1b26; border-color:var(--c); }
  .popovers { padding:16px; }
  .popover { background:#fff; color:#111; border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.45); max-width:420px; margin:0 auto; overflow:hidden; }
  .popover header { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid #e5e7eb; border-top:4px solid var(--c); }
  .popover header .glyph { color:var(--c); font-size:18px; }
  .popover .flag { margin-left:auto; color:#b45309; font-size:12px; }
  .popover .rows { padding:6px 14px 10px; }
  .popover .row { display:grid; grid-template-columns:160px 1fr; gap:8px; font-size:12.5px; padding:4px 0; border-bottom:1px solid #f1f5f9; }
  .popover .row .k { color:#6b7280; } .popover .row .v { word-break:break-word; }
  .popover .reason { margin:0; padding:8px 14px 12px; font-size:12px; color:#6b7280; }
  .note { padding:0 16px 16px; margin:0; font-size:13px; color:var(--dim); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px,1fr)); gap:16px; }
  .card { background:var(--bg2); border:1px solid var(--line); border-radius:10px; padding:14px; }
  .card header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
  .card .meta { color:var(--dim); font-size:12px; margin-left:auto; }
  .badge { font-weight:700; font-size:12px; padding:2px 8px; border-radius:4px; color:#1a1b26; background:var(--ok); }
  .verdict-fail .badge { background:var(--bad); }
  .shots { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:12px; }
  .shots figure { margin:0; background:var(--bg3); border-radius:6px; overflow:hidden; }
  .shots img { width:100%; height:auto; display:block; }
  .shots figcaption { font-size:11px; color:var(--dim); padding:4px 6px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:600; }
  code { font:13px ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--bg3); padding:1px 5px; border-radius:4px; }
  footer { margin-top:56px; color:var(--dim); font-size:13px; }
  @media (max-width:640px){ .shots{grid-template-columns:1fr;} .popover .row{grid-template-columns:1fr;} }
</style>
</head>
<body>
<main>
  <h1>Daisy Presence + Visual Check</h1>
  <p class="lead">Two things an agent should be able to do on your Mac: show you what it is doing right now, and prove a deploy looks right before it says "done". Both are shipped, both are testable from this page.</p>
  <div class="ctas">
    <a class="btn" href="${esc(input.dmgUrl)}">Download DaisyPresence.dmg</a>
    <a class="btn secondary" href="#compare">See Visual Check reports</a>
    <a class="btn secondary" href="${esc(input.presenceRepoUrl)}">Presence source</a>
    <a class="btn secondary" href="${esc(input.visualCheckRepoUrl)}">Visual Check source</a>
  </div>
  ${input.dmgSha256 ? `<p class="lead" style="font-size:12px">DMG SHA-256 <code>${esc(input.dmgSha256)}</code></p>` : ''}

  <h2>Daisy Presence: the agent in your menu bar</h2>
  <p class="lead">A native macOS menu-bar app that reads the agent fleet's own state files and shows one of seven states. If the files are missing, stale, or contradict each other it shows OFFLINE rather than guessing. This panel replays a synthetic snapshot of every state.</p>
  ${renderPresencePanel(input.presence)}

  <h2 id="compare">Visual Check: proof before "done"</h2>
  <p class="lead">Two real runs of <code>visual-check compare</code> against the repo's demo fixtures, generated when this page was built. Deterministic: Playwright + pixelmatch + four checks, no model in the verdict path.</p>
  <div class="grid">
${cards}
  </div>

  <h2>What is real, what is not</h2>
  <table>
    <tr><th>Item</th><th>Status</th></tr>
    <tr><td>Daisy Presence macOS app, seven states, fail-closed mapping, 100+ self-tests</td><td>Shipped, signed DMG above</td></tr>
    <tr><td>Presence panel on this page</td><td>Synthetic snapshot rendered from the same state model. Not connected to a live fleet.</td></tr>
    <tr><td>Visual Check <code>compare</code>, JSON verdict, HTML report, changed-region overlay</td><td>Shipped. Reports above are real output.</td></tr>
    <tr><td>Supabase storage, Telegram alerts, hosted dashboard</td><td>Not in this demo</td></tr>
    <tr><td>Daisy Desk (Omarchy-style window and file manager for macOS)</td><td>Spec only: <a href="${esc(input.daisyDeskSpecUrl)}">docs/DAISY_DESK.md</a></td></tr>
  </table>

  <footer>Built ${esc(input.builtAt)} from <a href="${esc(input.visualCheckRepoUrl)}">visual-check</a> and <a href="${esc(input.presenceRepoUrl)}">daisy-personal-assistant</a>. No analytics, no network calls from this page.</footer>
</main>
<script>
(function(){
  var pops = Array.prototype.slice.call(document.querySelectorAll('.popover'));
  var btns = Array.prototype.slice.call(document.querySelectorAll('.state-btn'));
  var word = document.getElementById('menubar-word');
  var item = document.getElementById('menubar-item');
  var moods = ${JSON.stringify(input.presence.map((s) => ({ ...miniMood(s), color: stateColor(s.state) })))};
  var cur = 0;
  function show(i){
    cur = (i + pops.length) % pops.length;
    pops.forEach(function(p, j){ p.hidden = j !== cur; });
    btns.forEach(function(b, j){ b.setAttribute('aria-pressed', String(j === cur)); });
    if (word) word.textContent = moods[cur].word;
    if (item) item.querySelector('.glyph').textContent = moods[cur].glyph, item.querySelector('.glyph').style.color = moods[cur].color;
  }
  btns.forEach(function(b){ b.addEventListener('click', function(){ show(Number(b.dataset.index)); }); });
  document.addEventListener('keydown', function(e){
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    var n = Number(e.key);
    if (n >= 1 && n <= pops.length) { show(n - 1); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); }
  });
})();
</script>
</body>
</html>
`;
}
