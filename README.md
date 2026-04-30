# Visual Check

> Deploy-time visual verification for AI agents.
> Don't let your agent say "done" until it has shown its work.

Visual Check is the first product in the `noui.bot` visual family. V1 is a local CLI tool built on Playwright + pixelmatch that Daisy (or any autonomous agent) can invoke after a deploy to confirm the rendered output actually looks right.

## What it does

After a deploy (or any manual trigger), Visual Check:

1. Opens a list of URLs at mobile / tablet / desktop viewports in Chromium, with a configurable concurrency cap.
2. Disables animations, waits for fonts, and takes stable above-the-fold screenshots.
3. Compares each screenshot to an approved baseline with pixelmatch.
4. Runs 4 deterministic checks (pixel diff, HTTP status, console errors, load time).
5. Emits a JSON verdict with per-target `pass / warn / fail / error / needs_baseline`, plus an adjacent standalone HTML report for human triage.

The verdict + artifacts are what Daisy reads to decide whether to continue, retry, or halt.

## Install

```bash
cd visual-check
npm install
# npm install also runs `playwright install chromium`
```

Requires Node 20+.

## Quick start

```bash
# 1. Capture baselines for the sites you care about
npx visual-check baseline \
  --urls https://trashalert.io,https://actorlab.io,https://lims.bot

# 2. Run a check (after a deploy, locally, from cron — anywhere)
npx visual-check run \
  --urls https://trashalert.io \
  --viewports mobile,desktop \
  --json reports/latest.json
# → writes reports/latest.json AND reports/latest.html
```

Exit code is `0` on pass or warn, `1` on fail/error/needs_baseline, `2` on fatal CLI errors — so the command slots directly into CI or any shell pipeline.

## Commands

### `visual-check baseline`

Capture baseline screenshots.

| Flag | Default | Notes |
|------|---------|-------|
| `--urls` (required) | — | Comma-separated. Bare hostnames get `https://` prefixed. |
| `--viewports` | `mobile,tablet,desktop` | Subset of the three named viewports. |
| `--out` | `.` | Workspace root. Baselines go under `<out>/baselines/`. |
| `--headed` | off | Show the browser (debugging only). |

### `visual-check run`

Capture, diff against baselines, and emit a verdict.

| Flag | Default | Notes |
|------|---------|-------|
| `--urls` (required) | — | Same shape as `baseline`. |
| `--viewports` | `mobile,tablet,desktop` | |
| `--out` | `.` | Captures under `<out>/captures/YYYY-MM-DD/<timestamp>/`. |
| `--threshold` | `5` | Pixel diff % above which a target fails. |
| `--load-time-warn` | `3000` | Load-time warning threshold in ms. |
| `--concurrency` | `3` | Parallel captures per browser (1–16). |
| `--json <path>` | — | Write the full JSON report here (recommended for agents). |
| `--html <path>` | — | Explicit HTML report path. |
| `--no-html` | off | Skip the HTML report (only relevant when `--json` is set). |
| `--quiet` | off | Suppress per-target lines; with no `--json` prints the JSON report to stdout. |
| `--headed` | off | Show the browser (debugging only). |

When `--json <path>` is set and `--no-html` isn't, an HTML report is auto-written adjacent to the JSON (`reports/latest.json` → `reports/latest.html`).

## Viewports

Fixed for V1 so baselines stay stable:

| Name    | Resolution | Device            |
|---------|-----------|-------------------|
| mobile  | 390×844   | iPhone 14 Pro     |
| tablet  | 768×1024  | iPad              |
| desktop | 1440×900  | Standard laptop   |

## The 4 V1 checks

| # | Check | Severity | Rule |
|---|-------|----------|------|
| 1 | `pixel_diff` | blocking | `diff_percentage > --threshold` → fail |
| 2 | `http_status` | blocking | 4xx/5xx or no response → fail |
| 3 | `console_errors` | warn | Any `console.error`, `pageerror`, or blocked resource → warn |
| 4 | `load_time` | warn | `loadTimeMs > --load-time-warn` → warn |

Verdict precedence: `error > fail > needs_baseline > warn > pass`.

