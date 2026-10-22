import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies supabase/migrations/*.sql to an in-process Postgres (PGlite) with
 * Supabase's Data API roles, and checks who can touch the visual-check
 * tables afterwards (chatops-bridge#521).
 *
 * Two projects are simulated:
 *  - legacy: Supabase's pre-2026-10-30 default privileges, which grant every
 *    new public table to anon/authenticated/service_role;
 *  - current: no default grants, so only explicit grants count.
 * In both, the CLI's service_role key must work and the public anon /
 * authenticated keys must get nothing.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const TABLES = ['visual_check_runs', 'visual_check_results', 'visual_check_baselines'];

async function migrate(legacyDefaultGrants: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec('grant usage on schema public to anon, authenticated, service_role;');
  if (legacyDefaultGrants) {
    await db.exec(
      'alter default privileges in schema public grant all on tables to anon, authenticated, service_role;',
    );
  }
  const names = (await fs.readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql')).sort();
  for (const n of names) {
    await db.exec(await fs.readFile(path.join(MIGRATIONS_DIR, n), 'utf8'));
  }
  return db;
}

/** Run `sql` as `role` inside a transaction that is always rolled back. */
async function asRole(db: PGlite, role: string, sql: string): Promise<void> {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.exec(sql);
  } finally {
    await db.exec('rollback');
  }
}

const INSERT_RUN = `insert into visual_check_runs (id, project_id, deployment_url, verdict, summary, config)
  values ('vc_test', 'p', 'https://example.com', 'pass', '{}', '{}')`;

describe.each([
  ['legacy project (old default grants)', true],
  ['current project (no default grants)', false],
])('migration grants: %s', (_name, legacy) => {
  let db: PGlite;

  // Booting PGlite's WASM build takes several seconds.
  beforeAll(async () => {
    db = await migrate(legacy);
  }, 120_000);

  it('service_role can read, write, update and delete every table', async () => {
    await asRole(
      db,
      'service_role',
      `${INSERT_RUN};
       insert into visual_check_results (run_id, url, viewport, verdict, checks, reasons)
         values ('vc_test', 'https://example.com', 'mobile', 'pass', '[]', '[]');
       insert into visual_check_baselines (project_id, url, viewport, lane_os, lane_runner, storage_path)
         values ('p', 'https://example.com', 'mobile', 'linux', 'gha', 'k.png');
       update visual_check_runs set verdict = 'fail' where id = 'vc_test';
       select * from visual_check_results;
       delete from visual_check_baselines;
       delete from visual_check_runs;`,
    );
  });

  for (const role of ['anon', 'authenticated']) {
    for (const table of TABLES) {
      it(`${role} cannot read ${table}`, async () => {
        await expect(asRole(db, role, `select * from ${table}`)).rejects.toThrow(/permission denied/);
      });
    }

    it(`${role} cannot insert a run`, async () => {
      await expect(asRole(db, role, INSERT_RUN)).rejects.toThrow(/permission denied/);
    });
  }

  it('row level security is on for every table', async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1) order by relname`,
      [TABLES],
    );
    expect(res.rows).toEqual(
      [...TABLES].sort().map((relname) => ({ relname, relrowsecurity: true })),
    );
  });
});
