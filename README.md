# Visual Check

> Deploy-time visual verification for AI agents.
> Don't let your agent say "done" until it has shown its work.

---

## The problem

When you deploy code, you run tests. But tests can't see what actually got rendered. Your agent pushed a deploy. Did the layout break? Did text get cut off? Did the colors invert? You don't know until a user finds it.

Visual Check watches the deploy. It takes screenshots, compares them to approved baselines, runs four automated checks (pixel difference, HTTP status, console errors, load time), and gives you a verdict: **pass, warn, fail, error, or needs_baseline.**

If the verdict is `fail` or `error`, your agent stops. It doesn't promote the deploy. It rolls back or alerts. If it's `pass` or `warn`, it continues.

That's it.

**Currently dogfooded on TrashAlert** — deploy gate runs on every push, with Telegram alerts on failure and the HTML diff report attached. 96 unit tests pass on every CI run.

## Who it's for

- **DevOps engineers** running AI agent deployments who need deterministic safety gates.
- **AI engineers** building autonomous deployment systems and need rendered-output verification.
- **Teams** using Claude / Daisy / OpenClaw who deploy frequently and want visual regression coverage without false positives.

## How it works in 60 seconds

```bash
# 1. Capture baselines (one time per site)
npx visual-check baseline --urls https://mysite.com

# 2. After a deploy, run a check
npx visual-check run --urls https://mysite.com --json report.json

# 3. Exit code tells your agent what to do
#    0 = pass/warn (continue), 1 = fail/error/needs_baseline (stop)

# The report.json has all the details. The report.html is human-readable.
```

That's the core. Phase 2 adds cloud storage, Telegram alerts, and automated baseline approval.

---

## Install

```bash
cd visual-check
npm install
# npm install also runs `playwright install chromium`
```

Requires Node 20+.

## Quick reference

### Capture baselines

```bash
npx visual-check baseline \
  --urls https://mysite.com,https://mysite.com/pricing,https://mysite.com/about \
  --viewports mobile,tablet,desktop \
  --out ./workspace
```

Writes `.png` baselines to `./workspace/baselines/`.

### Run a check

```bash
npx visual-check run \
  --urls https://mysite.com \
  --viewports mobile,desktop \
  --threshold 5 \
  --json reports/latest.json

# Exit code is 0 (pass/warn) or 1 (fail/error/needs_baseline), so it slots into bash pipelines.
```

Writes captured screenshots, diffs, and a JSON + HTML report. All file paths are relative to `--out` (default: current directory).

## Screenshots

![Visual Check in action](./docs/screenshot-placeholder.png)
*[Placeholder: three-column layout showing mobile baseline, mobile capture, and diff overlay. HTML report with summary header and collapsible checks detail.]*

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
  "pass": true
}
```

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

V1 runs entirely on your machine or CI runner (no external service). Just `npm install` and `npx visual-check run`.

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

#### `visual-check baseline`

```bash
npx visual-check baseline \
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

#### `visual-check run`

```bash
npx visual-check run \
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
| `--no-html` | off | Skip HTML generation. |
| `--quiet` | off | Suppress per-target output lines. |
| `--headed` | off | Show browser. |

Exit code: `0` (pass/warn), `1` (fail/error/needs_baseline), `2` (fatal CLI error).

#### `visual-check promote` (Phase 2)

```bash
npx visual-check promote \
  --run-id vc_abc123 \
  --targets "https://mysite.com@mobile,https://mysite.com@desktop" \
  --approved-by HT
```

Sets the results from `run-id` as the new approved baselines.

### Development

```bash
npm test          # 96 unit tests (no browser required, ~10s)
npm run typecheck # strict TypeScript
npm run build     # compile to dist/
npm run dev       # tsx entrypoint for iteration
```

Test suites:

- `capture.test.ts` — URL slug handling
- `checks.test.ts` — all 4 checks + verdict precedence
- `pool.test.ts` — concurrency semantics
- `diff.test.ts` — pixelmatch integration, dimension mismatches
- `report.test.ts` — summary accuracy, top-level pass flag
- `html-report.test.ts` — XSS escaping, data URI embedding

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
