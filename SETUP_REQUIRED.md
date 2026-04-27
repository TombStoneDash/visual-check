# Visual Check — Phase 2 setup checklist

The Phase 2 code (`visual-check deploy-gate` and `visual-check promote`) is
merged, tested, and compiled. It cannot run end-to-end against real
infrastructure until HT completes the steps below.

Tests mock every external call, so `npm test` passes without any of this.

---

## 1. Supabase

1. Create (or reuse) a Supabase project in the `noui` org.
2. Apply the migration:
   ```bash
   supabase link --project-ref <ref>
   supabase db push        # picks up supabase/migrations/0001_visual_check.sql
   # or: psql "$(supabase status --output env | grep DB_URL | cut -d= -f2)" \
   #     -f supabase/migrations/0001_visual_check.sql
   ```
3. Create the four private Storage buckets (Dashboard → Storage → New bucket,
   or the storage API). All must be **private** — no public reads.
   - `visual-check-screenshots`
   - `visual-check-diffs`
   - `visual-check-reports`
   - `visual-check-baselines`

## 2. Telegram bot

1. Open `@BotFather`, run `/newbot`, capture the bot token.
2. Message the bot from HT's account so the bot can message back.
3. Grab HT's chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates`
   (or via `@userinfobot`).

## 3. Secrets HT must set

### Lenovo `.env` (for local/daemon deploy-gate runs)

Copy `.env.example` → `.env` at the repo root and fill:

| Key                          | Source                                    |
|------------------------------|-------------------------------------------|
| `SUPABASE_URL`               | Supabase → Settings → API → Project URL   |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase → Settings → API → `service_role` key |
| `TELEGRAM_BOT_TOKEN`         | `@BotFather` token from step 2.1         |
| `TELEGRAM_CHAT_ID`           | HT's private chat id from step 2.3       |

Load with `node --env-file=.env dist/cli.js deploy-gate …`, or export the vars
in the shell before the run.

### GitHub Actions secrets (for the PR-gate workflow)

Settings → Secrets and variables → Actions → New repository secret. Same four
keys as above. Optionally set an Actions variable `VISUAL_CHECK_PROJECT_ID`
to override the default project id (`visual-check`).

## 4. Seed baselines

Until a passing run has been promoted, every target returns `needs_baseline`,
which `promote` rejects in normal mode. Use `promote --seed` for the first
run of a new project — it accepts `needs_baseline` verdicts and treats the
captured screenshots as the approved baseline:

```bash
# Run deploy-gate against a known-good production URL. All targets will come
# back as needs_baseline (overall verdict: FAIL — expected on first run).
visual-check deploy-gate --project trashalert \
  --urls https://trashalert.io \
  --deployment-url https://trashalert.io

# Promote in seed mode to install those screenshots as the approved baseline.
visual-check promote --run-id vc_<id> --approved-by HT --seed
```

After this one-time seed, drop `--seed` for subsequent promotes — the strict
pass/warn gate is the right behavior once baselines exist.

## 5. Verify end-to-end

Follow the Dogfood validation script in
`SPRINT_PHASE2_DAISY_INTEGRATION.md` (7 steps) to prove the gate is live.

---

Until all five sections above are done, the code compiles and the tests
pass but a live `deploy-gate` run will fail at the first Supabase call.
