// scripts/build-site.mjs
//
// Assemble the static hosted demo under site/ from:
//   - the Daisy Presence demo snapshot (src/presence-demo.ts via dist/)
//   - the two real `visual-check compare` runs demo/smoke.mjs leaves under
//     demo/output/{pass,fail}/ (run `npm run demo:smoke` first, or let this
//     script run it for you)
//
// Output is plain files: site/index.html, site/reports/*.html,
// site/shots/*.png. No server, no build step on the host, so it deploys
// anywhere that serves static files.
//
// Usage:
//   npm run build && node scripts/build-site.mjs
// Env:
//   DMG_URL     public URL of DaisyPresence.dmg (default: GitHub release asset)
//   DMG_SHA256  optional checksum shown next to the link
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(repoRoot, 'demo', 'output');
const siteRoot = path.join(repoRoot, 'site');

const { DEMO_SNAPSHOTS, renderDemoSite } = await import(
  path.join(repoRoot, 'dist', 'presence-demo.js')
).catch(() => {
  console.error('[build-site] dist/presence-demo.js missing — run `npm run build` first.');
  process.exit(1);
});

async function exists(p) {
  return fs.stat(p).then(() => true).catch(() => false);
}

if (!(await exists(path.join(outputRoot, 'pass', 'report.json')))) {
  console.log('[build-site] demo/output missing — running demo:smoke');
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'demo', 'smoke.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

await fs.rm(siteRoot, { recursive: true, force: true });
await fs.mkdir(path.join(siteRoot, 'reports'), { recursive: true });
await fs.mkdir(path.join(siteRoot, 'shots'), { recursive: true });

async function loadScenario(name) {
  const dir = path.join(outputRoot, name);
  const report = JSON.parse(await fs.readFile(path.join(dir, 'report.json'), 'utf8'));
  await fs.copyFile(path.join(dir, 'report.html'), path.join(siteRoot, 'reports', `${name}.html`));

  const desktop = report.results.find((r) => r.viewport === 'desktop') ?? report.results[0];
  const screenshots = [];
  for (const [label, src] of [
    ['baseline', desktop.baseline],
    ['current', desktop.screenshot],
    ['diff', desktop.diff_image],
  ]) {
    if (!src || !(await exists(src))) continue;
    const dest = `shots/${name}-${desktop.viewport}-${label}.png`;
    await fs.copyFile(src, path.join(siteRoot, dest));
    screenshots.push({ label: `${desktop.viewport} ${label}`, src: dest });
  }

  const worst = report.results.reduce(
    (m, r) => Math.max(m, r.diff_percentage ?? 0),
    0,
  );
  const threshold = report.config?.pixel_diff_threshold ?? 5;
  return {
    name,
    verdict: report.pass ? 'pass' : 'fail',
    diffLabel: `${worst}%`,
    threshold: `${threshold}%`,
    reportHref: `reports/${name}.html`,
    screenshots,
  };
}

const compare = [await loadScenario('pass'), await loadScenario('fail')];

const html = renderDemoSite({
  presence: DEMO_SNAPSHOTS,
  compare,
  dmgUrl:
    process.env.DMG_URL ??
    'https://github.com/TombStoneDash/daisy-personal-assistant/releases/download/hackathon-20260918/DaisyPresence-8da75b8.dmg',
  dmgSha256: process.env.DMG_SHA256 ?? '8e1b4ce6d7ef1db2fda692feed639379a97e4238ee5e5c17eae271c4ef4137db',
  presenceRepoUrl: 'https://github.com/TombStoneDash/daisy-personal-assistant',
  visualCheckRepoUrl: 'https://github.com/TombStoneDash/visual-check',
  daisyDeskSpecUrl: 'https://github.com/TombStoneDash/daisy-personal-assistant/blob/main/docs/DAISY_DESK.md',
  builtAt: new Date().toISOString(),
});

await fs.writeFile(path.join(siteRoot, 'index.html'), html, 'utf8');
await fs.writeFile(
  path.join(siteRoot, 'presence-snapshot.json'),
  JSON.stringify({ synthetic: true, snapshots: DEMO_SNAPSHOTS }, null, 2),
  'utf8',
);

const files = await fs.readdir(siteRoot, { recursive: true });
console.log(`[build-site] wrote ${files.length} entries under site/`);
for (const c of compare) console.log(`  ${c.name}: ${c.verdict} (${c.diffLabel}, ${c.screenshots.length} shots)`);
