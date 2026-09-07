import { describe, it, expect } from 'vitest';
import {
  canonicalString,
  canonicalHash,
  validateCriteria,
  MAX_ACTIVE_CRITERIA,
  snapshotHash,
  logicHash,
  type VersionForHash,
} from './template';

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

describe('V3 dual hashing (snapshot vs logic)', () => {
  const base: VersionForHash = {
    name: 'Forumdebattör',
    description: 'x',
    calculation_config: { kind: 'native', aggregator: 'weighted_mean', modifiers: [] },
    presentation_config: { result: 'stars' },
    criteria: [
      { criterion_id: 'crit-knowledge', label: 'Kunskap', type: 'scale', position: 1, default_active: true, default_weight_milli: 1000, scoring_config: { min: 0, max: 5 } },
      { criterion_id: 'crit-humor', label: 'Humor', type: 'scale', position: 2, default_active: true, default_weight_milli: 1000, scoring_config: { min: 0, max: 5 } },
    ],
  };
  // The load-bearing V3 fix: a relabel (same criterion_id) is a NEW published version — snapshot_hash
  // MUST change, logic_hash MUST NOT (same scoring model, different presentation). Never dedup it away.
  it('relabel → snapshot_hash changes, logic_hash unchanged', async () => {
    const relabelled: VersionForHash = {
      ...base,
      criteria: [{ ...base.criteria[0], label: 'Ämneskunskap' }, base.criteria[1]],
    };
    expect(await snapshotHash(relabelled)).not.toBe(await snapshotHash(base));
    expect(await logicHash(relabelled)).toBe(await logicHash(base));
  });
  it('weight change → BOTH hashes change (it is a scoring difference)', async () => {
    const heavier: VersionForHash = {
      ...base,
      criteria: [{ ...base.criteria[0], default_weight_milli: 2000 }, base.criteria[1]],
    };
    expect(await snapshotHash(heavier)).not.toBe(await snapshotHash(base));
    expect(await logicHash(heavier)).not.toBe(await logicHash(base));
  });
  it('is stable + key-order independent', async () => {
    const reordered: VersionForHash = {
      criteria: base.criteria,
      presentation_config: { result: 'stars' },
      name: 'Forumdebattör',
      calculation_config: { modifiers: [], aggregator: 'weighted_mean', kind: 'native' },
      description: 'x',
    };
    expect(await snapshotHash(reordered)).toBe(await snapshotHash(base));
  });
});
