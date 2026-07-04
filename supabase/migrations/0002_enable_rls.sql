-- 0002_enable_rls.sql
-- Enable Row-Level Security with DEFAULT-DENY on the visual-check tables.
--
-- All app callers (src/db.ts) use SUPABASE_SERVICE_ROLE_KEY, which BYPASSES RLS,
-- so this migration is zero-behavior-change for the app. It exists purely to
-- close the anon-exposure hole: if the anon/publishable key is ever pointed at
-- these tables, default-deny (RLS enabled, NO permissive policy) blocks all
-- anon SELECT/INSERT/UPDATE/DELETE. Do NOT add permissive policies here.

alter table visual_check_runs      enable row level security;
alter table visual_check_results   enable row level security;
alter table visual_check_baselines enable row level security;

-- Belt-and-suspenders: also force RLS so even the table owner is subject to it
-- (service_role still bypasses via its BYPASSRLS grant). Optional; uncomment if
-- your Supabase role setup warrants it.
-- alter table visual_check_runs      force row level security;
-- alter table visual_check_results   force row level security;
-- alter table visual_check_baselines force row level security;

-- No CREATE POLICY statements: default-deny is the intent. Access is via the
-- service-role key only (RLS-bypass); public reads go through signed Storage URLs.
