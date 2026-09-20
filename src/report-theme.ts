/**
 * Colour tokens + WCAG contrast math for the standalone HTML report.
 * Pure module — no imports from the rest of the project — so it stays
 * trivially unit-testable and safe to reuse from other renderers later.
 */
export interface ReportPalette {
  pageBg: string;
  cardBg: string;
  headerBg: string;
  tableHeadBg: string;
  text: string;
  mutedText: string;
  reasonText: string;
  regionText: string;
  border: string;
  checkPass: string;
  checkWarn: string;
  checkFail: string;
  checkError: string;
  checkSkip: string;
}

export const REPORT_PALETTES: { light: ReportPalette; dark: ReportPalette } = {
  light: {
    pageBg: '#fafafa',
    cardBg: '#ffffff',
    headerBg: '#ffffff',
    tableHeadBg: '#fafafa',
    text: '#111111',
    mutedText: '#666666',
    reasonText: '#c22222',
    regionText: '#a3115a',
    border: '#eaeaea',
    checkPass: '#0a6a4a',
    checkWarn: '#b45a2a',
    checkFail: '#c22222',
    checkError: '#333333',
    checkSkip: '#5e5e5e',
  },
  dark: {
    pageBg: '#111111',
    cardBg: '#1a1a1a',
    headerBg: '#191919',
    tableHeadBg: '#242424',
    text: '#eeeeee',
    mutedText: '#b7b7b7',
    reasonText: '#ff6b6b',
    regionText: '#ff6fc4',
    border: '#2a2a2a',
    checkPass: '#3ddc97',
    checkWarn: '#ffb454',
    checkFail: '#ff6b6b',
    checkError: '#cccccc',
    checkSkip: '#9a9a9a',
  },
};

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) {
    throw new Error(`Invalid hex colour: ${hex}`);
  }
  let h = m[1];
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.x contrast ratio between two colours, in the range [1, 21]. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(parseHex(fgHex));
  const l2 = relativeLuminance(parseHex(bgHex));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function paletteVars(p: ReportPalette): string {
  return `--vc-page-bg: ${p.pageBg}; --vc-card-bg: ${p.cardBg}; --vc-header-bg: ${p.headerBg}; --vc-table-head-bg: ${p.tableHeadBg}; --vc-text: ${p.text}; --vc-muted-text: ${p.mutedText}; --vc-reason-text: ${p.reasonText}; --vc-region-text: ${p.regionText}; --vc-border: ${p.border}; --vc-check-pass: ${p.checkPass}; --vc-check-warn: ${p.checkWarn}; --vc-check-fail: ${p.checkFail}; --vc-check-error: ${p.checkError}; --vc-check-skip: ${p.checkSkip};`;
}

/** CSS custom-property definitions for both palettes, light-first with a dark media override. */
export function paletteCss(): string {
  return `:root { ${paletteVars(REPORT_PALETTES.light)} }
  @media (prefers-color-scheme: dark) { :root { ${paletteVars(REPORT_PALETTES.dark)} } }`;
}
