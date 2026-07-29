# Visual Check

> Deploy-time visual verification for AI agents.
> Don't let your agent say "done" until it has shown its work.

[![ci](https://github.com/TombStoneDash/visual-check/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/TombStoneDash/visual-check/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)

---

## The problem

When you deploy code, you run tests. But tests can't see what actually got rendered. Your agent pushed a deploy. Did the layout break? Did text get cut off? Did the colors invert? You don't know until a user finds it.

Visual Check watches the deploy. It takes screenshots, compares them to approved baselines, runs four automated checks (pixel difference, HTTP status, console errors, load time), and gives you a verdict: **pass, warn, fail, error, or needs_baseline.**

If the verdict is `fail` or `error`, your agent stops. It doesn't promote the deploy. It rolls back or alerts. If it's `pass` or `warn`, it continues.

That's it.

**New: `visual-check compare`** — a credential-free command that diffs two
URLs or two local pages directly, no stored baseline required. See
[`HACKATHON_DEMO.md`](./HACKATHON_DEMO.md) for the 60-second live sequence,
or just run:

```bash
npm install && npm run build && npm run demo:smoke
```

**Currently dogfooded on TrashAlert** — deploy gate runs on every push, with Telegram alerts on failure and the HTML diff report attached. 113 unit tests pass on every CI run.

## Who it's for

- **DevOps engineers** running AI agent deployments who need deterministic safety gates.
- **AI engineers** building autonomous deployment systems and need rendered-output verification.
- **Teams** using Claude / Daisy / OpenClaw who deploy frequently and want visual regression coverage without false positives.

## How it works in 60 seconds

The package is **not yet published to npm**. Today you run it from a clean clone:

```bash
# 0. One-time setup
git clone https://github.com/TombStoneDash/visual-check.git
cd visual-check
npm install            # also runs `playwright install chromium`
npm run build          # compiles the CLI to dist/cli.js

# 1. Capture baselines (one time per site)
node dist/cli.js baseline --urls https://mysite.com

# 2. After a deploy, run a check
node dist/cli.js run --urls https://mysite.com --json report.json

# 3. Exit code tells your agent what to do
#    0 = pass/warn (continue), 1 = fail/error/needs_baseline (stop)

# The report.json has all the details. The report.html is human-readable.
```

Once we publish to npm, the same flow becomes:

```bash
npm install -g @noui/visual-check
visual-check baseline --urls https://mysite.com
visual-check run --urls https://mysite.com --json report.json
```

That's the core. Phase 2 adds cloud storage, Telegram alerts, and automated baseline approval.

---

## Install

### From source (today)

```bash
git clone https://github.com/TombStoneDash/visual-check.git
cd visual-check
npm install            # also runs `playwright install chromium` (~120 MB)
npm run build          # compiles the CLI to dist/cli.js (required)
```

Requires Node 20+. The CLI is invoked with either:

- `node dist/cli.js <command> ...` (works from any directory once built)
- `npm run cli -- <command> ...` (works from the repo root)

Examples below use `node dist/cli.js` because it is the most explicit.

### From npm (coming soon)

Not yet published. Once published, you will be able to:

```bash
npm install -g @noui/visual-check
visual-check <command> ...
# or one-off, no install:
npx @noui/visual-check <command> ...
```

We will update this README and tag a release when the npm package is live.

## Quick reference

### Capture baselines

```bash
node dist/cli.js baseline \
  --urls https://mysite.com,https://mysite.com/pricing,https://mysite.com/about \
  --viewports mobile,tablet,desktop \
  --out ./workspace
```

Writes `.png` baselines to `./workspace/baselines/`.

### Run a check

```bash
node dist/cli.js run \
  --urls https://mysite.com \
  --viewports mobile,desktop \
  --threshold 5 \
  --json reports/latest.json

# Exit code is 0 (pass/warn) or 1 (fail/error/needs_baseline), so it slots into bash pipelines.
```

Writes captured screenshots, diffs, and a JSON + HTML report. All file paths are relative to `--out` (default: current directory).

### Compare two pages directly (no stored baseline)

```bash
node dist/cli.js compare \
  --baseline https://mysite.com \
  --current  https://staging.mysite.com \
  --viewports mobile,desktop \
  --threshold 5 \
  --json reports/compare.json

# --baseline / --current also accept local file paths (resolved to file:// URLs),
# so you can compare two local HTML files with zero network access:
node dist/cli.js compare \
  --baseline old.html --current new.html \
  --json reports/compare.json
```

No credentials, no pre-seeded baseline store — `compare` captures both sides
in the same run, diffs them, and writes the same JSON/HTML/receipt artifacts
as `run`. Exit code is `0` (pass/warn) or `1` (fail/error/needs_baseline),
same as every other command. See [`HACKATHON_DEMO.md`](./HACKATHON_DEMO.md)
for a full walkthrough.

## Screenshots

_Placeholder — a real HTML report screenshot will be added before public launch. The report renders a three-column layout (mobile baseline / mobile capture / diff overlay), with a sticky summary header and collapsible per-check detail._

---

## The 4 V1 checks

| Check | Severity | Rule |
|-------|----------|------|
| `pixel_diff` | **blocking** | If `diff_percentage > --threshold` → fail |
| `http_status` | **blocking** | If 4xx/5xx or no response → fail |
| `console_errors` | warn | Any `console.error`, page errors, or blocked resources → warn |
| `load_time` | warn | If `loadTimeMs > --load-time-warn` → warn |

Verdict precedence: `error > fail > needs_baseline > warn > pass`.

## Viewports

Fixed for V1 so baselines stay stable:

| Viewport | Resolution | Device |
|----------|-----------|--------|
| mobile   | 390×844   | iPhone 14 Pro |
| tablet   | 768×1024  | iPad |
| desktop  | 1440×900  | Standard laptop |

## The verdict (JSON)

The agent reads `report.json`. Shape:

```json
{
  "schema_version": 1,
  "timestamp": "2026-04-17T20:00:00.000Z",
  "run_id": "vc_abc123",
  "config": {
    "urls": ["https://mysite.com"],
    "viewports": ["mobile", "desktop"],
    "pixel_diff_threshold": 5,
    "load_time_warn_ms": 3000
  },
  "results": [
    {
      "url": "https://mysite.com",
      "viewport": "mobile",
      "verdict": "pass",
      "pass": true,
      "status": 200,
      "diff_percentage": 0.412,
      "screenshot": "captures/2026-04-17/.../mysite-com/mobile.png",
      "baseline": "baselines/mysite-com/mobile.png",
      "diff_image": "diffs/2026-04-17/.../mysite-com/mobile.png",
      "console_errors": 0,
      "load_time_ms": 1180,
      "reasons": [],
      "checks": [ /* per-check verdicts */ ]
    }
  ],
  "summary": {
    "total": 2,
    "passed": 2,
    "failed": 0,
    "warnings": 0,
    "errors": 0,
    "needs_baseline": 0
  },
  "assertions": [
    {
      "name": "capture_completed",
      "status": "pass",
      "message": "All targets produced a capture result."
    }
  ],
  "terminal_state": "SHIPPED_PROVEN",
  "pass": true
}
```

When `--json` is set, Visual Check also writes an adjacent receipt, for example
`reports/latest.receipt.json`. The receipt repeats the terminal state, assertion
owners, report artifact paths, and the next action for worker handoff.

Terminal states:

| State | Meaning |
|-------|---------|
| `SHIPPED_PROVEN` | Captures completed, HTTP is healthy, baselines exist, diffs are within threshold, and warning checks are clean. |
| `READY_TO_REVIEW` | A human should review warnings, missing baselines, or visual diffs before promoting or fixing. |
| `BLOCKED_WITH_OWNER` | Runtime/capture or HTTP assertions failed and need an assigned owner before retry. |

Exit code logic:

```bash
if jq -e '.pass' report.json > /dev/null; then
  exit 0  # Proceed with deploy
else
  exit 1  # Stop and investigate
fi
```

## GitHub Actions

Two workflows ship in `.github/workflows/`:

**`ci.yml`** — runs typecheck + unit tests + build on every push/PR (no browser, ~30s).

**`visual-check.yml`** — on pull requests, waits for the Vercel preview deploy, runs Visual Check, uploads artifacts, and posts a PR comment with the summary (updates on re-runs).

Example from the PR comment:

```
✅ Visual Check passed

🖥️ desktop   mysite.com           → pass  (0.41% diff)
📱 mobile    mysite.com           → pass  (0.22% diff)
📊 1440×900 mysite.com/pricing    → warn  (console error: missing font)
```

## Phase 2: Daisy integration (coming soon)

When you enable Phase 2, Visual Check:

- **Stores baselines in Supabase** (not in git), so large PNG images don't bloat your repo.
- **Logs all runs to Postgres** — a full audit trail of what passed, failed, and changed.
- **Uploads artifacts to cloud storage** — captures, diffs, HTML reports are accessible via signed URLs.
- **Sends Telegram alerts** on deploy gate failures (with a link to the HTML report).
- **Auto-approves baselines** when you say "yes" to a changed screenshot (the `promote` command).

Required env vars:

```bash
SUPABASE_URL=<your-project-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<chat-id>
```

Setup guide: see `SETUP_REQUIRED.md`.

## Threshold guidance

**`--threshold 5`** (default): Catches layout shifts, color changes, and font rendering differences. Typical false-positive rate: 1–2% (usually antialiasing or font smoothing differences across OS/browser).

**`--threshold 1`**: Stricter. Catches tiny antialiasing changes. Use for pixel-perfect design system validation, but expect more flakes.

**`--threshold 10`**: Lenient. Use when you know typography or spacing will vary slightly (e.g., different OSes, different font loading states).

**Recommended start**: 5. If you see 10+ false positives in your first week, bump to 7–8.

## Security notes

Visual Check runs Playwright against URLs you provide. A few things to know:

- **Don't run untrusted URLs.** If an attacker controls the target URL, they could inject malicious JS into the Playwright context. Always validate URLs in CI.
- **Credentials go in env vars only.** Never hardcode Supabase keys or Telegram tokens in code. `.env.example` shows the template; actual values live in `.env` (gitignored) or CI secrets.
- **Baselines are not signed.** In V1, baselines are stored locally as PNGs. In Phase 2, they're in Supabase with row-level security. Don't assume a baseline is tamper-proof; use access controls.
- **Reports may contain sensitive data.** If your screenshots include user data or PII, keep reports private. In Phase 2, artifacts are stored in private Supabase buckets.

## Self-hosting

V1 runs entirely on your machine or CI runner (no external service). Clone, `npm install`, `npm run build`, then `node dist/cli.js run ...` (or `npm run cli -- run ...`).

For Phase 2 (Supabase + Telegram), you need:
- A Supabase project (free tier supports Visual Check easily)
- A Telegram bot token (create one via @BotFather on Telegram, free)
- `SUPABASE_SERVICE_ROLE_KEY` (keep this secret; it's used server-side only)

All source code is open. You can self-host the schema or fork the repo entirely.

## Hosted version (coming soon)

A hosted dashboard for Visual Check is on the roadmap: one-click baseline setup, visual diff UI, approval workflows, and Slack/Discord integrations.

**Waitlist link:** _(coming soon — placeholder)_

Until then, the CLI in this repo runs everything you need locally or in CI.

---

## For developers

### Commands

#### `baseline`

```bash
node dist/cli.js baseline \
  --urls https://mysite.com \
  --viewports mobile,tablet,desktop \
  --out ./workspace \
  --headed  # optional: show browser for debugging
```

| Flag | Default | Notes |
|------|---------|-------|
| `--urls` | required | Comma-separated. Bare hostnames get `https://` auto-prefixed. |
| `--viewports` | `mobile,tablet,desktop` | Subset of the three named sizes. |
| `--out` | `.` | Workspace root. Baselines go under `<out>/baselines/`. |
| `--headed` | off | Show the browser window (debugging). |

#### `run`

```bash
node dist/cli.js run \
  --urls https://mysite.com \
  --viewports mobile,desktop \
  --threshold 5 \
  --load-time-warn 3000 \
  --concurrency 3 \
  --json reports/latest.json \
  --html reports/latest.html
```

| Flag | Default | Notes |
|------|---------|-------|
| `--urls` | required | Same as `baseline`. |
| `--viewports` | `mobile,tablet,desktop` | |
| `--out` | `.` | Workspace root. Captures go under `<out>/captures/`. |
| `--threshold` | `5` | Pixel diff % to trigger fail. |
| `--load-time-warn` | `3000` | Load-time warning threshold in ms. |
| `--concurrency` | `3` | Parallel captures (1–16). Higher = faster but uses more memory. |
| `--json <path>` | — | Write JSON verdict here (recommended for agents). |
| `--html <path>` | — | Write HTML report here. Auto-generated adjacent to `--json` if not set. |
| `--receipt <path>` | adjacent to `--json` | Write terminal-state receipt here. |
| `--no-html` | off | Skip HTML generation. |
| `--quiet` | off | Suppress per-target output lines. |
| `--headed` | off | Show browser. |

Exit code: `0` (pass/warn), `1` (fail/error/needs_baseline), `2` (fatal CLI error).

#### `compare`

```bash
node dist/cli.js compare \
  --baseline https://mysite.com \
  --current  https://staging.mysite.com \
  --viewports mobile,desktop \
  --threshold 5 \
  --json reports/compare.json
```

| Flag | Default | Notes |
|------|---------|-------|
| `--baseline` | required | URL or local file path. Local paths resolve to `file://` URLs. |
| `--current` | required | Same as `--baseline`. This is the side reports label as the target `url`. |
| `--viewports` | `mobile,desktop` | Subset of the three named sizes. |
| `--out` | `.` | Workspace root. Captures go under `<out>/compare/<timestamp>/`. |
| `--threshold` | `5` | Pixel diff % to trigger fail. |
| `--load-time-warn` | `3000` | Load-time warning threshold in ms. |
| `--concurrency` | `2` | Parallel viewport captures. |
| `--json <path>` | — | Write JSON verdict here. |
| `--html <path>` | — | Write HTML report here. Defaults alongside `--json`, or a timestamped path under `--out` if `--json` is omitted — `compare` always writes an HTML report unless `--no-html` is set. |
| `--receipt <path>` | adjacent to `--json` | Write terminal-state receipt here. |
| `--no-html` | off | Skip HTML generation. |
| `--quiet` | off | Suppress per-target output lines. |
| `--headed` | off | Show browser. |

Unlike `run`/`deploy-gate`, `compare` needs no pre-seeded baseline: it
captures both `--baseline` and `--current` in the same invocation. If the
baseline side fails to capture, the target verdict is `needs_baseline` (with
a bounded `baseline_capture: ...` reason) rather than a false pass. A usable
URL baseline must produce a renderable document with a final status from 200
through 399. Bare no-content/cache-only responses (204, 205, and 304) are not
renderable Chromium navigations and therefore also yield `needs_baseline`.
Raw browser logs and target URLs are not copied into capture-error reasons.
The HTML report
includes a changed-region overlay — a bounding box drawn over the current
and diff screenshots — showing exactly where pixels differ.

Exit code: `0` (pass/warn), `1` (fail/error/needs_baseline), `2` (fatal CLI error).

#### `promote` (Phase 2)

```bash
node dist/cli.js promote \
  --run-id vc_abc123 \
  --targets "https://mysite.com@mobile,https://mysite.com@desktop" \
  --approved-by HT
```

Sets the results from `run-id` as the new approved baselines.

### Development

```bash
npm test          # unit tests (no browser required, ~10s)
npm run typecheck # strict TypeScript
npm run build     # compile to dist/
npm run dev       # tsx entrypoint for iteration
npm run demo:smoke # builds, then proves `compare` pass+fail against local fixtures (needs Chromium)
```

Test suites:

- `capture.test.ts` — URL slug handling
- `checks.test.ts` — all 4 checks + verdict precedence + changed_region passthrough
- `pool.test.ts` — concurrency semantics
- `diff.test.ts` — pixelmatch integration, dimension mismatches, changed-region bounding box
- `report.test.ts` — summary accuracy, top-level pass flag
- `html-report.test.ts` — XSS escaping, data URI embedding, changed-region overlay
- `compare.test.ts` — target resolution (URL/local file), orchestration (mocked capture/diff)

### Dogfooding

Visual Check is dogfooded on **TrashAlert** (https://trashalert.io), where it runs as the deploy gate after every Vercel push. The full Phase 2 flow — deploy gate → Supabase artifact upload → Telegram alert with signed URL to the HTML report — is what we use ourselves before promoting any deploy to production.

Portfolio scripts in `package.json`:

```bash
npm run baseline:portfolio  # seed all 5 reference sites
npm run check:portfolio     # run checks; writes reports/latest.{json,html}
```

This is what catches our own regressions. Every claim in this README is grounded in something we actually ship against.

### Workspace layout

```
.
├── baselines/
│   └── mysite-com/
│       ├── mobile.png
│       ├── tablet.png
│       └── desktop.png
├── captures/
│   └── 2026-04-17/
│       └── 2026-04-17T20-00-00-000Z/
│           └── mysite-com/
│               ├── mobile.png
│               └── desktop.png
├── diffs/
│   └── 2026-04-17/
│       └── 2026-04-17T20-00-00-000Z/
│           └── mysite-com/
│               └── mobile.png  (only when baseline existed)
├── compare/
│   └── 2026-04-17T20-00-00-000Z/
│       ├── baseline/mobile.png
│       ├── current/mobile.png
│       └── diff/mobile.png       (`compare` command — baseline/current captured in the same run)
└── reports/
    ├── latest.json
    └── latest.html
```

## Roadmap

- **Phase 1** (this CLI) — ✅ done. Deterministic pixel diff + 4 checks + concurrency + GitHub Actions.
- **Phase 2** — Daisy integration: Supabase artifact store, Telegram alerts, baseline approval, run history.
- **Phase 3** — `noui.bot` product: public dashboard, API, MCP server, metered billing.
- **Phase 4** — VLM fallback for ambiguous diffs, Playwright video capture, live visual feedback.

## Design principles

1. **Deterministic first, AI second.** Pixel diff catches 90% of regressions with zero inference cost.
2. **Agent-native output.** The consumer is Daisy, not a human dashboard. The JSON verdict drives the next action.
3. **Lane-locked baselines.** Screenshots compare only within the same OS / browser / runner combination.
4. **Free locally, metered in cloud.** V1 costs $0. Cloud runner comes in Phase 3.
5. **Fail closed.** A missing baseline or a capture error means fail, not pass. Your agent should never get a green verdict from silence.

## License

Visual Check is released under the [Apache License 2.0](./LICENSE).

Copyright © 2026 Tombstone Dash LLC.

The Apache 2.0 license includes an explicit patent grant, which we chose deliberately for an AI-agent infrastructure project where downstream users need predictable IP terms.

---

*"Don't let your agent say 'done' until it has shown its work."*
