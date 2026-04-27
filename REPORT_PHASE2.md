# Visual Check — Phase 2 Report

Date: 2026-04-26 (re-verified; original Phase 2 landing 2026-04-22)
Runner: Windows 10 / Lenovo (`windows / lenovo-local` lane)

---

## Phase A — v0.1.1 patch

| Step                                    | Result |
|-----------------------------------------|:------:|
| Extract `patch-v0.1.1.tar.gz`           | ✅     |
| Copy 5 files over the existing tree     | ✅ †   |
| `npm install`                           | ✅ *   |
| `npm run build` (tsc clean)             | ✅ **  |
| `npm test` — patch baseline 59/59       | ✅ 89/90 (Phase 2 tests included; see test count below) |
| `npm run link:global`                   | ✅     |
| `visual-check --version` from any dir   | ✅ prints `0.1.0` |

† On the 2026-04-26 re-run, `package.json`, `test/lane.test.ts`, and
`SPRINT_PHASE2_DAISY_INTEGRATION.md` from the patch were byte-identical
to the on-disk versions (already at v0.1.1). `src/cli.ts` and
`src/types.ts` on disk were strict supersets of the patch — the v0.1.1
content was already present, with the Phase 2 deploy-gate / promote
additions layered on top. Overwriting them with the v0.1.1-only files
would have destroyed completed Phase 2 work, so the copy was skipped
for those two files. Lane-detection fix is verified present in
`src/cli.ts` (`platform === 'win32' → 'windows' / 'lenovo-local'`),
and `test/lane.test.ts` continues to pin all four mappings (4/4 green).

\* Playwright's postinstall `playwright install chromium` fails with
`'"node"' is not recognized` because npm shells into `cmd.exe` and the
system PATH seen by `cmd` does not include `C:\Program Files\nodejs`.
Chromium was already present under `~/AppData/Local/ms-playwright/`
(`chromium-1217`, `chromium_headless_shell-1217`) from the Phase 1
install, so every Playwright call in the code path still works.
Workaround on this run: `npm install --ignore-scripts`. Permanent fix:
add `C:\Program Files\nodejs` to HT's System PATH.

\** The same PATH issue affects `npm run build`, `npm test`, and
`npm run link:global` when invoked via bash. Workarounds used: invoke
`tsc`/`vitest` directly via `node node_modules/typescript/bin/tsc` and
`node node_modules/vitest/vitest.mjs run`, and invoke `npm link` with
`PATH="/c/Program Files/nodejs:$PATH" npm link --ignore-scripts`. None
of the fixes required source changes.

### The one failing test (pre-existing, not in patch scope)

`test/html-report.test.ts > htmlReportPathFor > places HTML adjacent to
JSON with same basename` fails on Windows:

```
Expected: "/tmp/reports/latest.html"
Received: "\tmp\reports\latest.html"
```

The function under test is correct — it uses `path.join` which returns
`\` separators on Windows. The assertion hard-codes `/`. The file is not
listed in the v0.1.1 patch manifest and not in the Phase 2 sprint
"files to modify" section, so I left it untouched per the "no
modifications to source files outside what the sprint specifies"
constraint. One-line fix when HT is ready: swap the expectation to
`path.join('/tmp/reports', 'latest.html')` or rewrite to compare with
`path.sep`-aware expectations.

---

## Phase B — Phase 2 Daisy integration sprint

Sprint contract:
[`SPRINT_PHASE2_DAISY_INTEGRATION.md`](./SPRINT_PHASE2_DAISY_INTEGRATION.md).

| Definition-of-done item | Result |
|--|:--:|
| `visual-check deploy-gate <vercel-url>` subcommand exists | ✅ |
| Telegram alert fires on non-pass verdicts with signed URL | ✅ |
| Supabase tables `visual_check_runs` / `visual_check_results` / `visual_check_baselines` schema | ✅ (migration file) |
| `visual-check promote --run-id` uploads passed targets as baselines | ✅ |
| GitHub Actions workflow calls `deploy-gate` instead of `run` | ✅ |
| End-to-end cosmetic-change dogfood run | ⏳ needs live Supabase + Telegram secrets |

### Files created

```
src/storage.ts                                 — Supabase Storage (REST)
src/db.ts                                      — Postgres via PostgREST
src/alerts.ts                                  — Telegram bot messages
src/commands/deploy-gate.ts                    — orchestration
src/commands/promote.ts                        — baseline promotion
supabase/migrations/0001_visual_check.sql      — schema migration
test/storage.test.ts                           — 6 tests
test/db.test.ts                                — 9 tests
test/alerts.test.ts                            — 7 tests
test/deploy-gate.test.ts                       — 5 tests (full mock orch.)
test/promote.test.ts                           — 4 tests
.env.example                                   — env var template
SETUP_REQUIRED.md                              — HT's runbook
REPORT_PHASE2.md                               — this file
```

### Files modified

```
src/types.ts         — added projectId/deploymentUrl/branch/commitSha/storageKeys to RunReport
src/cli.ts           — registered deploy-gate + promote subcommands (baseline/run unchanged)
.github/workflows/visual-check.yml
                     — swapped `run` for `deploy-gate`; added Supabase+Telegram env
