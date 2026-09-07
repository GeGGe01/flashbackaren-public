// Template-ecosystem hashing + shared constants.
//
// ┌───────────────────────────────────────────────────────────────────────────────────────────────┐
// │ LEGACY V2 — DO NOT USE FOR V3 PUBLICATION.                                                       │
// │ canonicalString / canonicalHash / validateCriteria / VersionCriterion are the SUPERSEDED V2      │
// │ single-hash model. They are retained ONLY because migration 0007's seed-hash test references     │
// │ them. V3 publication uses snapshotHash / logicHash (below) — the dual-hash authoritative path.    │
// │ The authoritative product contract is AI-template-ecosystem-v3.md; AI-template-ecosystem.md's     │
// │ "V2 FROZEN" section is superseded.                                                                │
// └───────────────────────────────────────────────────────────────────────────────────────────────┘

// [V2 LEGACY] One criterion slot (V2 shape). Superseded by the V3 SlotForHash below.
export interface VersionCriterion {
  criterion_id: string;
  label: string;
  position: number;
  weight_default: number; // non-negative real; 0 is allowed (a present-but-unweighted slot)
}

export const MAX_ACTIVE_CRITERIA = 10; // v1/v2 cap (invariant)
export type Tier = 'standard' | 'featured' | 'community';

// Deterministic tier order for discovery: standard → featured → community.
export const TIER_RANK: Record<Tier, number> = { standard: 0, featured: 1, community: 2 };

// Canonical form of a version's criteria set, used for dedup: two versions with the same canonical
// form are the same shape. Order-independent (we sort), so a reordered-but-identical set dedups.
// Sort by position, then criterion_id as a tiebreak; serialize each slot as
// `criterion_id:position:weight`; join with '|'. `Number(w)` normalizes 1 vs 1.0 to one string.
// NOTE: label is deliberately NOT part of the hash — a pure relabel is the same shape, and identity
// is the criterion_id, not the display label.
export function canonicalString(criteria: VersionCriterion[]): string {
  return criteria
    .slice()
    .sort((a, b) => a.position - b.position || a.criterion_id.localeCompare(b.criterion_id))
    .map((c) => `${c.criterion_id}:${c.position}:${Number(c.weight_default)}`)
    .join('|');
}

// sha256 hex of the canonical string. Uses Web Crypto (available in the Workers runtime and Node ≥18).
export async function canonicalHash(criteria: VersionCriterion[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalString(criteria));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Validate a proposed version's criteria set. Returns an error string, or null if OK.
export function validateCriteria(criteria: VersionCriterion[]): string | null {
  if (!Array.isArray(criteria) || criteria.length === 0) return 'at least one criterion required';
  if (criteria.length > MAX_ACTIVE_CRITERIA) return `at most ${MAX_ACTIVE_CRITERIA} criteria`;
  const ids = new Set<string>();
  for (const c of criteria) {
    if (!c.criterion_id || typeof c.criterion_id !== 'string') return 'criterion_id required';
    if (ids.has(c.criterion_id)) return 'duplicate criterion_id in one version';
    ids.add(c.criterion_id);
    if (typeof c.label !== 'string' || !c.label.trim()) return 'label required';
    if (!Number.isFinite(c.weight_default) || c.weight_default < 0) return 'weight must be non-negative';
    if (!Number.isInteger(c.position)) return 'position must be an integer';
  }
  return null;
}

// ---- V3 dual hashing (batch D). Neither hash is used to destructively dedup published history —
// snapshot_hash = exact-duplicate detection; logic_hash = "same scoring model, different presentation".
// Flood control is quotas + discovery behaviour, not deletion of genealogy.

// Deterministic JSON: sort object keys recursively so key-insertion-order never perturbs a hash.
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

async function sha256hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SlotForHash {
  criterion_id: string;
  label: string;
  description?: string | null;
  type: string;
  position: number;
  default_active: boolean;
  default_weight_milli: number;
  scoring_config: unknown;
  presentation_config?: unknown;
}
export interface VersionForHash {
  name: string;
  description?: string | null;
  calculation_config: unknown;
  presentation_config?: unknown;
  criteria: SlotForHash[];
}

const orderSlots = (cs: SlotForHash[]): SlotForHash[] =>
  [...cs].sort((a, b) => a.position - b.position || a.criterion_id.localeCompare(b.criterion_id));

// snapshot_hash: ALL versioned published state (name, description, order, labels, descriptions,
// config/types, weights, calculation config, presentation config).
export async function snapshotHash(v: VersionForHash): Promise<string> {
  return sha256hex(
    stableStringify({
      name: v.name,
      description: v.description ?? '',
      calculation_config: v.calculation_config,
      presentation_config: v.presentation_config ?? {},
      criteria: orderSlots(v.criteria).map((c) => ({
        criterion_id: c.criterion_id,
        label: c.label,
        description: c.description ?? '',
        type: c.type,
        position: c.position,
        default_active: c.default_active,
        default_weight_milli: c.default_weight_milli,
        scoring_config: c.scoring_config,
        presentation_config: c.presentation_config ?? {},
      })),
    }),
  );
}

// logic_hash: score semantics ONLY (scoring config, weights, calculation logic) — excludes cosmetic
// label/description/presentation differences. Same model + different presentation → same logic_hash.
export async function logicHash(v: VersionForHash): Promise<string> {
  return sha256hex(
    stableStringify({
      calculation_config: v.calculation_config,
      criteria: orderSlots(v.criteria).map((c) => ({
        criterion_id: c.criterion_id,
        type: c.type,
        position: c.position,
        default_active: c.default_active,
        default_weight_milli: c.default_weight_milli,
        scoring_config: c.scoring_config,
      })),
    }),
  );
}