V2 will add broken images, text rendering, responsive breakpoints, dark mode, OG preview, accessibility (axe), performance budget (Lighthouse), and link integrity — see `VISUAL_CHECK_PROJECT_DOCUMENT.md` + the MVP Spec.

## Reports

**JSON** (the agent-readable truth) — shape:

```jsonc
{
  "schema_version": 1,
  "timestamp": "2026-04-17T20:00:00.000Z",
  "run_id": "vc_…",
  "config": {
    "urls": ["https://trashalert.io"],
    "viewports": ["mobile", "desktop"],
    "pixel_diff_threshold": 5,
    "load_time_warn_ms": 3000,
    "lane": { "browser": "chromium", "os": "macos", "runner": "macmini-local" }
  },
  "results": [
    {
      "url": "https://trashalert.io",
      "viewport": "mobile",
      "verdict": "pass",
      "pass": true,
      "status": 200,
      "diff_percentage": 0.412,
      "screenshot": "captures/2026-04-17/.../trashalert-io/mobile.png",
      "baseline":   "baselines/trashalert-io/mobile.png",
      "diff_image": "diffs/2026-04-17/.../trashalert-io/mobile.png",
      "console_errors": 0,
      "load_time_ms": 1180,
      "reasons": [],
      "checks": [ /* per-check results */ ]
    }
  ],
  "summary": { "total": 2, "passed": 2, "failed": 0, "warnings": 0, "errors": 0, "needs_baseline": 0 },
  "pass": true
}
```

**HTML** (the human-triage artifact) — a single file with screenshots embedded as base64 data URIs. Portable: email it, upload it to Supabase, attach it to a Telegram alert — always renders without network access. Three-column baseline / actual / diff layout per target, sticky summary header, collapsible per-check detail table, light + dark mode.

## Workspace layout after a run

```
.
├── baselines/
│   └── trashalert-io/
│       ├── mobile.png
│       ├── tablet.png
│       └── desktop.png
├── captures/
│   └── 2026-04-17/
│       └── 2026-04-17T20-00-00-000Z/
│           └── trashalert-io/
│               ├── mobile.png
│               └── desktop.png
├── diffs/
│   └── 2026-04-17/
│       └── 2026-04-17T20-00-00-000Z/
│           └── trashalert-io/
│               └── mobile.png  ← only present when a baseline existed
└── reports/
    ├── latest.json
    └── latest.html
```

## Typical Daisy loop

```bash
# After a Vercel deploy
DEPLOY_URL="https://trashalert-abc123.vercel.app"

npx visual-check run \
  --urls "$DEPLOY_URL,$DEPLOY_URL/pricing,$DEPLOY_URL/for-property-managers" \
  --threshold 5 \
  --concurrency 3 \
  --quiet \
  --json reports/$(date +%s).json

# Exit code tells Daisy whether to promote the deploy or roll back.
```

When Daisy sees `needs_baseline` on a passing target, she can run `baseline` on the production URL to seed it.

## Phase 2 — Daisy integration

Phase 2 turns the local CLI into a cloud-backed deploy gate: baselines live in
Supabase, runs + results are logged in Postgres, artifacts are uploaded to
Supabase Storage, and failures fire a Telegram alert with a signed URL to the
HTML report.

### New commands

```bash
# Run against a deploy URL, upload artifacts, persist, alert on failure.
visual-check deploy-gate \
  --project trashalert \
  --deployment-url https://trashalert-abc.vercel.app \
  --urls https://trashalert-abc.vercel.app \
  --branch "$GITHUB_HEAD_REF" \
  --sha "$GITHUB_SHA"
#   exit 0 on pass/warn, 1 on fail/error/needs_baseline

# Promote the passed targets from a run to become the new approved baselines.
visual-check promote --run-id vc_xxx --approved-by HT
#   --targets selected --select "https://x@mobile,https://y@desktop"
```

### Env vars required

| Var                          | Used by                          |
|------------------------------|----------------------------------|
| `SUPABASE_URL`               | storage + db                     |
| `SUPABASE_SERVICE_ROLE_KEY`  | storage + db (server-side only)  |
| `TELEGRAM_BOT_TOKEN`         | alerts                           |
| `TELEGRAM_CHAT_ID`           | alerts                           |

