# Sprint: Visual Check Phase 2 — Daisy Integration

**Status:** Queued
**Owner:** Daisy (factory run on Lenovo)
**Estimated runtime:** 6–10 hours autonomous
**Prereq:** Phase 1 landed ✅ (tarball extracted, 59/59 tests green, baselines seeded for TrashAlert)

---

## Goal

Turn the local CLI into a Daisy-native deploy gate. After this sprint:

- Daisy runs Visual Check automatically after every Vercel deploy of TrashAlert.
- Failures alert HT on Telegram with the HTML report attached.
- Baselines are stored in Supabase, not local disk, so any runner (Mac Mini, Lenovo, future cloud) sees the same truth.
- Daisy can promote a new baseline via one command when a design change is intentional.

**Non-goal this sprint:** noui.bot public API, MCP server, dashboard UI, VLM escalation. Those are Phase 3+.

---

## Definition of done

1. `visual-check deploy-gate <vercel-url>` exists as a CLI subcommand. It runs the check, posts the HTML report to Supabase Storage, and returns a signed URL.
2. Telegram alert fires on any `fail` / `error` / `needs_baseline` verdict, with the signed URL and a summary table.
3. Supabase tables `visual_check_runs` and `visual_check_results` exist with the schema from the V2 spec §1.2.
4. `visual-check baseline promote <run-id>` uploads the passed targets from a run to become the new approved baseline.
5. TrashAlert's `vercel.json` or GitHub Actions workflow calls `deploy-gate` on every preview deploy.
6. One end-to-end test proven: deploy a cosmetic change → see Visual Check catch the pixel diff → see the Telegram alert → promote the baseline → see next deploy pass.

---

## Architecture

```
Vercel deploy succeeds
  ↓
GitHub Actions (or Vercel webhook when Phase 3 ships) calls:
  visual-check deploy-gate https://trashalert-abc.vercel.app
  ↓
CLI runs existing capture+diff+checks logic (no change needed)
  ↓
NEW: upload captures/diffs/baselines to Supabase Storage
  ↓
NEW: insert run + per-target results into Supabase Postgres
  ↓
NEW: generate signed URL for HTML report
  ↓
NEW: if not pass → Telegram alert with summary + signed URL
  ↓
Exit code 0/1 as before → GitHub Actions gates the PR
```

---

## Supabase schema (create via migration)

```sql
create table visual_check_runs (
  id text primary key,                      -- "vc_xxx" from CLI run_id
  project_id text not null,                 -- "trashalert", "actorlab", etc.
  deployment_url text not null,
  branch text,
  commit_sha text,
  verdict text not null,                    -- 'pass' | 'fail' | 'warn' | 'error' | 'needs_baseline'
  summary jsonb not null,
  config jsonb not null,
  html_report_path text,                    -- storage path, signed on demand
  created_at timestamptz default now(),
  finished_at timestamptz
);

create table visual_check_results (
  id uuid primary key default gen_random_uuid(),
  run_id text references visual_check_runs(id) on delete cascade,
  url text not null,
  viewport text not null,
  verdict text not null,
  diff_percentage numeric,
  load_time_ms integer,
  console_errors integer,
  http_status integer,
  screenshot_path text,
  baseline_path text,
  diff_image_path text,
  checks jsonb not null,
  reasons jsonb not null,
  created_at timestamptz default now()
);

create table visual_check_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  url text not null,
  viewport text not null,
  lane_os text not null,                    -- 'macos' | 'linux' | 'windows'
  lane_runner text not null,
  storage_path text not null,               -- Supabase Storage key
  approved boolean default true,
  approved_by text,
  approved_at timestamptz default now(),
  run_id text,                              -- which run this baseline was promoted from
  unique (project_id, url, viewport, lane_os, lane_runner, approved)
);

create index visual_check_runs_project_idx on visual_check_runs (project_id, created_at desc);
create index visual_check_results_run_idx on visual_check_results (run_id);
create index visual_check_baselines_lookup_idx on visual_check_baselines (project_id, url, viewport, lane_os, lane_runner) where approved = true;
```

Storage buckets: `visual-check-screenshots`, `visual-check-diffs`, `visual-check-reports`, `visual-check-baselines`. All private; access via signed URLs only.

---

## Files to create

