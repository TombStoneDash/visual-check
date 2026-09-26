// Example project config: Pyramid Builder (Prelithic), repo TombStoneDash/menkaure (branch master).
// Example only. No workflow, deploy gate or runner reads this file, and it is not built or published.
//
// Use with the CLI (only projectId, routes and viewports are applied today; other keys are reported
// as "not applied yet"):
//   visual-check config-targets --config examples/projects/pyramid-builder.config.mjs --base-url https://prelithic.com
//
// Canonical site: https://prelithic.com (repo metadataBase and live canonical tags; prelithic.build is 404
// and www.prelithic.com does not connect). /block/[id] is left out: there is no stable public id.
// Routes checked live on 2026-09-26, all 200. /donate and /faq exist in the repo but returned 404 on both
// prelithic.com and menkaure.vercel.app that day, so they are left out until the site owner restores them.

/** @type {import('../../visual-check.config.example.js').ProjectConfig} */
const config = {
  projectId: 'menkaure',
  baseBranch: 'master',
  routes: [
    { id: 'home', path: '/', waitFor: { selector: 'main', timeoutMs: 15_000, networkIdle: true } },
    { id: 'dedicate', path: '/dedicate', waitFor: { selector: 'main', timeoutMs: 15_000 } },
    { id: 'builders', path: '/builders', waitFor: { selector: 'main', timeoutMs: 15_000 } },
    { id: 'ledger', path: '/ledger', waitFor: { selector: 'main', timeoutMs: 15_000 } },
    // Live stream page: the video frame changes on every capture, so mask it.
    { id: 'stream', path: '/stream', maskSelectors: ['video', 'iframe'], checks: ['http_status', 'console_errors'] },
  ],
  viewports: [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ],
  themes: ['dark'],
  checks: {
    pixel_diff: 'blocking',
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
