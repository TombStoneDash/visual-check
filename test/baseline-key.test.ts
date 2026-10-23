import { describe, expect, it } from 'vitest';
import { baselineStorageKey, storageSlug } from '../src/baseline-key.js';
import { urlToSlug } from '../src/capture.js';
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

  it('keeps percent-encoded paths out of the key so Storage cannot decode them', () => {
    // Supabase decodes the request path, so `%C3%A9` would become `é` and
    // `%25` would become `%`, both of which Storage rejects as an invalid key.
    expect(baselineStorageKey('project', 'https://x.io/caf%C3%A9', 'mobile', macLane)).toBe(
      'project/macos-macmini-local/x-io_caf!C3!A9/mobile.png',
    );
    expect(baselineStorageKey('project', 'https://x.io/100%25-off', 'mobile', macLane)).toBe(
      'project/macos-macmini-local/x-io_100!25-off/mobile.png',
    );
  });
});

describe('storageSlug', () => {
  // Supabase Storage's accepted key characters (storage-api isValidKey).
  const SUPABASE_KEY_CHARS = /^[\w/!\-.*'() &$@=;:+,?]*$/;

  it('leaves slugs without a percent sign exactly as urlToSlug made them', () => {
    for (const url of ['https://x.io', 'https://x.io/pricing/', 'http://127.0.0.1:8080/a?b=c']) {
      expect(storageSlug(url)).toBe(urlToSlug(url));
    }
  });

  it('only emits characters Supabase accepts in an object key', () => {
    for (const url of [
      'https://x.io/caf%C3%A9',
      'https://x.io/100%25-off',
      'https://x.io/a b/日本',
      'https://x.io/%zz',
      'not a url %%',
    ]) {
      expect(storageSlug(url)).toMatch(SUPABASE_KEY_CHARS);
      expect(storageSlug(url)).not.toContain('%');
    }
  });

  it('keeps different percent-encoded paths on different keys', () => {
    expect(storageSlug('https://x.io/caf%C3%A9')).not.toBe(storageSlug('https://x.io/caf%C3%A8'));
  });
});

