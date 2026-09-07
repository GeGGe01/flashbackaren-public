// Server-authoritative scoring pipeline (V3 contract, batches A-normalization + B-engine):
//   raw criterion input → validation → normalization to 0..10000 bp → aggregation → modifiers →
//   canonical template score (score_bp) → 0..5 representation.
// The persisted rating result/receipt derives from evaluate() here — never from the frontend preview.

export const BP_MAX = 10000; // 10000 bp = 5.00 / 5 stars
export const WEIGHT_MILLI = 1000; // 1.000 in fixed-point milli

export type CriterionType = 'scale' | 'boolean' | 'ordinal' | 'percentage' | 'bipolar';
export type Aggregator = 'weighted_mean' | 'mean' | 'median' | 'minimum' | 'maximum';

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
export interface BipolarConfig {
  min: number;
  max: number;
  left?: string;
  right?: string;
}
export type ScoringConfig = ScaleConfig | BooleanConfig | OrdinalConfig | BipolarConfig | Record<string, never>;

// A modifier adjusts the aggregated score. Only the exemplified `cap`/`veto` carry criterion
// conditions; `threshold` is a global clamp (a template-wide floor/ceiling). Anything richer belongs
// to the (deferred) expression engine — see the V3 contract's open questions.
export type Modifier =
  | { kind: 'cap'; criterion_id: string; below_bp: number; cap_bp: number }
  | { kind: 'veto'; criterion_id: string; below_bp?: number; equals_raw?: unknown }
  | { kind: 'threshold'; min_bp?: number; max_bp?: number };

export interface CalculationConfig {
  kind: 'native' | 'expression';
  aggregator?: Aggregator;
  modifiers?: Modifier[];
  expression?: string; // reserved; expression engine not implemented in this batch
}

const clampBp = (n: number): number => Math.max(0, Math.min(BP_MAX, Math.round(n)));

// --- Normalization: raw typed input → 0..10000 bp. Raw is the stored `raw_value_json` object.
export function normalize(type: CriterionType, cfg: ScoringConfig, raw: any): number {
  switch (type) {
    case 'scale':
    case 'bipolar': {
      const c = cfg as ScaleConfig;
      // Accept {value} (canonical) or legacy {halfsteps} (0..10 → 0..5 on a 0..5 scale).
      const value =
        raw?.value != null ? Number(raw.value) : raw?.halfsteps != null ? Number(raw.halfsteps) / 2 : NaN;
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
      // raw may carry {value: label} or {index: n}.
      const opt =
        raw?.index != null ? opts[Number(raw.index)] : opts.find((o) => o.label === raw?.value);
      return opt ? clampBp(opt.score_bp) : 0;
    }
    case 'percentage': {
      const value = Number(raw?.value);
      if (!Number.isFinite(value)) return 0;
      return clampBp(value * 100); // 0..100 → 0..10000
    }
    default:
      return 0;
  }
}

// --- Aggregation of active criteria (each already normalized to bp, with a milli weight).
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

// --- The full evaluation: normalize → aggregate → modifiers → { score_bp, trace }.
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
  weight_pct: number; // for display; relative to the active set
  contribution_bp: number; // weighted_mean contribution; 0 for non-weighted aggregators
}
export interface ModifierTrace {
  kind: string;
  applied: boolean;
  detail: string;
}
export interface Evaluation {
  score_bp: number;
  base_bp: number; // aggregate before modifiers
  aggregator: Aggregator;
  lines: TraceLine[];
  modifiers: ModifierTrace[];
}

export function evaluate(calc: CalculationConfig, inputs: EvalInput[]): Evaluation {
  const aggregator: Aggregator = calc.aggregator ?? 'weighted_mean';
  const norm = inputs.map((i) => ({ i, bp: normalize(i.type, i.scoring_config, i.raw) }));
  const wsum = norm.reduce((s, n) => s + n.i.weight_milli, 0);
  const base_bp = aggregate(
    aggregator,
    norm.map((n) => ({ bp: n.bp, weight_milli: n.i.weight_milli })),
  );
  const lines: TraceLine[] = norm.map((n) => {
    const weight_pct = wsum > 0 ? (n.i.weight_milli / wsum) * 100 : 0;
    return {
      criterion_id: n.i.criterion_id,
      label: n.i.label,
      normalized_bp: n.bp,
      weight_milli: n.i.weight_milli,
      weight_pct: Math.round(weight_pct * 100) / 100,
      contribution_bp:
        aggregator === 'weighted_mean' && wsum > 0
          ? Math.round(n.bp * (n.i.weight_milli / wsum))
          : 0,
    };
  });

  const byId = new Map(norm.map((n) => [n.i.criterion_id, { bp: n.bp, raw: n.i.raw }]));
  let score_bp = base_bp;
  const modifiers: ModifierTrace[] = [];
  for (const m of calc.modifiers ?? []) {
    if (m.kind === 'cap') {
      const c = byId.get(m.criterion_id);
      const hit = !!c && c.bp < m.below_bp;
      if (hit) score_bp = Math.min(score_bp, m.cap_bp);
      modifiers.push({
        kind: 'cap',
        applied: hit,
        detail: `if ${m.criterion_id} < ${m.below_bp}bp → cap ${m.cap_bp}bp`,
      });
    } else if (m.kind === 'veto') {
      const c = byId.get(m.criterion_id);
      const hit =
        !!c &&
        ((m.below_bp != null && c.bp < m.below_bp) ||
          (m.equals_raw !== undefined && JSON.stringify(c.raw?.value) === JSON.stringify(m.equals_raw)));
      if (hit) score_bp = 0;
      modifiers.push({ kind: 'veto', applied: hit, detail: `veto on ${m.criterion_id}` });
    } else if (m.kind === 'threshold') {
      const lo = m.min_bp ?? 0;
      const hi = m.max_bp ?? BP_MAX;
      const before = score_bp;
      score_bp = Math.max(lo, Math.min(hi, score_bp));
      modifiers.push({
        kind: 'threshold',
        applied: score_bp !== before,
        detail: `clamp to [${lo}, ${hi}]bp`,
      });
    }
  }
  return { score_bp: clampBp(score_bp), base_bp, aggregator, lines, modifiers };
}

// --- Display helpers.
export const bpToStars = (bp: number): number => bp / (BP_MAX / 5); // 0..10000 → 0.00..5.00
export const milliToWeight = (m: number): number => m / 1000;
export const weightToMilli = (w: number): number => Math.round(w * 1000);
