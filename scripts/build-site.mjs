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

// Read and check both scenarios before touching site/, so a missing or broken
// demo output fails the build instead of leaving site/ half-deleted.
async function readScenario(name) {
  const dir = path.join(outputRoot, name);
  const report = JSON.parse(await fs.readFile(path.join(dir, 'report.json'), 'utf8'));
  const htmlSrc = path.join(dir, 'report.html');
  if (!(await exists(htmlSrc))) throw new Error(`${htmlSrc} is missing`);
  if (!Array.isArray(report.results) || report.results.length === 0) {
    throw new Error(`${path.join(dir, 'report.json')} has no results`);
  }

  const desktop = report.results.find((r) => r.viewport === 'desktop') ?? report.results[0];
  const shots = [];
  for (const [label, src] of [
    ['baseline', desktop.baseline],
    ['current', desktop.screenshot],
    ['diff', desktop.diff_image],
  ]) {
    if (!src || !(await exists(src))) continue;
    shots.push({ label: `${desktop.viewport} ${label}`, src, dest: `shots/${name}-${desktop.viewport}-${label}.png` });
  }

  const worst = report.results.reduce(
    (m, r) => Math.max(m, r.diff_percentage ?? 0),
    0,
  );
  const threshold = report.config?.pixel_diff_threshold ?? 5;
  return {
    htmlSrc,
    shots,
    scenario: {
      name,
      verdict: report.pass ? 'pass' : 'fail',
      diffLabel: `${worst}%`,
      threshold: `${threshold}%`,
      reportHref: `reports/${name}.html`,
      screenshots: shots.map(({ label, dest }) => ({ label, src: dest })),
    },
  };
}

let loaded;
try {
  loaded = [await readScenario('pass'), await readScenario('fail')];
} catch (err) {
  console.error(`[build-site] demo output is incomplete, site/ left unchanged: ${err.message}`);
  console.error('[build-site] re-run `npm run demo:smoke`, then try again.');
  process.exit(1);
}

await fs.rm(siteRoot, { recursive: true, force: true });
await fs.mkdir(path.join(siteRoot, 'reports'), { recursive: true });
await fs.mkdir(path.join(siteRoot, 'shots'), { recursive: true });
for (const { htmlSrc, shots, scenario } of loaded) {
  await fs.copyFile(htmlSrc, path.join(siteRoot, 'reports', `${scenario.name}.html`));
  for (const shot of shots) await fs.copyFile(shot.src, path.join(siteRoot, shot.dest));
}
const compare = loaded.map((l) => l.scenario);

const html = renderDemoSite({
  presence: DEMO_SNAPSHOTS,
  compare,
  dmgUrl:
    process.env.DMG_URL ??
    'https://daisy-presence-download.vercel.app/DaisyPresence.dmg',
  dmgSha256: process.env.DMG_SHA256 ?? null,
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
