// Server-authoritative scoring pipeline (V3 contract, batches A/B + the A–E.1 hardening):
//   raw input → VALIDATION → normalization to 0..10000 bp → aggregation → modifiers →
//   canonical template score (score_bp) → 0..5 representation.
// Invalid input is REJECTED (never silently coerced to 0). The persisted rating result/receipt
// derives from this module — never from the frontend preview.

export const BP_MAX = 10000; // 10000 bp = 5.00 / 5 stars
export const WEIGHT_MILLI = 1000; // 1.000 in fixed-point milli
// Arbitrary relative weights, but NOT mathematically unbounded: 10 criteria × 10000bp × 1e9 stays
// well under Number.MAX_SAFE_INTEGER, so bp*weight never loses integer precision.
export const MAX_WEIGHT_MILLI = 1_000_000_000;
export const ORDINAL_MAX_OPTIONS = 20;
export const ORDINAL_LABEL_MAX = 48;

export type CriterionType = 'scale' | 'boolean' | 'ordinal' | 'percentage' | 'bipolar';
export type Aggregator = 'weighted_mean' | 'mean' | 'median' | 'minimum' | 'maximum';
export const AGGREGATORS: Aggregator[] = ['weighted_mean', 'mean', 'median', 'minimum', 'maximum'];

export type Valid<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Valid<T> => ({ ok: true, value });
const err = (error: string): Valid<never> => ({ ok: false, error });

export interface ScaleConfig {
  min: number;
  max: number;
  step?: number;
}
export interface BooleanConfig {
  true_bp?: number;
  false_bp?: number;
}
export interface OrdinalOption {
  label: string;
  score_bp: number;
}
export interface OrdinalConfig {
  options: OrdinalOption[];
}
export type ScoringConfig = ScaleConfig | BooleanConfig | OrdinalConfig | Record<string, never>;

export type Modifier =
  | { kind: 'cap'; criterion_id: string; below_bp: number; cap_bp: number }
  | { kind: 'veto'; criterion_id: string; below_bp?: number; equals_raw?: unknown }
  | { kind: 'threshold'; min_bp?: number; max_bp?: number };

export interface CalculationConfig {
  kind: 'native' | 'expression';
  aggregator?: Aggregator;
  modifiers?: Modifier[];
  expression?: string; // reserved; the expression engine is not implemented — evaluate() fails closed
}

const clampBp = (n: number): number => Math.max(0, Math.min(BP_MAX, Math.round(n)));
const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isBp = (n: unknown): n is number => isFiniteNum(n) && n >= 0 && n <= BP_MAX && Number.isInteger(n);

// ---- Config validation + canonicalization (only supported fields survive; P0-5/6). ----
export function validateScoringConfig(type: CriterionType, cfg: unknown): Valid<ScoringConfig> {
  const c = (cfg ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'scale':
    case 'bipolar': {
      const min = Number(c.min);
      const max = Number(c.max);
      if (!isFiniteNum(min) || !isFiniteNum(max)) return err(`${type}: min/max must be finite`);
      if (max <= min) return err(`${type}: max must be > min`);
      const out: ScaleConfig = { min, max };
      if (c.step !== undefined) {
        const step = Number(c.step);
        if (!isFiniteNum(step) || step <= 0) return err(`${type}: step must be > 0`);
        out.step = step;
      }
      return ok(out);
    }
    case 'boolean': {
      const out: BooleanConfig = {};
      if (c.true_bp !== undefined) {
        if (!isBp(c.true_bp)) return err('boolean: true_bp must be an integer 0..10000');
        out.true_bp = c.true_bp as number;
      }
      if (c.false_bp !== undefined) {
        if (!isBp(c.false_bp)) return err('boolean: false_bp must be an integer 0..10000');
        out.false_bp = c.false_bp as number;
      }
      return ok(out);
    }
    case 'ordinal': {
      const options = Array.isArray(c.options) ? (c.options as Record<string, unknown>[]) : null;
      if (!options || options.length === 0) return err('ordinal: options required');
      if (options.length > ORDINAL_MAX_OPTIONS) return err(`ordinal: at most ${ORDINAL_MAX_OPTIONS} options`);
      const labels = new Set<string>();
      const clean: OrdinalOption[] = [];
      for (const o of options) {
        const label = String(o.label ?? '').trim();
        if (!label || label.length > ORDINAL_LABEL_MAX) return err('ordinal: bad option label');
        if (labels.has(label)) return err('ordinal: duplicate option label');
        labels.add(label);
        if (!isBp(o.score_bp)) return err('ordinal: option score_bp must be an integer 0..10000');
        clean.push({ label, score_bp: o.score_bp as number });
      }
      return ok({ options: clean });
    }
    case 'percentage':
      return ok({}); // 0..100, no config
    default:
      return err('unknown criterion type');
  }
}

