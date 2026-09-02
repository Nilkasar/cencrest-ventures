import { describe, expect, it } from 'vitest';
import { isSafePublicHttpUrl } from './ssrf-guard.js';

describe('isSafePublicHttpUrl', () => {
  it('accepts an ordinary https URL', () => {
    expect(isSafePublicHttpUrl('https://example.com/apply')).toBe(true);
  });

  it('accepts an ordinary http URL', () => {
    expect(isSafePublicHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects unparseable input', () => {
    expect(isSafePublicHttpUrl('not a url')).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isSafePublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isSafePublicHttpUrl('data:text/html,<script>1</script>')).toBe(false);
  });

  it('rejects loopback and localhost', () => {
    expect(isSafePublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(isSafePublicHttpUrl('http://localhost/')).toBe(false);
  });

  it('rejects private IP ranges', () => {
    expect(isSafePublicHttpUrl('http://10.0.0.5/')).toBe(false);
    expect(isSafePublicHttpUrl('http://172.16.0.5/')).toBe(false);
    expect(isSafePublicHttpUrl('http://192.168.1.5/')).toBe(false);
  });

  it('rejects the cloud metadata link-local address', () => {
    expect(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });
});
