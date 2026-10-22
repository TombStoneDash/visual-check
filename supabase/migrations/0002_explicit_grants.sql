-- chatops-bridge#521: from 2026-10-30 Supabase no longer auto-grants Data API
-- roles on new public tables. visual-check uses only the service_role key
-- server-side, so grant service_role explicitly and nothing to anon/authenticated.
-- Prepared, not applied. Rollback: revoke the same privileges from service_role
-- and `disable row level security` on the three tables.
grant select, insert, update, delete on table
  public.visual_check_runs,
  public.visual_check_results,
  public.visual_check_baselines
to service_role;

-- Tables created before 2026-10-30 already carry the old default grants to
-- anon/authenticated, and 0001 never enabled RLS, so the public Data API key
-- could read and write them. Take those grants back and turn RLS on with no
-- policies; service_role bypasses RLS, so the CLI is unaffected.
-- (No sequence grants: every id is text or gen_random_uuid().)
revoke all on table
  public.visual_check_runs,
  public.visual_check_results,
  public.visual_check_baselines
from anon, authenticated;

alter table public.visual_check_runs enable row level security;
alter table public.visual_check_results enable row level security;
alter table public.visual_check_baselines enable row level security;