### `src/storage.ts`
- `uploadArtifact(localPath, bucket, keyPath) → storageKey`
- `signedUrl(bucket, keyPath, ttlSeconds) → string`
- `downloadBaseline(projectId, url, viewport, lane) → localPath | null`
- Uses `@supabase/supabase-js`; reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env.

### `src/db.ts`
- `insertRun(run: RunReport, projectId: string) → void`
- `insertResults(runId, results) → void`
- `upsertBaseline(projectId, url, viewport, lane, storageKey, runId) → void`
- `getActiveBaseline(projectId, url, viewport, lane) → baseline | null`

### `src/alerts.ts`
- `sendTelegramAlert(run: RunReport, signedReportUrl: string) → void`
- Reads `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from env.
- Formats: verdict emoji + project + summary counts + list of failing targets + link to HTML report.

### `src/commands/deploy-gate.ts`
Wraps existing `run` command with:
1. Before capture: download baselines from Supabase for this (project, lane) into local `baselines/` cache.
2. After capture: upload captures, diffs, HTML report to Supabase Storage.
3. Persist run + results via `db.ts`.
4. On non-pass verdict: call `alerts.ts`.
5. Exit 0/1 as before.

New CLI flags: `--project <id>`, `--branch <name>`, `--sha <commit>`, `--deployment-url <url>`. All required for `deploy-gate`.

### `src/commands/promote.ts`
- `visual-check promote --run-id vc_xxx [--targets all|selected]`
- Reads the run from Supabase, copies screenshots of passed targets into the baselines table + storage bucket with `approved: true`.
- Deactivates previous active baselines for those (project, url, viewport, lane).

---

## Files to modify

### `src/types.ts`
Add `projectId`, `deploymentUrl`, `branch`, `commitSha`, `storageKeys` to `RunReport`. Keep backward compatibility — CLI-only runs without `--project` still emit a valid report.

### `src/cli.ts`
Register `deploy-gate` and `promote` subcommands. Don't touch `baseline` or `run` — they keep working as local-only commands for ad-hoc use.

### `.github/workflows/visual-check.yml`
Swap the body to call `deploy-gate` instead of `run`. Keep the PR comment logic — the JSON report shape is unchanged.

### `README.md`
Add a "Phase 2 — Daisy integration" section with the new commands, env vars, and Supabase setup steps.

---

## Env vars required

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_CHAT_ID=<HT's private chat id>
```

Store in GitHub Actions secrets + Daisy's local `.env` file. Never commit.

---

## Acceptance tests

Add to `test/`:

- `storage.test.ts` — mock Supabase client; assert upload/sign/download round-trips work and signed URLs have correct TTL.
- `db.test.ts` — mock Supabase client; assert run/results/baselines inserts have the right shape and idempotency.
- `alerts.test.ts` — mock `fetch`; assert Telegram payload format matches bot API spec and includes the signed URL.
- `deploy-gate.test.ts` — integration test with all external calls mocked; asserts the full orchestration: download baselines → capture → upload → insert → alert-if-fail → exit code.

Target: 80+ tests total, all green, no real network calls in the test suite.

---

## Dogfood validation

End-to-end proof before declaring Phase 2 done:

1. Deploy a deliberately broken TrashAlert preview (change a CSS color to purple). Push to a PR.
2. GitHub Actions runs `deploy-gate`. Expected: fails with pixel_diff > threshold on multiple viewports.
3. Telegram alert fires within 60 seconds with signed URL.
4. Open the HTML report from the signed URL. Confirm baseline/actual/diff triptych shows the color change.
5. Fix the CSS, push again. Expected: pass.
6. Run `visual-check promote --run-id <new-pass-run>`. Expected: baselines update in Supabase.
7. Next deploy of main. Expected: pass against the new baselines.

When all 7 steps pass, Phase 2 is done and the system is live.

---

## Out of scope (park for Phase 3)

- MCP server for agents to call `visual.check.run` / `.get` / `.promote`
- Next.js dashboard at `noui.bot/visual-check`
- Public API with per-project auth tokens
- Metered billing via Agent Bazaar
- VLM escalation on ambiguous diffs
- Video capture (`visual.record`)
- Live view (`visual.watch`)

---

## Fire command

Once this sprint is ready to run, open Claude Code in the repo and paste:

```
Read SPRINT_PHASE2_DAISY_INTEGRATION.md and execute it. Write REPORT_PHASE2.md when done.
```

That's it. Everything the agent needs is in this file.