// ---- Strict raw-value validation for the WRITE path. Returns normalized bp + canonical raw. ----
export function validateRawValue(
  type: CriterionType,
  cfg: ScoringConfig,
  raw: unknown,
): Valid<{ normalized_bp: number; canonical_raw: unknown }> {
  const r = (raw ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'scale':
    case 'bipolar': {
      const c = cfg as ScaleConfig;
      const value = Number(r.value);
      if (!isFiniteNum(value)) return err(`${type}: value must be a finite number`);
      if (value < c.min || value > c.max) return err(`${type}: value out of [${c.min}, ${c.max}]`);
      if (c.step) {
        // Must lie on the configured grid (tolerate float noise).
        const k = (value - c.min) / c.step;
        if (Math.abs(k - Math.round(k)) > 1e-9) return err(`${type}: value not on step grid`);
      }
      return ok({ normalized_bp: clampBp(((value - c.min) / (c.max - c.min)) * BP_MAX), canonical_raw: { value } });
    }
    case 'boolean': {
      const c = cfg as BooleanConfig;
      let v: boolean;
      if (r.value === true || r.value === false) v = r.value as boolean;
      else if (r.value === 'true') v = true;
      else if (r.value === 'false') v = false;
      else return err('boolean: value must be a boolean');
      return ok({ normalized_bp: clampBp(v ? c.true_bp ?? BP_MAX : c.false_bp ?? 0), canonical_raw: { value: v } });
    }
    case 'ordinal': {
      const c = cfg as OrdinalConfig;
      let opt: OrdinalOption | undefined;
      if (r.index !== undefined) {
        const idx = Number(r.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= c.options.length) return err('ordinal: index out of range');
        opt = c.options[idx];
      } else if (typeof r.value === 'string') {
        opt = c.options.find((o) => o.label === r.value);
        if (!opt) return err('ordinal: unknown option label');
      } else {
        return err('ordinal: value (label) or index required');
      }
      return ok({ normalized_bp: clampBp(opt.score_bp), canonical_raw: { value: opt.label } });
    }
    case 'percentage': {
      const value = Number(r.value);
      if (!isFiniteNum(value)) return err('percentage: value must be a finite number');
      if (value < 0 || value > 100) return err('percentage: value out of [0, 100]');
      return ok({ normalized_bp: clampBp(value * 100), canonical_raw: { value } });
    }
    default:
      return err('unknown criterion type');
  }
}

// ---- Lenient normalize for RE-EVALUATION of already-stored canonical data (profile trace). ----
export function normalize(type: CriterionType, cfg: ScoringConfig, raw: any): number {
  switch (type) {
    case 'scale':
    case 'bipolar': {
      const c = cfg as ScaleConfig;
      const value = raw?.value != null ? Number(raw.value) : raw?.halfsteps != null ? Number(raw.halfsteps) / 2 : NaN;
      if (!Number.isFinite(value) || c.max === c.min) return 0;
      return clampBp(((value - c.min) / (c.max - c.min)) * BP_MAX);
    }
    case 'boolean': {
      const c = cfg as BooleanConfig;
      const v = raw?.value === true || raw?.value === 'true' || raw?.value === 1;
      return clampBp(v ? c.true_bp ?? BP_MAX : c.false_bp ?? 0);
    }
    case 'ordinal': {
      const c = cfg as OrdinalConfig;
      const opts = Array.isArray(c.options) ? c.options : [];
      const opt = raw?.index != null ? opts[Number(raw.index)] : opts.find((o) => o.label === raw?.value);
      return opt ? clampBp(opt.score_bp) : 0;
    }
    case 'percentage': {
      const value = Number(raw?.value);
      if (!Number.isFinite(value)) return 0;
      return clampBp(value * 100);
    }
    default:
      return 0;
  }
}

