// Example project config: Daisy Mission Control, repo TombStoneDash/mission-control (main), the ops board
// served at http://localhost:3333 on the ops Mac. Its owner decides whether to adopt this. Example only.
// No workflow, deploy gate or runner reads this file, and it is not built or published.
//
// Use with the CLI (only projectId, routes and viewports are applied today; other keys are reported
// as "not applied yet"):
//   visual-check config-targets --config examples/projects/mission-control.config.mjs --base-url http://localhost:3333
//
// Status-only: the board refreshes live data and clocks on every load and has no markers to mask, so
// pixel_diff is 'skip'. The CLI does not apply `checks` yet and has no flag to skip the pixel diff, so do
// not capture baselines for this board. Without a baseline, `run` reports READY_TO_REVIEW (missing
// baseline) and still checks HTTP status, console errors and load time.
// Routes are the app's pages (src/app/**/page.tsx), checked in the repo on 2026-09-26.

/** @type {import('../../visual-check.config.example.js').ProjectConfig} */
const config = {
  projectId: 'mission-control',
  baseBranch: 'main',
  routes: [
    { id: 'home', path: '/', checks: ['http_status', 'console_errors', 'load_time'] },
    { id: 'status', path: '/status', checks: ['http_status', 'console_errors', 'load_time'] },
    { id: 'tasks', path: '/tasks', checks: ['http_status', 'console_errors', 'load_time'] },
    { id: 'decisions', path: '/decisions', checks: ['http_status', 'console_errors', 'load_time'] },
    { id: 'deploys', path: '/deploys', checks: ['http_status', 'console_errors', 'load_time'] },
    { id: 'hermes', path: '/hermes', checks: ['http_status', 'console_errors', 'load_time'] },
  ],
  viewports: [{ name: 'desktop', width: 1440, height: 900 }],
  themes: ['dark'],
  checks: {
    pixel_diff: 'skip',
    http_status: 'blocking',
    console_errors: 'warn',
    load_time: 'warn',
    // Not implemented in the current CLI yet:
    broken_images: 'warn',
    text_rendering: 'warn',
    responsive_breakpoints: 'warn',
    dark_mode: 'skip',
    og_preview: 'warn',
    accessibility: 'warn',
  },
  lane: { browser: 'chromium', os: 'macos', runner: 'macmini-local' },
};

export default config;
