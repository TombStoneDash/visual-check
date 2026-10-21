#!/usr/bin/env node
// Prints the threshold for a project: explicit value wins, else thresholds.json.
// Usage: node scripts/gate-threshold.mjs <project> [explicit-pct]
import { readFileSync } from 'node:fs';

const [project, explicit] = process.argv.slice(2);
if (explicit) {
  process.stdout.write(explicit);
} else {
  const table = JSON.parse(readFileSync(new URL('../thresholds.json', import.meta.url), 'utf8'));
  if (!(project in table)) {
    console.error(`[visual-check] no threshold for "${project}" in thresholds.json; pass threshold-pct`);
    process.exit(3);
  }
  process.stdout.write(String(table[project]));
}
