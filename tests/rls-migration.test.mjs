import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mig = readFileSync(join(root, "supabase/migrations/0002_enable_rls.sql"), "utf-8");

test("0002 enables RLS default-deny on all 3 tables, no permissive policy", () => {
  for (const t of ["visual_check_runs", "visual_check_results", "visual_check_baselines"]) {
    assert.ok(new RegExp(`alter table ${t}\\s+enable row level security`).test(mig), `RLS on ${t}`);
  }
  // Ignore SQL comment lines (the file explains it has no CREATE POLICY on purpose).
  const statements = mig.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/create policy/i.test(statements), "must NOT add a permissive policy statement (default-deny is the intent)");
});