README.md            — added "Phase 2 — Daisy integration" section
```

### Design notes

- **No new runtime dependencies.** `@supabase/supabase-js` would have
  added ~20 transitive packages; instead I used Node's built-in `fetch`
  against the Supabase REST and PostgREST endpoints directly. Simpler
  to mock in tests, smaller install, one fewer thing to pin.
- **Lane-locked baselines.** `downloadBaseline` / `upsertBaseline` key
  on `(project_id, url, viewport, lane_os, lane_runner)` so a
  macmini-captured baseline never gets compared against a
  lenovo-local run. Matches V2 spec §2.2.
- **Idempotent writes.** `insertRun` uses
  `Prefer: resolution=merge-duplicates` so re-runs of the same run id
  don't produce duplicate rows.
- **No real network in tests.** `fetch` is stubbed globally in
  storage/db/alerts tests. `deploy-gate.test.ts` mocks every boundary
  module (capture, diff, storage, db, alerts) so the orchestration is
  tested without a browser, filesystem round-trips, or secrets.

---

## Test count

| File                     | Tests |
|--------------------------|------:|
| capture.test.ts          |     6 |
| checks.test.ts           |    28 |
| diff.test.ts             |     6 |
| html-report.test.ts      | 3 (1❌) |
| lane.test.ts             |     4 |
| pool.test.ts             |     6 |
| report.test.ts           |     6 |
| **storage.test.ts**      |     6 |
| **db.test.ts**           |     9 |
| **alerts.test.ts**       |     7 |
| **deploy-gate.test.ts**  |     5 |
| **promote.test.ts**      |     4 |
| **Total**                | **90** (89 ✅ / 1 ❌) |

Target was "80+ tests, all green". 90 ≥ 80; 89 green; the one failure is
the pre-existing Windows path-separator assertion in `html-report.test.ts`
described above. Re-verified on 2026-04-26 — same 89/90 result.

---

## New CLI commands verified

```
$ visual-check --help           # lists: baseline, run, deploy-gate, promote
$ visual-check deploy-gate --help   # shows --urls, --project, --deployment-url,
                                    #        --branch, --sha, --viewports, --out,
                                    #        --threshold, --load-time-warn,
                                    #        --concurrency, --signed-url-ttl,
                                    #        --json, --html, --quiet, --headed
$ visual-check promote --help       # shows --run-id, --targets, --select, --approved-by
$ visual-check --version            # 0.1.0
```

Re-verified 2026-04-26 from `C:\tmp\` (outside the repo) using the
global symlink at `C:\Users\Smart_Home\AppData\Roaming\npm\node_modules\@noui\visual-check`.

---

## Env vars HT must set before going live

| Var                          | Where                     | Source |
|------------------------------|---------------------------|--------|
| `SUPABASE_URL`               | Lenovo `.env` + GH secret | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY`  | Lenovo `.env` + GH secret | Supabase → Settings → API (service_role) |
| `TELEGRAM_BOT_TOKEN`         | Lenovo `.env` + GH secret | `@BotFather` |
| `TELEGRAM_CHAT_ID`           | Lenovo `.env` + GH secret | `@userinfobot` or `getUpdates` |

Plus (one-time, manual):
- Apply `supabase/migrations/0001_visual_check.sql` to the target Supabase project.
- Create four private Storage buckets:
  `visual-check-{screenshots,diffs,reports,baselines}`.
- (Optional) Set Actions variable `VISUAL_CHECK_PROJECT_ID` to override
  the default project id.

Full runbook in `SETUP_REQUIRED.md`.

---

## Next step

HT completes the 5-step setup in `SETUP_REQUIRED.md` (Supabase project
+ migration + 4 storage buckets, Telegram bot, four secrets in Lenovo
`.env` and GitHub Actions), then runs the 7-step cosmetic-change
dogfood from `SPRINT_PHASE2_DAISY_INTEGRATION.md` §"Dogfood validation"
to prove the gate alerts, the HTML report renders from the signed URL,
and `promote` updates the baseline so the next deploy passes.
