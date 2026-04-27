-- Visual Check Phase 2 schema.
-- Apply once to the target Supabase project (via `supabase db push` or psql).
-- Mirrors V2 spec §1.2 so deploy-gate writes land in the expected tables.

create table if not exists visual_check_runs (
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

create table if not exists visual_check_results (
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

create table if not exists visual_check_baselines (
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

create index if not exists visual_check_runs_project_idx
  on visual_check_runs (project_id, created_at desc);
create index if not exists visual_check_results_run_idx
  on visual_check_results (run_id);
create index if not exists visual_check_baselines_lookup_idx
  on visual_check_baselines (project_id, url, viewport, lane_os, lane_runner)
  where approved = true;

-- Storage buckets (create via dashboard or the supabase storage API):
--   visual-check-screenshots   (private)
--   visual-check-diffs         (private)
--   visual-check-reports       (private)
--   visual-check-baselines     (private)
-- All access via the service-role key; public reads go through signed URLs.
