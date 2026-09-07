import { describe, it, expect } from 'vitest';
import { canonicalString, canonicalHash, validateCriteria, MAX_ACTIVE_CRITERIA } from './template';

const std = [
  { criterion_id: 'crit-knowledge', label: 'Kunskap', position: 1, weight_default: 1 },
  { criterion_id: 'crit-humor', label: 'Humor', position: 2, weight_default: 1 },
  { criterion_id: 'crit-helpfulness', label: 'Hjälpsamhet', position: 3, weight_default: 1 },
  { criterion_id: 'crit-quality', label: 'Kvalitet', position: 4, weight_default: 1 },
];

describe('canonicalString', () => {
  it('serializes ordered by position', () => {
    expect(canonicalString(std)).toBe(
      'crit-knowledge:1:1|crit-humor:2:1|crit-helpfulness:3:1|crit-quality:4:1',
    );
  });
  it('is order-independent (reordered input → same canonical form)', () => {
    const shuffled = [std[2], std[0], std[3], std[1]];
    expect(canonicalString(shuffled)).toBe(canonicalString(std));
  });
  it('ignores label (a pure relabel is the same shape)', () => {
    const relabelled = std.map((c) => ({ ...c, label: c.label + ' (edited)' }));
    expect(canonicalString(relabelled)).toBe(canonicalString(std));
  });
  it('normalizes 1 vs 1.0 weights to one string', () => {
    const asFloats = std.map((c) => ({ ...c, weight_default: 1.0 }));
    expect(canonicalString(asFloats)).toBe(canonicalString(std));
  });
  it('distinguishes different weights', () => {
    const heavier = std.map((c, i) => (i === 0 ? { ...c, weight_default: 2 } : c));
    expect(canonicalString(heavier)).not.toBe(canonicalString(std));
  });
});

describe('canonicalHash', () => {
  it('matches the precomputed seed hash baked into migration 0007', async () => {
    // Same value hardcoded in migrations/0007_template_ecosystem.sql for tplv-standard-v1.
    expect(await canonicalHash(std)).toBe(
      '16a5c9e91fcac900aa91b98763e34220c16ae51f6f470d7312ca7103fa927009',
    );
  });
  it('is stable across reordering', async () => {
    const shuffled = [std[3], std[2], std[1], std[0]];
    expect(await canonicalHash(shuffled)).toBe(await canonicalHash(std));
  });
});

describe('validateCriteria', () => {
  it('accepts a valid set', () => {
    expect(validateCriteria(std)).toBeNull();
  });
  it('rejects empty', () => {
    expect(validateCriteria([])).toMatch(/at least one/);
  });
  it(`rejects more than ${MAX_ACTIVE_CRITERIA}`, () => {
    const many = Array.from({ length: MAX_ACTIVE_CRITERIA + 1 }, (_, i) => ({
      criterion_id: 'c' + i,
      label: 'L' + i,
      position: i + 1,
      weight_default: 1,
    }));
    expect(validateCriteria(many)).toMatch(/at most/);
  });
  it('rejects a duplicate criterion_id', () => {
    const dup = [std[0], { ...std[1], criterion_id: 'crit-knowledge' }];
    expect(validateCriteria(dup)).toMatch(/duplicate/);
  });
  it('rejects a negative weight but allows 0', () => {
    expect(validateCriteria([{ ...std[0], weight_default: -1 }])).toMatch(/non-negative/);
    expect(validateCriteria([{ ...std[0], weight_default: 0 }])).toBeNull();
  });
  it('rejects an empty label', () => {
    expect(validateCriteria([{ ...std[0], label: '  ' }])).toMatch(/label/);
  });
});
