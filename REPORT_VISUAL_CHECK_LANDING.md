# Visual-Check — trashalert.io landing pages

- Run ID: `vc_moag1bl7_c84zr5`
- Timestamp: 2026-04-22T19:26:23.467Z
- Lane: `chromium` / `linux` / `thinkcentre-local`
- Mode: headless throughout
- URLs checked (4): `https://trashalert.io`, `/pricing`, `/for-property-managers`, `/narpm`
- Viewports (3): mobile, tablet, desktop → 12 targets

## Phase results

| Phase | Description | Result |
|---|---|---|
| A | `npm install` + Playwright Chromium (fixed cmd.exe PATH so esbuild/playwright postinstalls could find `node`) | ✅ |
| B | `visual-check baseline` — captured 12 baselines (4 URLs × 3 viewports), all HTTP 200 | ✅ |
| C | `visual-check run` against the same URLs → `reports/first-run.json` (+ HTML) | ✅ (overall `pass: true`) |
| D | This report written | ✅ |

## Summary counts (from `reports/first-run.json`)

- `pass`: **true**
- total: **12**
- passed: **9**
- warnings: **3**
- failed: **0**
- errors: **0**
- needs_baseline: **0**
- pixel_diff_threshold: 5%
- load_time_warn_ms: 3000

## Flagged targets

### diff_percentage > 0.5%

_None._ All 12 targets reported `diff_percentage: 0` (pixel diff 0.000%), which is the expected zero-diff green state immediately after baselining.

### load_time_ms > 2000

| URL | Viewport | load_time_ms |
|---|---|---|
| https://trashalert.io | mobile | 8800 |
| https://trashalert.io | tablet | 9469 |
| https://trashalert.io | desktop | 9762 |
| https://trashalert.io/pricing | mobile | 2054 |
| https://trashalert.io/pricing | tablet | 2241 |
| https://trashalert.io/for-property-managers | desktop | 2024 |

The three `trashalert.io` root-page targets exceed the 3000 ms warn threshold and account for all three `warnings` in the summary. The other three above are under the warn budget but still over the 2000 ms notice line requested for this report.

### console_errors > 0

_None._ Every target reported `console_errors: 0`.

## Report artifacts

- JSON: `reports/first-run.json`
- HTML: `reports/first-run.html` (absolute: `C:\TombstoneDash\projects\visual-check\reports\first-run.html`)
- Captures: `captures/2026-04-22/2026-04-22T19-26-06-550Z/…`
- Diffs: `diffs/2026-04-22/2026-04-22T19-26-06-550Z/…`
- Baselines: `baselines/trashalert-io{,_pricing,_for-property-managers,_narpm}/{mobile,tablet,desktop}.png`

## Recommended next step

Investigate the trashalert.io root-page load time (8.8–9.8 s across all viewports, ~5× the subpages) — likely a hero-asset/third-party-script regression; subpages are fine, so gating criteria can stay as-is while that is triaged.
