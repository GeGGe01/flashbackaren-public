import { describe, it, expect } from 'vitest';
import {
  normalize,
  aggregate,
  evaluate,
  bpToStars,
  weightToMilli,
  BP_MAX,
  type EvalInput,
  type CalculationConfig,
} from './scoring';

const scale05 = { min: 0, max: 5, step: 0.5 };

describe('normalize', () => {
  it('scale 0..5: value → bp', () => {
    expect(normalize('scale', scale05, { value: 5 })).toBe(10000);
    expect(normalize('scale', scale05, { value: 0 })).toBe(0);
    expect(normalize('scale', scale05, { value: 4.5 })).toBe(9000);
  });
  it('scale legacy halfsteps (0..10) still normalizes', () => {
    expect(normalize('scale', scale05, { halfsteps: 9 })).toBe(9000); // 9 halfsteps = 4.5 stars
  });
  it('percentage 0..100 → bp (73 → 7300)', () => {
    expect(normalize('percentage', {}, { value: 73 })).toBe(7300);
    expect(normalize('percentage', {}, { value: 100 })).toBe(10000);
  });
  it('boolean uses configured mapping (default true=10000/false=0)', () => {
    expect(normalize('boolean', {}, { value: true })).toBe(10000);
    expect(normalize('boolean', {}, { value: false })).toBe(0);
    expect(normalize('boolean', { true_bp: 8000, false_bp: 2000 }, { value: true })).toBe(8000);
  });
  it('ordinal maps a label to its configured score_bp', () => {
    const cfg = {
      options: [
        { label: 'Usel', score_bp: 0 },
        { label: 'Okej', score_bp: 5000 },
        { label: 'Utmärkt', score_bp: 10000 },
      ],
    };
    expect(normalize('ordinal', cfg, { value: 'Utmärkt' })).toBe(10000);
    expect(normalize('ordinal', cfg, { value: 'Okej' })).toBe(5000);
    expect(normalize('ordinal', cfg, { index: 0 })).toBe(0);
  });
  it('clamps out-of-range to 0..10000', () => {
    expect(normalize('scale', scale05, { value: 9 })).toBe(10000);
    expect(normalize('percentage', {}, { value: -5 })).toBe(0);
  });
});

describe('aggregate', () => {
  const items = [
    { bp: 9000, weight_milli: 1000 },
    { bp: 4000, weight_milli: 1000 },
    { bp: 8000, weight_milli: 1000 },
  ];
  it('mean', () => expect(aggregate('mean', items)).toBe(7000));
  it('median', () => expect(aggregate('median', items)).toBe(8000));
  it('minimum', () => expect(aggregate('minimum', items)).toBe(4000));
  it('maximum', () => expect(aggregate('maximum', items)).toBe(9000));
  it('weighted_mean respects weights', () => {
    expect(aggregate('weighted_mean', [
      { bp: 10000, weight_milli: 3000 },
      { bp: 0, weight_milli: 1000 },
    ])).toBe(7500);
  });
  it('weighted_mean with all-zero weights → 0 (no divide-by-zero)', () => {
    expect(aggregate('weighted_mean', [{ bp: 9000, weight_milli: 0 }])).toBe(0);
  });
});

describe('evaluate — the operator’s own trace example', () => {
  // Kunskap 4.5 × 73% + Humor 2.0 × 2% + Hjälpsamhet 4.0 × 25% = 4.325 (contract example).
  const calc: CalculationConfig = { kind: 'native', aggregator: 'weighted_mean', modifiers: [] };
  const inputs: EvalInput[] = [
    { criterion_id: 'k', label: 'Kunskap', type: 'scale', scoring_config: scale05, raw: { value: 4.5 }, weight_milli: weightToMilli(73) },
    { criterion_id: 'h', label: 'Humor', type: 'scale', scoring_config: scale05, raw: { value: 2.0 }, weight_milli: weightToMilli(2) },
    { criterion_id: 'j', label: 'Hjälpsamhet', type: 'scale', scoring_config: scale05, raw: { value: 4.0 }, weight_milli: weightToMilli(25) },
  ];
  const ev = evaluate(calc, inputs);
  it('produces 8650 bp = 4.325 stars (finer than 0.5★ — acceptance #18)', () => {
    expect(ev.score_bp).toBe(8650);
    expect(bpToStars(ev.score_bp)).toBeCloseTo(4.325, 3);
    expect(ev.score_bp % 1000).not.toBe(0); // not snapped to a half-star
  });
  it('trace contributions match (3.285 / 0.040 / 1.000 stars)', () => {
    const stars = (bp: number) => bpToStars(bp);
    const k = ev.lines.find((l) => l.criterion_id === 'k')!;
    const h = ev.lines.find((l) => l.criterion_id === 'h')!;
    const j = ev.lines.find((l) => l.criterion_id === 'j')!;
    expect(k.weight_pct).toBeCloseTo(73, 1);
    expect(stars(k.contribution_bp)).toBeCloseTo(3.285, 2);
    expect(stars(h.contribution_bp)).toBeCloseTo(0.04, 2);
    expect(stars(j.contribution_bp)).toBeCloseTo(1.0, 2);
  });
});

