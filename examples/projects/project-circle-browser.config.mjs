// Example project config: Project Circle Browser web site, repo TombStoneDash/project-circle-browser
// (default branch appstore/submission-operator). Example only. No workflow, deploy gate or runner reads
// this file, and it is not built or published.
//
// Use with the CLI (only projectId, routes and viewports are applied today; other keys are reported
// as "not applied yet"):
//   visual-check config-targets --config examples/projects/project-circle-browser.config.mjs --base-url https://project-circle-browser.vercel.app
//
// Circle Browser itself is a native macOS app, which Visual Check (web pages via Playwright) cannot
// capture. This covers only its web site (repo site/). /showroom/ is not deployed (404), so it is left out.
// Routes checked live on 2026-09-26, all 200.

/** @type {import('../../visual-check.config.example.js').ProjectConfig} */
const config = {
  projectId: 'project-circle-browser-site',
  baseBranch: 'appstore/submission-operator',
  routes: [
    { id: 'home', path: '/', maskSelectors: ['video'], waitFor: { selector: 'body', timeoutMs: 10_000 } },
    { id: 'privacy', path: '/privacy.html' },
    { id: 'support', path: '/support.html' },
  ],
  viewports: [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ],
  themes: ['light'],
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
