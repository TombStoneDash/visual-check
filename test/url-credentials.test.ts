import { describe, it, expect } from 'vitest';
import { hasUrlCredentials, stripUrlCredentials } from '../src/url-credentials.js';
import { resolveCompareTarget } from '../src/commands/compare.js';
import { urlToSlug } from '../src/capture.js';

describe('stripUrlCredentials', () => {
  it('removes user:password@ and keeps the rest of the URL as written', () => {
    expect(stripUrlCredentials('https://ci:hunter2@staging.example.com/pricing?x=1#top')).toBe(
      'https://staging.example.com/pricing?x=1#top',
    );
    expect(stripUrlCredentials('http://user@localhost:3000')).toBe('http://localhost:3000');
    expect(stripUrlCredentials('https://:token@example.com/')).toBe('https://example.com/');
  });

  it('splits at the last @ of the authority, like the URL parser', () => {
    const raw = 'https://me@corp.com:p@ss@staging.example.com/a';
    expect(new URL(raw).hostname).toBe('staging.example.com');
    expect(stripUrlCredentials(raw)).toBe('https://staging.example.com/a');
  });

  it('returns URLs without credentials byte-for-byte unchanged', () => {
    for (const raw of [
      'https://trashalert.io',
      'https://example.com/path@handle',
      'https://example.com/?next=a@b',
      'file:///tmp/page.html',
      'not a url',
    ]) {
      expect(stripUrlCredentials(raw)).toBe(raw);
      expect(hasUrlCredentials(raw)).toBe(false);
    }
  });

  it('gives a credentialed URL the same baseline slug as the plain URL', () => {
    const long = `https://example.com/${'a'.repeat(150)}`;
    const withCreds = long.replace('https://', 'https://u:secret@');
    expect(urlToSlug(stripUrlCredentials(withCreds))).toBe(urlToSlug(long));
  });
});

describe('compare labels never carry credentials', () => {
  it('explicit https:// target navigates with credentials, labels without', () => {
    const t = resolveCompareTarget('https://ci:hunter2@staging.example.com/');
    expect(t.url).toBe('https://ci:hunter2@staging.example.com/');
    expect(t.label).toBe('https://staging.example.com/');
  });
});