See `.env.example` and `SETUP_REQUIRED.md` for the full setup checklist.

### Supabase schema

Apply `supabase/migrations/0001_visual_check.sql` once per project.
Three tables (`visual_check_runs`, `visual_check_results`,
`visual_check_baselines`) and four private storage buckets
(`visual-check-{screenshots,diffs,reports,baselines}`).

### How it fits

```
Vercel preview deploys
  ↓
GitHub Actions runs `visual-check deploy-gate`
  ↓ pulls approved baselines for (project, url, viewport, lane)
  ↓ captures, diffs, runs the V1 checks
  ↓ uploads screenshots + diffs + HTML report to Supabase Storage
  ↓ inserts run + results into Postgres
  ↓ if not pass → Telegram alert with signed URL
  ↓ exit 0/1 — same gate semantics as `run`
```

The V1 `baseline` / `run` subcommands are unchanged and still work for
local-only workflows.

## GitHub Actions

Two workflows ship in `.github/workflows/`:

- **`ci.yml`** — runs typecheck, unit tests, and build on every push and PR. No browser download, fast (~30s).
- **`visual-check.yml`** — on pull requests, waits for the Vercel preview deploy, runs Visual Check against it, uploads screenshots + diffs + reports as artifacts, and posts a PR comment with the summary. Also dispatchable manually with a URL list.

The PR comment uses a marker so it updates the same comment on re-runs instead of spamming new ones.

## Development

```bash
npm test          # 55 unit tests (no browser required)
npm run typecheck # strict TS, no emit
npm run build     # compiles to dist/
npm run dev       # tsx entrypoint, for iterating without a build
```

Test coverage lives under `test/`:

- `capture.test.ts` — `urlToSlug` edge cases
- `checks.test.ts` — every check + verdict precedence + `buildTargetResult` integration
- `report.test.ts` — summary counts, top-level `pass` flag across all verdict combinations
- `pool.test.ts` — ordering preserved, concurrency cap respected, rejections isolated
- `diff.test.ts` — 0% identical, known-size patches, dimension mismatch, diff image emission
- `html-report.test.ts` — data URI embedding, XSS escaping, placeholder handling

The diff engine, pool, and check logic all have zero-browser tests so CI stays fast and green.

## Dogfooding

Portfolio scripts are wired into `package.json`:

```bash
npm run baseline:portfolio   # seed baselines for all 5 sites
npm run check:portfolio      # run checks; writes reports/latest.{json,html}
```

## Roadmap (from the project doc)

- **Phase 1 (this CLI) — done when it catches one real regression on TrashAlert.** pixelmatch + 4 checks + concurrency + HTML report + GitHub Actions. Local only.
- **Phase 2** — Daisy integration: Vercel webhook, Supabase artifact store, Telegram/iMessage alerts, auto-update baselines on approval.
- **Phase 3** — `noui.bot` product: API, dashboard, MCP server, metered billing.
- **Phase 4** — VLM escalation on ambiguous diffs, Playwright video capture (`visual.record`), live view (`visual.watch`).

## Design principles

1. **Deterministic first, AI second.** Pixel diff catches 90% of regressions with zero inference cost.
2. **Agent-native output.** The consumer is Daisy, not a human dashboard.
3. **Lane-locked baselines.** Screenshots only compare within the same OS / browser / runner. See `src/types.ts#BaselineLane`.
4. **Free internally, metered externally.** V1 costs $0 to run locally; cloud runner comes in V3.
5. **Fail closed.** When a baseline is missing or a capture errors, the run is not pass. The agent should never get a green verdict from silence.

## License

Visual Check is released under the [Apache License 2.0](./LICENSE).

Copyright © 2026 Tombstone Dash LLC.

The Apache 2.0 license includes an explicit patent grant, which we chose deliberately for an AI-agent infrastructure project where downstream users need predictable IP terms.

---

_"Don't let your agent say 'done' until it has shown its work."_
