import { describe, it, expect } from 'vitest';
import { contrastRatio, paletteCss, REPORT_PALETTES, ReportPalette } from '../src/report-theme.js';

describe('contrastRatio', () => {
  it('is 21 for pure black on pure white', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 1);
  });

  it('is 1 for identical colours', () => {
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 2);
  });

  it('documents the old bug: #666 on #111 fails AA', () => {
    expect(contrastRatio('#666', '#111')).toBeLessThan(4.5);
  });

  it('is symmetric with respect to argument order', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 5);
  });

  it('throws on invalid input', () => {
    expect(() => contrastRatio('not-a-color', '#fff')).toThrow();
    expect(() => contrastRatio('#fff', 'rgb(0,0,0)')).toThrow();
    expect(() => contrastRatio('#ff', '#fff')).toThrow();
  });
});

const TEXT_KEYS = ['text', 'mutedText', 'reasonText', 'regionText', 'checkPass', 'checkWarn', 'checkFail', 'checkError', 'checkSkip'] as const;
const BG_KEYS = ['pageBg', 'cardBg', 'headerBg', 'tableHeadBg'] as const;

describe('REPORT_PALETTES', () => {
  (['light', 'dark'] as const).forEach((mode) => {
    describe(`${mode} palette`, () => {
      const palette: ReportPalette = REPORT_PALETTES[mode];
      TEXT_KEYS.forEach((textKey) => {
        BG_KEYS.forEach((bgKey) => {
          it(`${textKey} reaches AA contrast against ${bgKey}`, () => {
            const ratio = contrastRatio(palette[textKey], palette[bgKey]);
            expect(ratio).toBeGreaterThanOrEqual(4.5);
          });
        });
      });
    });
  });
});

describe('paletteCss', () => {
  const css = paletteCss();

  it('contains exactly one prefers-color-scheme: dark block', () => {
    const matches = css.match(/prefers-color-scheme:\s*dark/g) ?? [];
    expect(matches.length).toBe(1);
  });

  const ALL_KEYS = [...BG_KEYS, ...TEXT_KEYS, 'border'] as const;
  const CSS_VAR_NAMES: Record<string, string> = {
    pageBg: '--vc-page-bg',
    cardBg: '--vc-card-bg',
    headerBg: '--vc-header-bg',
    tableHeadBg: '--vc-table-head-bg',
    text: '--vc-text',
    mutedText: '--vc-muted-text',
    reasonText: '--vc-reason-text',
    regionText: '--vc-region-text',
    border: '--vc-border',
    checkPass: '--vc-check-pass',
    checkWarn: '--vc-check-warn',
    checkFail: '--vc-check-fail',
    checkError: '--vc-check-error',
    checkSkip: '--vc-check-skip',
  };

  it('defines every palette property in both the root and dark blocks', () => {
    const darkBlockMatch = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*)\}\s*$/.exec(css);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch![1];
    const rootBlock = css.slice(0, css.indexOf('@media'));

    ALL_KEYS.forEach((key) => {
      const varName = CSS_VAR_NAMES[key];
      expect(rootBlock).toContain(varName);
      expect(darkBlock).toContain(varName);
    });
  });
});
