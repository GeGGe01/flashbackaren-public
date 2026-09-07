// Template-ecosystem V2 domain helpers (see features/template-ecosystem/AI-template-ecosystem.md,
// "V2 domain model — FROZEN"). The load-bearing rule: template IDENTITY ≠ template VERSION. A
// template is a *work*; a version is an *immutable* snapshot. Ratings and forks bind to a VERSION,
// never to the mutable work, so genealogy can't start lying as a work keeps evolving.

// One criterion slot on a specific template version: which stable criterion, at what position,
// with what default weight. `label` lives here (per version), NOT on the criterion — so renaming a
// label is a new version's join row with the SAME criterion_id (criterion identity survives).
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
