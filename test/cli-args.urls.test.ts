import { describe, expect, it } from 'vitest';
import { parseUrls, UsageError } from '../src/cli-args.js';

describe('parseUrls dedupe and validation', () => {
  it('deduplicates a bare host against its https:// equivalent', () => {
    expect(parseUrls('trashalert.io,https://trashalert.io')).toEqual(['https://trashalert.io']);
  });

  it('deduplicates a trailing slash and preserves order of first appearance', () => {
    expect(parseUrls('https://a.example,https://a.example/,https://b.example')).toEqual([
      'https://a.example', 'https://b.example',
    ]);
  });

  it('does not collapse different paths on the same host', () => {
    expect(parseUrls('https://a.example/one,https://a.example/two')).toEqual([
      'https://a.example/one', 'https://a.example/two',
    ]);
  });

  it('does not collapse http and https on the same host', () => {
    expect(parseUrls('http://a.example,https://a.example')).toEqual([
      'http://a.example', 'https://a.example',
    ]);
  });

  it('throws UsageError naming the raw invalid entry', () => {
    expect(() => parseUrls('https://a.example, not a url')).toThrow(UsageError);
    expect(() => parseUrls('https://a.example, not a url')).toThrow('not a url');
  });

  it('rejects an entry with no host', () => {
    expect(() => parseUrls('https://')).toThrow(UsageError);
    expect(() => parseUrls('https://')).toThrow('https://');
  });

  it('rejects a non-http scheme written explicitly', () => {
    expect(() => parseUrls('ftp://a.example')).toThrow(UsageError);
    expect(() => parseUrls('ftp://a.example')).toThrow('ftp://a.example');
  });

  it('still trims, ignores empty entries, and defaults bare hosts to HTTPS', () => {
    expect(parseUrls(' example.com, http://local.test, https://secure.test, ')).toEqual([
      'https://example.com', 'http://local.test', 'https://secure.test',
    ]);
  });

  it.each(['', ',', '   ', ' , , '])('rejects an empty list %j', (raw) => {
    expect(() => parseUrls(raw)).toThrow(UsageError);
    expect(() => parseUrls(raw)).toThrow('No URLs were given.');
  });
});
