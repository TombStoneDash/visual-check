import { describe, expect, it } from 'vitest';
import { formatViewportToken, parseViewports, UsageError } from '../src/cli-args.js';
import { DEFAULT_VIEWPORTS, MAX_VIEWPORT_SIDE } from '../src/types.js';

describe('parseViewports name:WIDTHxHEIGHT tokens', () => {
  it('parses desktop:1280x800 into a custom-size spec', () => {
    expect(parseViewports('desktop:1280x800')).toEqual([{ name: 'desktop', width: 1280, height: 800 }]);
  });

  it('mixes bare names (default size) with sized tokens, in DEFAULT_VIEWPORTS order', () => {
    expect(parseViewports('desktop:1280x800, mobile')).toEqual([
      { name: 'mobile', width: 390, height: 844 },
      { name: 'desktop', width: 1280, height: 800 },
    ]);
  });

  it('accepts a side of exactly MAX_VIEWPORT_SIDE', () => {
    expect(parseViewports(`desktop:${MAX_VIEWPORT_SIDE}x${MAX_VIEWPORT_SIDE}`)).toEqual([
      { name: 'desktop', width: MAX_VIEWPORT_SIDE, height: MAX_VIEWPORT_SIDE },
    ]);
  });

  it('treats a sized token at the default size the same as the bare name', () => {
    expect(parseViewports('desktop:1440x900')).toEqual([DEFAULT_VIEWPORTS[2]]);
    expect(parseViewports('desktop,desktop:1440x900')).toEqual([DEFAULT_VIEWPORTS[2]]);
  });

  it.each([
    ['phone', /Unknown viewports: phone/],
    ['phone:1280x800', /Unknown viewports: phone:1280x800/],
    ['desktop:0x800', /Invalid viewport size: desktop:0x800/],
    ['desktop:14400x900', /Invalid viewport size: desktop:14400x900 \(width and height can be at most 10000\)/],
    ['mobile:390x10001', /at most 10000/],
    ['desktop:1280', /Unknown viewports: desktop:1280/],
    ['desktop:1280x', /Unknown viewports: desktop:1280x/],
    ['desktop:-1280x800', /Unknown viewports: desktop:-1280x800/],
    ['desktop:1280x800,desktop:1000x800', /given twice with different sizes/],
  ])('rejects %s with a usage error', (raw, message) => {
    expect(() => parseViewports(raw)).toThrow(UsageError);
    expect(() => parseViewports(raw)).toThrow(message);
  });
});

describe('formatViewportToken round-trip', () => {
  it('prints the bare name at the default size and name:WxH otherwise', () => {
    expect(formatViewportToken(DEFAULT_VIEWPORTS[0]!)).toBe('mobile');
    expect(formatViewportToken({ name: 'desktop', width: 1280, height: 800 })).toBe('desktop:1280x800');
  });

  it('config-targets output fed back through parseViewports yields identical specs', () => {
    const specs = [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 700, height: 1000 },
      { name: 'desktop', width: 1280, height: 800 },
    ];
    const line = specs.map(formatViewportToken).join(',');
    expect(line).toBe('mobile,tablet:700x1000,desktop:1280x800');
    expect(parseViewports(line)).toEqual(specs);
  });
});
