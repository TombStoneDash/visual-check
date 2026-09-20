import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function globalSetup() {
  // Escape hatch for callers that deliberately manage the test build themselves.
  if (process.env.VC_SKIP_TEST_BUILD === '1') return;

  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  // Always rebuild: an existing dist/ may be stale. Compiler failures abort the run.
  execFileSync(
    process.execPath,
    [path.join(repoRoot, 'node_modules/typescript/bin/tsc'), '-p', repoRoot],
    { stdio: 'inherit' },
  );
}