// ---- Calculation-config validation (P0-5). criterionIds = ids present in THIS version. ----
export function validateCalculationConfig(cfg: unknown, criterionIds: Set<string>): Valid<CalculationConfig> {
  const c = (cfg ?? {}) as Record<string, unknown>;
  const kind = c.kind === 'expression' ? 'expression' : 'native';
  if (kind === 'expression') {
    // Schema may carry it, but the engine does not exist — never silently evaluate as weighted_mean.
    return err('expression calculation is not supported yet');
  }
  const aggregator = (c.aggregator ?? 'weighted_mean') as Aggregator;
  if (!AGGREGATORS.includes(aggregator)) return err('unknown aggregator');
  const modsIn = Array.isArray(c.modifiers) ? (c.modifiers as Record<string, unknown>[]) : [];
  const modifiers: Modifier[] = [];
  for (const m of modsIn) {
    if (m.kind === 'threshold') {
      const min_bp = m.min_bp === undefined ? undefined : Number(m.min_bp);
      const max_bp = m.max_bp === undefined ? undefined : Number(m.max_bp);
      if (min_bp !== undefined && !isBp(min_bp)) return err('threshold: min_bp 0..10000');
      if (max_bp !== undefined && !isBp(max_bp)) return err('threshold: max_bp 0..10000');
      if (min_bp !== undefined && max_bp !== undefined && min_bp > max_bp) return err('threshold: min > max');
      modifiers.push({ kind: 'threshold', ...(min_bp !== undefined ? { min_bp } : {}), ...(max_bp !== undefined ? { max_bp } : {}) });
    } else if (m.kind === 'cap') {
      const criterion_id = String(m.criterion_id ?? '');
      if (!criterionIds.has(criterion_id)) return err('cap: criterion_id not in this version');
      if (!isBp(m.below_bp)) return err('cap: below_bp 0..10000');
      if (!isBp(m.cap_bp)) return err('cap: cap_bp 0..10000');
      modifiers.push({ kind: 'cap', criterion_id, below_bp: m.below_bp as number, cap_bp: m.cap_bp as number });
    } else if (m.kind === 'veto') {
      const criterion_id = String(m.criterion_id ?? '');
      if (!criterionIds.has(criterion_id)) return err('veto: criterion_id not in this version');
      const below_bp = m.below_bp === undefined ? undefined : Number(m.below_bp);
      if (below_bp !== undefined && !isBp(below_bp)) return err('veto: below_bp 0..10000');
      if (below_bp === undefined && m.equals_raw === undefined) return err('veto: below_bp or equals_raw required');
      modifiers.push({ kind: 'veto', criterion_id, ...(below_bp !== undefined ? { below_bp } : {}), ...(m.equals_raw !== undefined ? { equals_raw: m.equals_raw } : {}) });
    } else {
      return err(`unknown modifier kind: ${String(m.kind)}`);
    }
  }
  return ok({ kind: 'native', aggregator, modifiers });
}

export function validateWeightMilli(w: unknown): Valid<number> {
  const n = Number(w);
  if (!Number.isInteger(n) || n < 0 || n > MAX_WEIGHT_MILLI) return err('weight_milli must be an integer 0..MAX');
  return ok(n);
}

