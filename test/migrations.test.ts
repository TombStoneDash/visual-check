import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies supabase/migrations/*.sql in order to an in-process Postgres
 * (PGlite) and replays the SQL that `db.upsertBaseline` issues through
 * PostgREST, so schema bugs show up in CI instead of on the first real
 * project.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

async function migrationFiles(): Promise<string[]> {
  const names = (await fs.readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql')).sort();
  return names.map((n) => path.join(MIGRATIONS_DIR, n));
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  // Roles Supabase provides; later migrations grant to / revoke from them.
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const file of await migrationFiles()) {
    await db.exec(await fs.readFile(file, 'utf8'));
  }
  return db;
}

const TARGET = {
  project_id: 'trashalert',
  url: 'https://trashalert.io',
  viewport: 'mobile',
  lane_os: 'linux',
  lane_runner: 'github-actions',
};

/** Same two statements `upsertBaseline` sends: deactivate, then insert. */
async function promote(db: PGlite, runId: string): Promise<void> {
  const t = TARGET;
  await db.query(
    `update visual_check_baselines set approved = false
      where project_id = $1 and url = $2 and viewport = $3
        and lane_os = $4 and lane_runner = $5 and approved = true`,
    [t.project_id, t.url, t.viewport, t.lane_os, t.lane_runner],
  );
  await insertApproved(db, runId);
}

async function insertApproved(db: PGlite, runId: string): Promise<void> {
  const t = TARGET;
  await db.query(
    `insert into visual_check_baselines
       (project_id, url, viewport, lane_os, lane_runner, storage_path, approved, run_id)
     values ($1, $2, $3, $4, $5, $6, true, $7)`,
    [t.project_id, t.url, t.viewport, t.lane_os, t.lane_runner, 'k.png', runId],
  );
}

describe('supabase migrations', () => {
  let db: PGlite;

  // Booting PGlite's WASM build takes several seconds, so share one database.
  beforeAll(async () => {
    db = await freshDb();
  }, 120_000);

  beforeEach(async () => {
    await db.exec('truncate visual_check_baselines');
  });

  it('apply cleanly, in order, to an empty database', async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'visual_check_baselines',
      'visual_check_results',
      'visual_check_runs',
    ]);
  });

  it('lets the same target be promoted repeatedly and keeps the history', async () => {
    for (let i = 1; i <= 4; i++) {
      await promote(db, `vc_${i}`);
    }
    const rows = await db.query<{ run_id: string; approved: boolean }>(
      'select run_id, approved from visual_check_baselines order by run_id',
    );
    expect(rows.rows).toEqual([
      { run_id: 'vc_1', approved: false },
      { run_id: 'vc_2', approved: false },
      { run_id: 'vc_3', approved: false },
      { run_id: 'vc_4', approved: true },
    ]);
  });

  it('still refuses two approved baselines for one target', async () => {
    await insertApproved(db, 'vc_1');
    await expect(insertApproved(db, 'vc_2')).rejects.toThrow(/duplicate key/);
  });

  it('can re-apply the baseline-history migration without error', async () => {
    const file = (await migrationFiles()).find((f) => f.endsWith('0003_baseline_history.sql'));
    expect(file).toBeDefined();
    await db.exec(await fs.readFile(file!, 'utf8'));
    await promote(db, 'vc_1');
    await promote(db, 'vc_2');
    await promote(db, 'vc_3');
  });
});
