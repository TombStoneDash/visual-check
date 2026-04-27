import { describe, it, expect } from 'vitest';
import { urlToSlug } from '../src/capture.js';

describe('urlToSlug', () => {
  it('strips protocol and replaces dots in host', () => {
    expect(urlToSlug('https://trashalert.io')).toBe('trashalert-io');
  });

  it('preserves paths with underscores', () => {
    expect(urlToSlug('https://trashalert.io/pricing')).toBe('trashalert-io_pricing');
  });

  it('handles trailing slash', () => {
    expect(urlToSlug('https://trashalert.io/pricing/')).toBe('trashalert-io_pricing');
  });

  it('handles nested paths', () => {
    expect(urlToSlug('https://example.com/a/b/c')).toBe('example-com_a_b_c');
  });

  it('treats root path as bare hostname', () => {
    expect(urlToSlug('https://example.com/')).toBe('example-com');
  });

  it('is stable for non-URLs', () => {
    // Invalid URL → non-empty, filesystem-safe slug
    const slug = urlToSlug('not a url');
    expect(slug).toBe('not_a_url');
  });
});