// ---- Aggregation of the SCORING set (weight==0 already excluded by the caller). ----
export interface AggItem {
  bp: number;
  weight_milli: number;
}
export function aggregate(agg: Aggregator, items: AggItem[]): number {
  if (items.length === 0) return 0;
  const bps = items.map((i) => i.bp);
  switch (agg) {
    case 'weighted_mean': {
      const wsum = items.reduce((s, i) => s + i.weight_milli, 0);
      if (wsum <= 0) return 0;
      return clampBp(items.reduce((s, i) => s + i.bp * i.weight_milli, 0) / wsum);
    }
    case 'mean':
      return clampBp(bps.reduce((s, b) => s + b, 0) / bps.length);
    case 'median': {
      const sorted = [...bps].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return clampBp(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    case 'minimum':
      return clampBp(Math.min(...bps));
    case 'maximum':
      return clampBp(Math.max(...bps));
    default:
      return clampBp(bps.reduce((s, b) => s + b, 0) / bps.length);
  }
}

// ---- Full evaluation: normalize → (exclude weight 0) → aggregate → modifiers → score + trace. ----
export interface EvalInput {
  criterion_id: string;
  label: string;
  type: CriterionType;
  scoring_config: ScoringConfig;
  raw: any;
  weight_milli: number;
}
export interface TraceLine {
  criterion_id: string;
  label: string;
  normalized_bp: number;
  weight_milli: number;
  weight_pct: number;
  contribution_bp: number;
  included_in_score: boolean; // false for weight==0 descriptive criteria
}
export interface ModifierTrace {
  kind: string;
  applied: boolean;
  detail: string;
}
export interface Evaluation {
  score_bp: number;
  base_bp: number;
  aggregator: Aggregator;
  scoring_count: number; // criteria that actually entered the score (weight > 0)
  lines: TraceLine[];
  modifiers: ModifierTrace[];
  error?: string;
}

export function evaluate(calc: CalculationConfig, inputs: EvalInput[]): Evaluation {
  const empty = (error: string): Evaluation => ({
    score_bp: 0,
    base_bp: 0,
    aggregator: (calc.aggregator ?? 'weighted_mean') as Aggregator,
    scoring_count: 0,
    lines: [],
    modifiers: [],
    error,
  });
  // Fail closed: never evaluate an expression template as if it were a weighted mean.
  if (calc.kind === 'expression') return empty('expression calculation is not supported yet');

  const aggregator: Aggregator = calc.aggregator ?? 'weighted_mean';
  const norm = inputs.map((i) => ({ i, bp: normalize(i.type, i.scoring_config, i.raw) }));
  // SCORING set excludes weight==0 (descriptive-only) criteria — for ALL aggregators.
  const scoring = norm.filter((n) => n.i.weight_milli > 0);
  if (scoring.length === 0) return empty('no scoring criteria (all weights are zero)');
  const wsum = scoring.reduce((s, n) => s + n.i.weight_milli, 0);
  const base_bp = aggregate(aggregator, scoring.map((n) => ({ bp: n.bp, weight_milli: n.i.weight_milli })));

  const lines: TraceLine[] = norm.map((n) => {
    const included = n.i.weight_milli > 0;
    const weight_pct = included && wsum > 0 ? (n.i.weight_milli / wsum) * 100 : 0;
    return {
      criterion_id: n.i.criterion_id,
      label: n.i.label,
      normalized_bp: n.bp,
      weight_milli: n.i.weight_milli,
      weight_pct: Math.round(weight_pct * 100) / 100,
      contribution_bp: included && aggregator === 'weighted_mean' && wsum > 0 ? Math.round(n.bp * (n.i.weight_milli / wsum)) : 0,
      included_in_score: included,
    };
  });

  const byId = new Map(scoring.map((n) => [n.i.criterion_id, { bp: n.bp, raw: n.i.raw }]));
  let score_bp = base_bp;
  const modifiers: ModifierTrace[] = [];
  for (const m of calc.modifiers ?? []) {
    if (m.kind === 'cap') {
      const c = byId.get(m.criterion_id);
      const hit = !!c && c.bp < m.below_bp;
      if (hit) score_bp = Math.min(score_bp, m.cap_bp);
      modifiers.push({ kind: 'cap', applied: hit, detail: `if ${m.criterion_id} < ${m.below_bp}bp → cap ${m.cap_bp}bp` });
    } else if (m.kind === 'veto') {
      const c = byId.get(m.criterion_id);
      const hit =
        !!c &&
        ((m.below_bp != null && c.bp < m.below_bp) ||
          (m.equals_raw !== undefined && JSON.stringify((c.raw as Record<string, unknown>)?.value) === JSON.stringify(m.equals_raw)));
      if (hit) score_bp = 0;
      modifiers.push({ kind: 'veto', applied: hit, detail: `veto on ${m.criterion_id}` });
    } else if (m.kind === 'threshold') {
      const lo = m.min_bp ?? 0;
      const hi = m.max_bp ?? BP_MAX;
      const before = score_bp;
      score_bp = Math.max(lo, Math.min(hi, score_bp));
      modifiers.push({ kind: 'threshold', applied: score_bp !== before, detail: `clamp to [${lo}, ${hi}]bp` });
    }
  }
  return { score_bp: clampBp(score_bp), base_bp, aggregator, scoring_count: scoring.length, lines, modifiers };
}

// ---- Presentation config sanitization (P0-6): only known keys/values survive. ----
const RESULT_PRES = ['stars', 'numeric', 'percentage', 'grade', 'symbol'];
const DETAIL_PRES = ['bars', 'radar', 'scorecard', 'bipolar'];
export function sanitizePresentationConfig(cfg: unknown): { result: string; detail: string } {
  const c = (cfg ?? {}) as Record<string, unknown>;
  const result = RESULT_PRES.includes(String(c.result)) ? String(c.result) : 'stars';
  const detail = DETAIL_PRES.includes(String(c.detail)) ? String(c.detail) : 'bars';
  return { result, detail };
}

// ---- Display helpers. ----
export const bpToStars = (bp: number): number => bp / (BP_MAX / 5);
export const milliToWeight = (m: number): number => m / 1000;
export const weightToMilli = (w: number): number => Math.round(w * 1000);
