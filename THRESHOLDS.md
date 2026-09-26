# Visual Check — per-project pixel-diff thresholds

`visual-check deploy-gate --threshold <pct>` controls the pixel-diff fail gate.
Defaults are codified in `.github/workflows/visual-check.yml`. Override per
run with `--threshold` on the CLI or the `threshold` input on
`workflow_dispatch`.

| Project | Threshold | Notes |
|---|---|---|
| trashalert | 0.1% | Catches one-word H1 changes (~0.2%) |
| actorlab | 0.5% | Seeded 2026-09-25: 0% reload noise; one-word H1 edit 0.81-31.8% |
| lims | 0.5% | Seeded 2026-09-25: 0% reload noise; one-word H1 edit 0.91-2.62% |
| noui.bot | 0.01% | Seeded 2026-09-25: 0% reload noise; no heading above the fold, one-word button edit 0.004-0.017% (caught on mobile only) |
| prelithic | 0.12% | Seeded 2026-09-25: reload noise up to 0.082% (random particle background); one-word H1 edit 0.164% on mobile, inside the noise on tablet and desktop |

When seeding a new project, do a no-op deploy-gate run against a known-good
URL, then a second run with an intentional small change, observe the
`diff_percentage` distribution, and pick a threshold a bit below the smallest
intentional change you want to catch.

### Seeding run, 2026-09-25

- Pages: the home page of each project (https://actorlab.io/, https://lims.bot/,
  https://noui.bot/, https://prelithic.com/), at the three default viewports.
- Capture settings match `Capturer.capture` (networkidle, animations off,
  fonts ready, viewport only); diffs use `diffPngs` defaults, like deploy-gate.
  Chromium 1217, macOS runner.
- Noise: two pairs of separate page loads per viewport, no change.
- Intentional change: one word of the first visible heading (noui.bot: a button
  label) replaced with X's of the same length, inside the browser only.
- Rule used: a bit below the smallest measured edit, and above the noise.
- Limits: one sampling time per site, so rotating or time-based content may
  need a higher value later. On prelithic tablet and desktop a one-word edit is
  smaller than the particle noise; masking the particle layer would let the
  threshold drop. Re-seed after a page redesign.
