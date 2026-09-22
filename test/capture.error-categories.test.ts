import { describe, it, expect } from 'vitest';
import { sanitizeCaptureError, CAPTURE_ERROR_CATEGORIES } from '../src/capture.js';

const NEW_CODE_CATEGORIES: Array<[string, string]> = [
  ['net::ERR_TIMED_OUT', 'navigation_timeout'],
  ['net::ERR_CONNECTION_TIMED_OUT', 'navigation_timeout'],
  ['net::ERR_NAME_RESOLUTION_FAILED', 'name_resolution_failed'],
  ['net::ERR_CONNECTION_ABORTED', 'network_unavailable'],
  ['net::ERR_CONNECTION_FAILED', 'network_unavailable'],
  ['net::ERR_NETWORK_CHANGED', 'network_unavailable'],
  ['net::ERR_PROXY_CONNECTION_FAILED', 'network_unavailable'],
  ['net::ERR_CERT_REVOKED', 'tls_failed'],
  ['net::ERR_CERT_INVALID', 'tls_failed'],
  ['net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH', 'tls_failed'],
  ['net::ERR_BAD_SSL_CLIENT_AUTH_CERT', 'tls_failed'],
];

describe('sanitizeCaptureError - newly mapped Chromium codes', () => {
  it.each(NEW_CODE_CATEGORIES)('maps bare code %s to %s', (code, category) => {
    const result = sanitizeCaptureError(code);
    expect(result).toBe(category);
    expect(result).not.toMatch(/https?:|token|canary|Call log/i);
  });

  it.each(NEW_CODE_CATEGORIES)('maps Playwright-shaped message for %s to %s', (code, category) => {
    const message = `page.goto: ${code} at https://preview.invalid/path?token=canary\nCall log:\nsecret`;
    const result = sanitizeCaptureError(message);
    expect(result).toBe(category);
    expect(result).not.toMatch(/https?:|token|canary|Call log/i);
  });

  it.each(NEW_CODE_CATEGORIES)('result for %s is a member of CAPTURE_ERROR_CATEGORIES', (code) => {
    const result = sanitizeCaptureError(code);
    expect(CAPTURE_ERROR_CATEGORIES).toContain(result);
  });

  it('keeps unknown and look-alike codes as capture_failed', () => {
    expect(sanitizeCaptureError('net::ERR_EMPTY_RESPONSE')).toBe('capture_failed');
    expect(sanitizeCaptureError('net::ERR_TIMED_OUT_FAKE')).toBe('capture_failed');
    expect(sanitizeCaptureError('net::ERR_CERT_REVOKED_BY_ATTACKER')).toBe('capture_failed');
    expect(
      sanitizeCaptureError('page.goto: unknown failure at https://x.invalid/?q=net::ERR_TIMED_OUT')
    ).toBe('capture_failed');
  });

  it('keeps existing mappings intact', () => {
    expect(sanitizeCaptureError('net::ERR_NAME_NOT_RESOLVED')).toBe('name_resolution_failed');
    expect(sanitizeCaptureError('net::ERR_TOO_MANY_REDIRECTS')).toBe('redirect_loop');
    expect(sanitizeCaptureError('page.goto: Timeout 30000ms exceeded.')).toBe('navigation_timeout');
  });
});