describe('evaluate — arbitrary weights (acceptance #19/#20)', () => {
  it('weight > 5 survives and affects the result', () => {
    const calc: CalculationConfig = { kind: 'native', aggregator: 'weighted_mean' };
    const ev = evaluate(calc, [
      { criterion_id: 'a', label: 'A', type: 'scale', scoring_config: scale05, raw: { value: 5 }, weight_milli: weightToMilli(73) },
      { criterion_id: 'b', label: 'B', type: 'scale', scoring_config: scale05, raw: { value: 0 }, weight_milli: weightToMilli(25) },
    ]);
    // (10000*73 + 0*25)/98 = 7448.98 → 7449
    expect(ev.score_bp).toBe(7449);
  });
  it('decimal weight (2.5) survives as fixed-point milli', () => {
    expect(weightToMilli(2.5)).toBe(2500);
  });
});

describe('evaluate — modifiers', () => {
  const base: EvalInput[] = [
    { criterion_id: 'kallkritik', label: 'Källkritik', type: 'scale', scoring_config: scale05, raw: { value: 1.0 }, weight_milli: 1000 },
    { criterion_id: 'other', label: 'Annat', type: 'scale', scoring_config: scale05, raw: { value: 5.0 }, weight_milli: 1000 },
  ];
  it('cap: "if Källkritik < 1.5★ (3000bp) total ≤ 2.0★ (4000bp)"', () => {
    const calc: CalculationConfig = {
      kind: 'native',
      aggregator: 'weighted_mean',
      modifiers: [{ kind: 'cap', criterion_id: 'kallkritik', below_bp: 3000, cap_bp: 4000 }],
    };
    const ev = evaluate(calc, base); // base weighted mean = (2000+10000)/2 = 6000 → capped to 4000
    expect(ev.base_bp).toBe(6000);
    expect(ev.score_bp).toBe(4000);
    expect(ev.modifiers[0].applied).toBe(true);
  });
  it('veto: criterion below threshold → final 0', () => {
    const calc: CalculationConfig = {
      kind: 'native',
      aggregator: 'weighted_mean',
      modifiers: [{ kind: 'veto', criterion_id: 'kallkritik', below_bp: 3000 }],
    };
    // Källkritik 1.0★ = 2000bp < 3000bp → veto fires → final 0.
    expect(evaluate(calc, base).score_bp).toBe(0);
  });
  it('threshold: global clamp', () => {
    const calc: CalculationConfig = {
      kind: 'native',
      aggregator: 'weighted_mean',
      modifiers: [{ kind: 'threshold', min_bp: 7000 }],
    };
    expect(evaluate(calc, base).score_bp).toBe(7000); // 6000 clamped up to floor 7000
  });
});

describe('zero vs not-rated (acceptance #22)', () => {
  it('an active zero score is a real value that participates', () => {
    const calc: CalculationConfig = { kind: 'native', aggregator: 'mean' };
    const ev = evaluate(calc, [
      { criterion_id: 'a', label: 'A', type: 'scale', scoring_config: scale05, raw: { value: 0 }, weight_milli: 1000 },
      { criterion_id: 'b', label: 'B', type: 'scale', scoring_config: scale05, raw: { value: 5 }, weight_milli: 1000 },
    ]);
    expect(ev.score_bp).toBe(5000); // (0 + 10000)/2 — the zero counted
  });
});
