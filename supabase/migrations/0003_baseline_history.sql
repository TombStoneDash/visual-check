-- Allow baseline history: only the *approved* row must be unique.
--
-- 0001 made (project_id, url, viewport, lane_os, lane_runner, approved)
-- unique, which also caps the history at one approved=false row. `promote`
-- deactivates the current baseline before inserting the new one, so the
-- third promotion of any target failed with a duplicate-key error on that
-- PATCH. Replace the constraint with a partial unique index on approved rows.
-- Rollback: drop the index and re-add the 6-column unique constraint (only
-- possible after deleting all but one unapproved row per target).

do $$
declare
  c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.visual_check_baselines'::regclass
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by att.attname)
        from pg_attribute att
        where att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      ) = array['approved', 'lane_os', 'lane_runner', 'project_id', 'url', 'viewport']
  loop
    execute format('alter table public.visual_check_baselines drop constraint %I', c);
  end loop;
end
$$;

create unique index if not exists visual_check_baselines_one_approved_idx
  on public.visual_check_baselines (project_id, url, viewport, lane_os, lane_runner)
  where approved;
