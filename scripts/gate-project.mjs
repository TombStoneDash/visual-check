#!/usr/bin/env node
// Prints a project config's projectId (empty when it has none).
// Reads .json directly (Node 20 cannot import() JSON without an import
// attribute) and imports .mjs/.js for their default export.
// Usage: node scripts/gate-project.mjs <config>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function readProjectId(file) {
  const abs = path.resolve(file);
  const config = abs.toLowerCase().endsWith('.json')
    ? JSON.parse(readFileSync(abs, 'utf8'))
    : (await import(pathToFileURL(abs).href)).default;
  const id = config && typeof config === 'object' ? config.projectId : undefined;
  return typeof id === 'string' ? id.trim() : '';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  try {
    process.stdout.write(await readProjectId(process.argv[2]));
  } catch (err) {
    console.error(`[visual-check] could not read projectId from ${process.argv[2]}: ${err.message}`);
    process.exit(3);
  }
}
