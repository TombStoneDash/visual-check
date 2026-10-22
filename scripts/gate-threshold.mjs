#!/usr/bin/env node
// Prints the threshold for a project: explicit value wins, else thresholds.json.
// Usage: node scripts/gate-threshold.mjs <project> [explicit-pct]
import { readFileSync } from 'node:fs';

const [project, explicit] = process.argv.slice(2);
if (explicit) {
  process.stdout.write(explicit);
} else {
  const table = JSON.parse(readFileSync(new URL('../thresholds.json', import.meta.url), 'utf8'));
  // Own keys only: "toString" or "constructor" are not projects.
  if (!project || !Object.hasOwn(table, project) || typeof table[project] !== 'number') {
    const name = project ? `"${project}"` : '(none: set project, or projectId in the config)';
    console.error(`[visual-check] no threshold for project ${name} in thresholds.json; pass threshold-pct`);
    process.exit(3);
  }
  process.stdout.write(String(table[project]));
}
