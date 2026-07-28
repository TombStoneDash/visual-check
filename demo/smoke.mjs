// demo/smoke.mjs
//
// Credential-free end-to-end proof for `visual-check compare`. Runs entirely
// against local file:// fixtures under demo/fixtures/ — no network access,
// no stored credentials, no production sites. Proves:
//   1. Identical baseline/current pages compare, verdict pass, exit 0.
//   2. An intentional visual regression compares, verdict fail, exit 1.
//   3. Both runs leave an inspectable JSON + HTML report (with baseline,
//      current, diff screenshots and changed-region evidence) under
//      demo/output/.
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cli = path.join(repoRoot, 'dist', 'cli.js');
const outRoot = path.join(__dirname, 'output');

let failures = 0;

function check(label, cond) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

async function fileExists(p) {
  return fs.stat(p).then(() => true).catch(() => false);
}

async function runCompareScenario(name, { current, expectPass }) {
  const scenarioRoot = path.join(outRoot, name);
  const jsonPath = path.join(scenarioRoot, 'report.json');
  const htmlPath = path.join(scenarioRoot, 'report.html');

  console.log(`\n[demo:smoke] compare — ${name} (baseline=page.html, current=${current})`);
  const res = spawnSync(
    process.execPath,
    [
      cli,
      'compare',
      '--baseline',
      'demo/fixtures/page.html',
      '--current',
      current,
      '--viewports',
      'mobile,desktop',
      '--threshold',
      '5',
      '--out',
      path.relative(repoRoot, scenarioRoot),
      '--json',
      path.relative(repoRoot, jsonPath),
      '--quiet',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (res.error) console.error(res.error);
  if (res.stderr) process.stderr.write(res.stderr);

  const expectedExit = expectPass ? 0 : 1;
  check(`${name}: exit code is ${expectedExit}`, res.status === expectedExit);

  const jsonExists = await fileExists(jsonPath);
  check(`${name}: JSON report written`, jsonExists);
  if (!jsonExists) {
    return { report: null, htmlPath, scenarioRoot };
  }

  const report = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  check(`${name}: report.pass === ${expectPass}`, report.pass === expectPass);
  check(`${name}: report has 2 results (mobile + desktop)`, report.results.length === 2);

  const htmlExists = await fileExists(htmlPath);
  check(`${name}: HTML report written to ${path.relative(repoRoot, htmlPath)}`, htmlExists);

  for (const r of report.results) {
    const screenshotExists = await fileExists(r.screenshot);
    const baselineExists = r.baseline ? await fileExists(r.baseline) : false;
    check(`${name}/${r.viewport}: current screenshot exists on disk`, screenshotExists);
    check(`${name}/${r.viewport}: baseline screenshot exists on disk`, baselineExists);
  }

  return { report, htmlPath, scenarioRoot };
}

const cliExists = await fileExists(cli);
if (!cliExists) {
  console.error('[demo:smoke] dist/cli.js not found — build did not produce a CLI bundle.');
  process.exit(1);
}

await fs.rm(outRoot, { recursive: true, force: true });

// --- Scenario 1: identical pages → pass, exit 0 ---------------------------
const passRun = await runCompareScenario('pass', {
  current: 'demo/fixtures/page.html',
  expectPass: true,
});
if (passRun.report) {
  check('pass: every target verdict is "pass"', passRun.report.results.every((r) => r.verdict === 'pass'));
  check(
    'pass: diff_percentage is 0 for every target',
    passRun.report.results.every((r) => r.diff_percentage === 0),
  );
  check(
    'pass: no changed_region evidence (nothing changed)',
    passRun.report.results.every((r) => !r.changed_region),
  );
  const passHtml = await fs.readFile(passRun.htmlPath, 'utf8');
  check('pass: HTML report shows the PASS verdict', passHtml.includes('PASS'));
}

// --- Scenario 2: intentional visual regression → fail, exit 1 ------------
const failRun = await runCompareScenario('fail', {
  current: 'demo/fixtures/page-changed.html',
  expectPass: false,
});
if (failRun.report) {
  check('fail: every target verdict is "fail"', failRun.report.results.every((r) => r.verdict === 'fail'));
  check(
    'fail: diff_percentage exceeds the 5% threshold on every target',
    failRun.report.results.every((r) => (r.diff_percentage ?? 0) > 5),
  );
  check(
    'fail: changed_region evidence is present with a positive area',
    failRun.report.results.every(
      (r) => r.changed_region && r.changed_region.width > 0 && r.changed_region.height > 0,
    ),
  );
  const failHtml = await fs.readFile(failRun.htmlPath, 'utf8');
  check('fail: HTML report shows the FAIL verdict', failHtml.includes('FAIL'));
  check('fail: HTML report renders changed-region evidence', failHtml.includes('region-box'));
  check('fail: HTML report shows the configured threshold', failHtml.includes('threshold: <b>5%'));
}

console.log(`\n[demo:smoke] inspectable sample reports left under ${path.relative(repoRoot, outRoot)}/`);

if (failures > 0) {
  console.error(`\n✗ demo:smoke FAILED (${failures} check(s) failed)`);
  process.exit(1);
}
console.log('\n✓ demo:smoke PASSED — one pass and one intentional visual-regression fail, both verified.');
