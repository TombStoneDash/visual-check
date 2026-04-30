# Visual Check — per-project pixel-diff thresholds

`visual-check deploy-gate --threshold <pct>` controls the pixel-diff fail gate.
Defaults are codified in `.github/workflows/visual-check.yml`. Override per
run with `--threshold` on the CLI or the `threshold` input on
`workflow_dispatch`.

| Project | Threshold | Notes |
|---|---|---|
| trashalert | 0.1% | Catches one-word H1 changes (~0.2%) |
| actorlab | TBD | Set when seeded |
| lims | TBD | Set when seeded |
| noui.bot | TBD | Set when seeded |
| prelithic | TBD | Set when seeded |

When seeding a new project, do a no-op deploy-gate run against a known-good
URL, then a second run with an intentional small change, observe the
`diff_percentage` distribution, and pick a threshold a bit below the smallest
intentional change you want to catch.
