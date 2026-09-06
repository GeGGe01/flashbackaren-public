import { describe, it, expect } from 'vitest';
import { normalizeBase, mountRelativePath } from './worker';

// Base-path support lets the same worker run at a host root (workers.dev, a subdomain, local dev)
// AND under a path route like `typ.gegge.se/flashbackaren*`. CF does not strip the route prefix, so
// the worker strips it and the front end fetches against the same base.

describe('normalizeBase', () => {
  it('treats empty / undefined / "/" as root (no prefix)', () => {
    expect(normalizeBase(undefined)).toBe('');
    expect(normalizeBase('')).toBe('');
    expect(normalizeBase('/')).toBe('');
  });
  it('trims a trailing slash so "/x/" and "/x" behave the same', () => {
    expect(normalizeBase('/flashbackaren/')).toBe('/flashbackaren');
    expect(normalizeBase('/flashbackaren')).toBe('/flashbackaren');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeBase('  /flashbackaren  ')).toBe('/flashbackaren');
  });
});

describe('mountRelativePath', () => {
  const B = '/flashbackaren';
  it('maps the bare mount to "/"', () => {
    expect(mountRelativePath(B, '/flashbackaren')).toBe('/');
  });
  it('strips the prefix from api routes', () => {
    expect(mountRelativePath(B, '/flashbackaren/api/members')).toBe('/api/members');
    expect(mountRelativePath(B, '/flashbackaren/api/rate')).toBe('/api/rate');
  });
  it('does NOT strip a sibling that merely shares the prefix string (no hijack)', () => {
    expect(mountRelativePath(B, '/flashbackaren-evil/x')).toBe('/flashbackaren-evil/x');
  });
  it('is a no-op at root mount', () => {
    expect(mountRelativePath('', '/api/members')).toBe('/api/members');
    expect(mountRelativePath('', '/')).toBe('/');
  });
});
