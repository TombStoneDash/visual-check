-- chatops-bridge#521: from 2026-10-30 Supabase no longer auto-grants Data API
-- roles on new public tables. visual-check uses only the service_role key
-- server-side, so grant service_role explicitly and nothing to anon/authenticated.
-- Prepared, not applied. Rollback: revoke the same privileges from service_role.
grant select, insert, update, delete on table
  public.visual_check_runs,
  public.visual_check_results,
  public.visual_check_baselines
to service_role;
grant usage, select on all sequences in schema public to service_role;
