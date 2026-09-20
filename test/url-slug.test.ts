import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { urlToSlug } from '../src/capture.js';

const SAFE = /^[A-Za-z0-9._%-]+$/;

describe('urlToSlug - backward compatible cases', () => {
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

  it('is stable and safe for non-URLs', () => {
    expect(urlToSlug('not a url')).toMatch(/^[A-Za-z0-9_]+$/);
  });
});

describe('urlToSlug - query string collisions', () => {
  it('gives different, stable slugs for different queries on the same path', () => {
    const a1 = urlToSlug('https://shop.example/search?q=shoes');
    const a2 = urlToSlug('https://shop.example/search?q=shoes');
    const b1 = urlToSlug('https://shop.example/search?q=hats');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
    expect(a1.startsWith('shop-example_search_q')).toBe(true);
    expect(b1.startsWith('shop-example_search_q')).toBe(true);
  });

  it('ignores a bare "?" with no query content', () => {
    expect(urlToSlug('https://example.com/pricing?')).toBe('example-com_pricing');
  });
});

describe('urlToSlug - port collisions', () => {
  it('gives different slugs for different ports on the same host', () => {
    const a = urlToSlug('http://localhost:3000/');
    const b = urlToSlug('http://localhost:4000/');
    expect(a).not.toBe(b);
    expect(a).toBe('localhost-p3000');
    expect(b).toBe('localhost-p4000');
  });

  it('combines port and path', () => {
    expect(urlToSlug('http://localhost:3000/x')).toBe('localhost-p3000_x');
  });

  it('combines port and query', () => {
    const a = urlToSlug('http://localhost:3000/search?q=shoes');
    const b = urlToSlug('http://localhost:4000/search?q=shoes');
    expect(a).not.toBe(b);
    expect(a.startsWith('localhost-p3000_search_q')).toBe(true);
  });
});

describe('urlToSlug - fragment is ignored', () => {
  it('produces the same slug regardless of hash fragment', () => {
    const withFragment = urlToSlug('https://example.com/pricing#section-2');
    const withoutFragment = urlToSlug('https://example.com/pricing');
    expect(withFragment).toBe(withoutFragment);
  });
});

describe('urlToSlug - long paths', () => {
  it('truncates a 600-char path to at most 120 chars', () => {
    const longPath = '/' + 'a'.repeat(600);
    const slug = urlToSlug(`https://example.com${longPath}`);
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug).toMatch(SAFE);
  });

  it('gives different slugs for two long paths sharing a 200-char prefix', () => {
    const shared = 'a'.repeat(200);
    const urlA = `https://example.com/${shared}${'b'.repeat(400)}`;
    const urlB = `https://example.com/${shared}${'c'.repeat(400)}`;
    const slugA = urlToSlug(urlA);
    const slugB = urlToSlug(urlB);
    expect(slugA).not.toBe(slugB);
    expect(slugA.length).toBeLessThanOrEqual(120);
    expect(slugB.length).toBeLessThanOrEqual(120);
  });
});

describe('urlToSlug - filesystem-illegal characters', () => {
  it('strips characters illegal on Windows file systems', () => {
    const slug = urlToSlug('https://example.com/a:b*c|d');
    expect(slug).toMatch(SAFE);
  });
});

describe('urlToSlug - hostile inputs stay within base directory', () => {
  const hostileInputs = [
    'https://example.com/../../etc/passwd',
    'https://example.com/%2e%2e/%2e%2e/x',
    '..',
    '../../x',
    '',
  ];

  for (const input of hostileInputs) {
    it(`is safe for ${JSON.stringify(input)}`, () => {
      const slug = urlToSlug(input);
      expect(slug).toMatch(SAFE);
      expect(slug).not.toBe('.');
      expect(slug).not.toBe('..');

      const base = path.resolve('/tmp/visual-check-base');
      const resolved = path.resolve(base, slug);
      expect(resolved === base || resolved.startsWith(base + path.sep)).toBe(true);
    });
  }
});

describe('urlToSlug - file:// URLs', () => {
  it('gives a non-empty, safe slug', () => {
    const slug = urlToSlug('file:///tmp/site/index.html');
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toMatch(SAFE);
  });
});
