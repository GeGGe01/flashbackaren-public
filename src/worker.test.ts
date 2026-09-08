import { describe, it, expect } from 'vitest';
import { vString, cleanComment, normalizeBase, mountRelativePath } from './worker';

// A–E.3: untrusted API-JSON string fields are validated by TYPE, never String()-coerced. vString is
// the shared helper behind name/description/label/criterion_id/parent_version_id/change_note.
describe('vString (strict string extraction)', () => {
  it('rejects a non-string (object/number/boolean) — no "[object Object]"', () => {
    expect(vString({ foo: 'bar' }).ok).toBe(false);
    expect(vString(123).ok).toBe(false);
    expect(vString(true).ok).toBe(false);
    expect(vString([]).ok).toBe(false);
  });
  it('absent → null unless required', () => {
    expect(vString(undefined)).toEqual({ ok: true, value: null });
    expect(vString(null)).toEqual({ ok: true, value: null });
    expect(vString(undefined, { required: true }).ok).toBe(false);
  });
  it('required empty/whitespace → error', () => {
    expect(vString('   ', { required: true }).ok).toBe(false);
  });
  it('enforces max length', () => {
    expect(vString('abcdef', { max: 3 }).ok).toBe(false);
    expect(vString('ab', { max: 3 })).toEqual({ ok: true, value: 'ab' });
  });
  it('trims by default; trim:false keeps as-is', () => {
    expect(vString('  hi  ')).toEqual({ ok: true, value: 'hi' });
    expect(vString('  hi  ', { trim: false })).toEqual({ ok: true, value: '  hi  ' });
  });
});

describe('cleanComment (strict)', () => {
  it('null/undefined → null', () => {
    expect(cleanComment(null)).toBeNull();
    expect(cleanComment(undefined)).toBeNull();
  });
  it('a non-string (object) → invalid (false), never "[object Object]"', () => {
    expect(cleanComment({ foo: 'bar' })).toBe(false);
    expect(cleanComment(123)).toBe(false);
  });
  it('a valid string round-trips (trimmed)', () => {
    expect(cleanComment('  bra användare  ')).toBe('bra användare');
  });
  it('over-long → false', () => {
    expect(cleanComment('x'.repeat(421))).toBe(false);
  });
});

// (base-path helpers already covered in basepath.test.ts; re-exported here only to confirm the
// worker module imports cleanly under vitest.)
describe('worker module loads', () => {
  it('exposes base-path helpers', () => {
    expect(normalizeBase('/x/')).toBe('/x');
    expect(mountRelativePath('/x', '/x/api')).toBe('/api');
  });
});
