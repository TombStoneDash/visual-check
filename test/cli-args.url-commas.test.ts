import { describe, it, expect } from 'vitest';
import { formatUrlsValue, parseUrls, UsageError } from '../src/cli-args.js';
import { resolveConfigTargets } from '../src/project-config.js';

// --urls is comma-separated, but a URL may itself contain a comma. The piece
// after such a comma used to become a target of its own: "?ids=1,2" checked
// "https://2", which is the IPv4 address 0.0.0.2.

describe('URLs that contain a comma', () => {
  it('rejects the fragment a comma split off, with a hint', () => {
    expect(() => parseUrls('https://x.com/?ids=1,2')).toThrow(UsageError);
    expect(() => parseUrls('https://x.com/?ids=1,2')).toThrow(/Invalid --urls entry: 2 .*%2C/);
    expect(() => parseUrls('https://x.com/compare/a,b')).toThrow(/Invalid --urls entry: b /);
  });

  it('still accepts scheme-less hosts, localhost and ports', () => {
    expect(parseUrls('example.com,localhost:3000/a,sub.example.com:8080')).toEqual([
      'https://example.com',
      'https://localhost:3000/a',
      'https://sub.example.com:8080',
    ]);
  });

  it('round-trips a config with commas through config-targets output and --urls', () => {
    const { urls } = resolveConfigTargets(
      {
        projectId: 'shop',
        routes: [
          { id: 'search', path: '/search?tags=a,b' },
          { id: 'compare', path: '/compare/x,y' },
        ],
      },
      'https://shop.example.com',
    );
    const value = formatUrlsValue(urls);
    expect(value).toBe(
      'https://shop.example.com/search?tags=a%2Cb,https://shop.example.com/compare/x%2Cy',
    );
    expect(parseUrls(value)).toEqual([
      'https://shop.example.com/search?tags=a%2Cb',
      'https://shop.example.com/compare/x%2Cy',
    ]);
  });

  it('leaves URLs without commas unchanged', () => {
    expect(formatUrlsValue(['https://a.example/', 'https://b.example/p?q=1'])).toBe(
      'https://a.example/,https://b.example/p?q=1',
    );
  });
});
