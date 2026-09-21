import { describe, expect, it } from 'vitest';
import { baselineStorageKey } from '../src/baseline-key.js';
import type { BaselineLane } from '../src/types.js';

const macLane: BaselineLane = { browser: 'chromium', os: 'macos', runner: 'macmini-local' };

describe('baselineStorageKey', () => {
  it('isolates the same target across capture lanes', () => {
    const windowsLane: BaselineLane = { browser: 'chromium', os: 'windows', runner: 'lenovo-local' };
    const macKey = baselineStorageKey('project', 'https://x.io', 'desktop', macLane);
    const windowsKey = baselineStorageKey('project', 'https://x.io', 'desktop', windowsLane);

    expect(macKey).toBe('project/macos-macmini-local/x-io/desktop.png');
    expect(windowsKey).toBe('project/windows-lenovo-local/x-io/desktop.png');
    expect(macKey).not.toBe(windowsKey);
  });

  it('is stable for the same lane and target', () => {
    expect(baselineStorageKey('project', 'https://x.io', 'mobile', macLane)).toBe(
      baselineStorageKey('project', 'https://x.io', 'mobile', { ...macLane }),
    );
  });

  it('sanitizes odd lane characters to lowercase letters, digits, and hyphens', () => {
    // Stored run config can contain values outside the TypeScript lane union.
    const oddLane = { browser: 'chromium', os: 'MacOS!', runner: 'Mini/Local_2' } as unknown as BaselineLane;
    const key = baselineStorageKey('project', 'https://x.io', 'desktop', oddLane);

    expect(key).toBe('project/macos--mini-local-2/x-io/desktop.png');
    expect(key.split('/')[1]).toMatch(/^[a-z0-9-]+$/);
  });
});
