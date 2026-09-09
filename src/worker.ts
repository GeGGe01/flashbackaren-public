// Flashbackaren — v1-core see-and-feel slice.
// The irreducible loop: find a member -> rate them (direct 0-5, half-star) -> see the aggregate.
// Deliberately trivial to game (no anti-abuse hardening) — the point of the first surface is to
// feel the reputation model with honest users, not to resist abuse.

// All Flashback bytes cross exactly one boundary — the FlashbackNormalizer — which yields canonical
// UTF-8 + source metadata. Nothing below decodes upstream bytes itself; parsers assume UTF-8.
import { fetchFlashback, normalizeBytes } from './flashback';
import {
  snapshotHash,
  logicHash,
  MAX_ACTIVE_CRITERIA,
  TIER_RANK,
  type SlotForHash,
  type Tier,
} from './template';
import {
  evaluate,
  bpToStars,
  BP_MAX,
  validateScoringConfig,
  validateRawValue,
  validateCalculationConfig,
  validateWeightMilli,
  sanitizePresentationConfig,
  isRecord,
  type CriterionType,
  type ScoringConfig,
  type CalculationConfig,
  type EvalInput,
  type Valid,
} from './scoring';

// Minimal local shapes so the worker needs no @cloudflare/workers-types dependency.
interface D1Result<T = Record<string, unknown>> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>; // atomic multi-statement write
}
interface Env {
  DB: D1Database;
  ADMIN_SECRET?: string; // server-side secret gating the preseed/import endpoints (wrangler secret / .dev.vars)
  // HMAC key for the fb_meta identity cookie — proves the browser owns the meta id it presents, so the
  // (publicly visible) author_identity_id can't be forged into an owner. DEDICATED, not ADMIN_SECRET.
  META_SIGNING_SECRET?: string;
  // Mount prefix when served under a path route (e.g. "/flashbackaren" for typ.gegge.se/flashbackaren).
  // Empty/unset = mounted at the host root (workers.dev, a dedicated subdomain, local dev).
  BASE_PATH?: string;
}

// Normalize the mount prefix: trim a trailing slash so "/flashbackaren/" and "/flashbackaren" behave
// the same, and treat "/" as root (no prefix). Everything downstream routes on the base-relative path.
export function normalizeBase(raw: string | undefined): string {
  const b = (raw ?? '').trim().replace(/\/+$/, '');
  return b === '/' ? '' : b;
}

// Map an incoming pathname to its base-relative route. Only strips when the base is followed by "/"
// or ends the path — so "/flashbackaren-evil" is NOT treated as living under "/flashbackaren".
export function mountRelativePath(base: string, pathname: string): string {
  if (base && (pathname === base || pathname.startsWith(base + '/'))) {
    return pathname.slice(base.length) || '/';
  }
  return pathname;
}

const COOKIE = 'fb_meta';
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
// One place to upsert a member. Partial facts don't clobber existing ones (COALESCE), so a
// moderators-page hit (no posts) won't wipe a post count learned from the memberlist, etc.
async function upsertMember(
  env: Env,
  m: { uid: string; username: string; regDate?: string | null; posts?: number | null; sourceUrl?: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO members (uid, username, first_seen, last_seen, reg_date, posts, source_url)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)
     ON CONFLICT (uid) DO UPDATE SET
       username   = excluded.username,
       last_seen  = excluded.last_seen,
       reg_date   = COALESCE(excluded.reg_date, members.reg_date),
       posts      = COALESCE(excluded.posts, members.posts),
       source_url = COALESCE(excluded.source_url, members.source_url)`,
  )
    .bind(m.uid, m.username, now, m.regDate ?? null, m.posts ?? null, m.sourceUrl ?? null)
    .run();
}

// Resolve an exact username via Flashback's PUBLIC member search: sok/?query=p:<name> 302-redirects
// to the profile /uNNN on an exact match. Bytes cross the normalizer; we parse UTF-8 facts only.
// Distinguishes NOT_FOUND (no exact match) from ERROR (upstream/rate-limit/parse failure) internally,
// so an error is never cached as a miss; the external API response stays minimal regardless.
type MemberRow = { uid: string; username: string; avg_bp: number | null; cnt: number };
type ResolveResult = { status: 'found'; member: MemberRow } | { status: 'not_found' } | { status: 'error' };
async function resolveMemberUpstream(q: string, env: Env): Promise<ResolveResult> {
  let search;
  try {
    search = await fetchFlashback(
      'https://www.flashback.org/sok/?query=' + encodeURIComponent('p:' + q),
      { redirect: 'manual' },
    );
  } catch {
    return { status: 'error' };
  }
  const um = (search.location ?? '').match(/\/u(\d+)/);
  if (!um) return { status: 'not_found' }; // no exact-match redirect = genuinely not found
  const uid = um[1];
  try {
    const profileUrl = 'https://www.flashback.org/u' + uid;
    const profile = await fetchFlashback(profileUrl);
    const tm = profile.html.match(/Visa profil:\s*([^<]+)</);
    const username = (tm ? decodeEntities(tm[1]) : q).trim();
    if (!username) return { status: 'error' }; // redirected to a profile we couldn't parse
    // Reg date is in the static profile HTML; post count is public but JS-rendered (not here).
    const rm = profile.html.match(/Reg:\s*<strong>(\d{4}-\d{2}-\d{2})<\/strong>/);
    await upsertMember(env, { uid, username, regDate: rm ? rm[1] : null, sourceUrl: profileUrl });
    return { status: 'found', member: { uid, username, avg_bp: null, cnt: 0 } };
  } catch {
    return { status: 'error' };
  }
}

// fb_meta is a SIGNED cookie: `<meta_id>.<hmac>`. The meta_id is a public identifier (it shows up as
// author_identity_id); the HMAC — over the id with META_SIGNING_SECRET — is the proof that this
// browser owns it. Ownership/author checks therefore can't be passed by simply presenting someone
// else's public id. HttpOnly/Secure/SameSite as before.
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The cookie VALUE for a meta id. Without a signing secret we can't sign — the returned value won't
// verify on the next request (→ a fresh ephemeral identity each time), which is safe (no forgery) but
// loses persistent ownership; production must set META_SIGNING_SECRET.
async function signMetaCookie(env: Env, metaId: string): Promise<string> {
  if (!env.META_SIGNING_SECRET) return metaId;
  return `${metaId}.${await hmacHex(env.META_SIGNING_SECRET, metaId)}`;
}

// Return the meta id ONLY when the cookie carries a valid signature. Unsigned/tampered/missing → null.
async function readMeta(request: Request, env: Env): Promise<string | null> {
  const raw = request.headers.get('Cookie') ?? '';
  const m = raw.match(/(?:^|;\s*)fb_meta=([^;]+)/);
  if (!m) return null;
  const cookie = decodeURIComponent(m[1]);
  const dot = cookie.lastIndexOf('.');
  if (dot <= 0) return null; // unsigned prototype cookie → not authenticated (rotate to a signed one)
  const id = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  if (!env.META_SIGNING_SECRET) return null; // can't verify → don't trust
  const expected = await hmacHex(env.META_SIGNING_SECRET, id);
  return timingSafeEqual(sig, expected) ? id : null;
}

function json(body: unknown, extraHeaders?: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
  });
}

// The preseed/import endpoints write to D1 (the memberlist import can inject arbitrary member facts),
// so they must never be publicly writable: require a server-side secret via constant-time compare.
// Deny outright if ADMIN_SECRET isn't configured (fail closed).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function isAdmin(request: Request, env: Env): boolean {
  const provided = request.headers.get('X-Admin-Secret');
  return !!env.ADMIN_SECRET && !!provided && timingSafeEqual(provided, env.ADMIN_SECRET);
}
function forbidden(extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
  });
}

// stars = half-steps / 2, rounded to one decimal for display.
function toStars(avgHalfsteps: number | null): number | null {
  return avgHalfsteps == null ? null : Math.round((avgHalfsteps / 2) * 10) / 10;
}

// Activity: posts per day = posts / account age in days. Separate from quality — it only ever adds
// a small bump (0.1·P) on top of the community rating B, capped at 5 (Q1). Null when we lack posts/reg.
function postsPerDay(posts: number | null | undefined, regDate: string | null | undefined): number | null {
  if (posts == null || !regDate) return null;
  const days = Math.max(1, Math.floor((Date.now() - Date.parse(regDate)) / 86400000));
  return posts / days;
}
const ACTIVITY_WEIGHT = 0.1; // the 0.1 in R = min(5, B + 0.1·P); operator-tunable (Q1)
const r1 = (n: number) => Math.round(n * 10) / 10;

const COMMENT_MAX_CHARS = 420;
const COMMENT_MAX_WORDS = 88;
// Normalise an optional free-text review: null when empty, the trimmed text when valid, or false
// when it breaks a hard limit (≤420 chars AND ≤88 words).
export function cleanComment(raw: unknown): string | null | false {
  if (raw == null) return null;
  if (typeof raw !== 'string') return false; // wrong type is an invalid request, not "[object Object]"
  const s = raw.trim();
  if (s === '') return null;
  if (s.length > COMMENT_MAX_CHARS) return false;
  if (s.split(/\s+/).filter(Boolean).length > COMMENT_MAX_WORDS) return false;
  return s;
}

// Strict string extraction for untrusted API JSON — TYPE first, never String() coercion (A–E.3).
// Absent (undefined/null) → null unless required. Wrong type → error. Trims unless trim:false.
export function vString(
  v: unknown,
  opts: { required?: boolean; max?: number; trim?: boolean } = {},
): Valid<string | null> {
  if (v === undefined || v === null) return opts.required ? { ok: false, error: 'required' } : { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: 'must be a string' };
  const s = opts.trim === false ? v : v.trim();
  if (opts.required && s.length === 0) return { ok: false, error: 'required' };
  if (opts.max !== undefined && s.length > opts.max) return { ok: false, error: 'too long' };
  return { ok: true, value: s };
}

// Flashback serves ISO-8859-1; decode a small set of HTML entities left in usernames.
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aring: 'å', auml: 'ä', ouml: 'ö', Aring: 'Å', Auml: 'Ä', Ouml: 'Ö', eacute: 'é',
  };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => named[name] ?? whole);
}

// ---- V3 template helpers (shared by the read + rate endpoints) ----
// Publication limits (batch E). Configurable constants so they can be loosened later.
const LIMITS = {
  name: 60,
  description: 280,
  criterionLabel: 48,
  criterionDescription: 160,
  templatesPerIdentity: 10,
  publishesPer24h: 3,
  versionsPerTemplate: 25,
} as const;
const CRITERION_TYPES = ['scale', 'boolean', 'ordinal', 'percentage', 'bipolar'];

// Publish rate limit (batch E flood control): count versions this identity published in the last 24h.
async function recentPublishesExceeded(env: Env, author: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM template_version tv JOIN template t ON t.id = tv.template_id
       WHERE t.author_identity_id = ?1 AND tv.published_at >= ?2`,
  )
    .bind(author, cutoff)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= LIMITS.publishesPer24h;
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

interface LoadedCriterion {
  id: string;
  label: string;
  description: string | null;
  type: CriterionType;
  position: number;
  default_active: boolean;
  default_weight_milli: number;
  scoring_config: ScoringConfig;
  presentation_config: Record<string, unknown>;
}
interface LoadedVersion {
  version_id: string;
  template_id: string;
  name: string;
  description: string | null;
  tier: Tier;
  template_status: string;
  author_identity_id: string;
  version_no: number;
  parent_version_id: string | null;
  published_at: string;
  snapshot_hash: string | null;
  logic_hash: string | null;
  calculation_config: CalculationConfig;
  presentation_config: Record<string, unknown>;
  criteria: LoadedCriterion[];
}

const VERSION_COLS = `tv.id AS version_id, tv.template_id, tv.name, tv.description, tv.version_no,
  tv.parent_version_id, tv.published_at, tv.snapshot_hash, tv.logic_hash,
  tv.calculation_config, tv.presentation_config, t.tier, t.status AS template_status,
  t.author_identity_id`;

// Load a template VERSION (default = the current Standard version) with its typed criteria + configs.
// Archived/hidden versions still LOAD (historical reads must stay reproducible) — callers that WRITE
// new ratings enforce template_status === 'active' themselves (P0-3).
async function loadVersion(env: Env, versionId: string | null): Promise<LoadedVersion | null> {
  const row = versionId
    ? await env.DB.prepare(
        `SELECT ${VERSION_COLS} FROM template_version tv JOIN template t ON t.id = tv.template_id WHERE tv.id = ?1`,
      )
        .bind(versionId)
        .first<Record<string, string>>()
    : await env.DB.prepare(
        `SELECT ${VERSION_COLS} FROM template t JOIN template_version tv ON tv.id = t.current_version_id
          WHERE t.tier = 'standard' AND t.status = 'active'
          ORDER BY tv.published_at DESC LIMIT 1`,
      ).first<Record<string, string>>();
  if (!row) return null;
  const crit = await env.DB.prepare(
    `SELECT criterion_id AS id, label, description, type, position, default_active,
            default_weight_milli, scoring_config, presentation_config
       FROM template_criterion WHERE template_version_id = ?1 ORDER BY position`,
  )
    .bind(row.version_id)
    .all<Record<string, unknown>>();
  return {
    version_id: row.version_id,
    template_id: row.template_id,
    name: row.name,
    description: row.description ?? null,
    tier: row.tier as Tier,
    template_status: row.template_status,
    author_identity_id: row.author_identity_id,
    version_no: Number(row.version_no),
    parent_version_id: (row.parent_version_id as string | null) ?? null,
    published_at: row.published_at,
    snapshot_hash: (row.snapshot_hash as string | null) ?? null,
    logic_hash: (row.logic_hash as string | null) ?? null,
    calculation_config: parseJson<CalculationConfig>(row.calculation_config, {
      kind: 'native',
      aggregator: 'weighted_mean',
      modifiers: [],
    }),
    presentation_config: parseJson(row.presentation_config, {}),
    criteria: crit.results.map((c) => ({
      id: c.id as string,
      label: c.label as string,
      description: (c.description as string) ?? null,
      type: c.type as CriterionType,
      position: c.position as number,
      default_active: !!c.default_active,
      default_weight_milli: c.default_weight_milli as number,
      scoring_config: parseJson(c.scoring_config as string, {} as ScoringConfig),
      presentation_config: parseJson(c.presentation_config as string, {}),
    })),
  };
}

interface SlotInput {
  criterion_id?: string;
  label?: string;
  description?: string;
  type?: string;
  position?: number;
  default_active?: boolean;
  default_weight_milli?: number;
  scoring_config?: unknown;
  presentation_config?: unknown;
}
type SlotParse = { ok: true; slots: SlotForHash[]; newCriterionIds: string[] } | { ok: false; why: string };

// Build validated criterion slots for a create/revise/fork. Reused criterion ids MUST exist in
// `lineageIds` (the source/previous version's criteria) — the client can't spoof arbitrary lineage;
// blank ids mint a new server-owned criterion id.
function parseSlots(input: SlotInput[], lineageIds: Set<string>): SlotParse {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_ACTIVE_CRITERIA) {
    return { ok: false, why: 'criteria count' };
  }
  const newCriterionIds: string[] = [];
  const slots: SlotForHash[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!isRecord(c)) return { ok: false, why: 'each criterion must be an object' }; // reject [null] etc.
    // criterion_id: absent (mint a new one) or a non-empty string (reused lineage). Never coerced.
    const cidField = vString(c.criterion_id, {});
    if (!cidField.ok) return { ok: false, why: 'criterion_id must be a string' };
    let cid = cidField.value ?? '';
    if (cid) {
      if (!lineageIds.has(cid)) return { ok: false, why: 'criterion_id not in source lineage' };
    } else {
      cid = 'crit-' + crypto.randomUUID();
      newCriterionIds.push(cid);
    }
    if (seen.has(cid)) return { ok: false, why: 'duplicate criterion' };
    seen.add(cid);
    const labelField = vString(c.label, { required: true, max: LIMITS.criterionLabel });
    if (!labelField.ok) return { ok: false, why: 'label' };
    const label = labelField.value as string;
    // Strict: reject a non-string / overlong description (never silently coerce or slice).
    const descField = vString(c.description, { max: LIMITS.criterionDescription, trim: false });
    if (!descField.ok) return { ok: false, why: 'criterion description' };
    const description = descField.value;
    if (c.type !== undefined && typeof c.type !== 'string') return { ok: false, why: 'type must be a string' };
    const type = (c.type as string | undefined) ?? 'scale';
    if (!CRITERION_TYPES.includes(type)) return { ok: false, why: 'type' };
    const wv = validateWeightMilli(c.default_weight_milli ?? 1000);
    if (!wv.ok) return { ok: false, why: 'weight' };
    // Validate + canonicalize the scoring_config for this type (no arbitrary JSON persisted).
    const scfg = validateScoringConfig(type as CriterionType, c.scoring_config ?? (type === 'scale' || type === 'bipolar' ? { min: 0, max: 5, step: 0.5 } : {}));
    if (!scfg.ok) return { ok: false, why: `scoring_config: ${scfg.error}` };
    // default_active: boolean only (reject "false" the string etc.); defaults true when omitted.
    if (c.default_active !== undefined && typeof c.default_active !== 'boolean') return { ok: false, why: 'default_active must be a boolean' };
    slots.push({
      criterion_id: cid,
      label,
      description: description || null,
      type,
      position: i + 1,
      default_active: c.default_active === undefined ? true : c.default_active,
      default_weight_milli: wv.value,
      scoring_config: scfg.value,
      // Per-criterion presentation config: server default only until F's schema is finalized (P0-6).
      presentation_config: {},
    });
  }
  return { ok: true, slots, newCriterionIds };
}

// The statements that persist one published version's criteria (new criterion rows + slot joins).
function slotWrites(env: Env, versionId: string, slots: SlotForHash[], newCriterionIds: string[], nowIso: string): D1PreparedStatement[] {
  return [
    ...newCriterionIds.map((cid) =>
      env.DB.prepare(`INSERT INTO criterion (id, created_at) VALUES (?1, ?2)`).bind(cid, nowIso),
    ),
    ...slots.map((s) =>
      env.DB.prepare(
        // weight_default is a 0007 vestigial NOT NULL column (no default) — mirrors milli/1000.
        `INSERT INTO template_criterion
           (template_version_id, criterion_id, label, description, type, position, default_active,
            default_weight_milli, scoring_config, presentation_config, weight_default)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).bind(
        versionId,
        s.criterion_id,
        s.label,
        s.description,
        s.type,
        s.position,
        s.default_active ? 1 : 0,
        s.default_weight_milli,
        JSON.stringify(s.scoring_config),
        JSON.stringify(s.presentation_config),
        s.default_weight_milli / 1000,
      ),
    ),
  ];
}

// Resolve a version's calculation + presentation config with the contract's inherit semantics
// (P0-4): explicitly supplied → validate + store; omitted → inherit from `inheritFrom` (fork source /
// current version) or fall back to defaults for a fresh root. calculation_config is validated against
// THIS version's criterion ids (P0-5); presentation_config is sanitized to known keys (P0-6).
const DEFAULT_CALC: CalculationConfig = { kind: 'native', aggregator: 'weighted_mean', modifiers: [] };
function resolveConfigs(
  body: { calculation_config?: unknown; presentation_config?: unknown },
  inheritFrom: { calculation_config: CalculationConfig; presentation_config: Record<string, unknown> } | null,
  criterionIds: Set<string>,
): Valid<{ calc: CalculationConfig; pres: { result: string; detail: string } }> {
  let calc: CalculationConfig;
  if (body.calculation_config !== undefined) {
    const v = validateCalculationConfig(body.calculation_config, criterionIds);
    if (!v.ok) return { ok: false, error: v.error };
    calc = v.value;
  } else if (inheritFrom) {
    // Inherit — but the criterion set may have shifted; re-validate so a dropped criterion referenced
    // by a modifier is caught rather than silently mis-scoring.
    const v = validateCalculationConfig(inheritFrom.calculation_config, criterionIds);
    if (!v.ok) return { ok: false, error: `inherited calculation_config invalid: ${v.error} — supply calculation_config` };
    calc = v.value;
  } else {
    calc = DEFAULT_CALC;
  }
  const presSource = body.presentation_config !== undefined ? body.presentation_config : inheritFrom?.presentation_config;
  return { ok: true, value: { calc, pres: sanitizePresentationConfig(presSource) } };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Base-path support: a Workers Route like `typ.gegge.se/flashbackaren*` delivers requests with the
    // full pathname (CF does NOT strip the route prefix), so strip it here and route on the remainder.
    // The front end fetches against the same base (injected into the HTML below), so both sides agree.
    const base = normalizeBase(env.BASE_PATH);
    const path = mountRelativePath(base, url.pathname);

    // Resolve the browser-owned meta identity; mint one on first contact. This is only an
    // OWNERSHIP key (one browser = one current rating per member), not a person and not hardened.
    let meta = await readMeta(request, env);
    let setCookie: Record<string, string> | undefined;
    if (!meta) {
      meta = crypto.randomUUID();
      const cookieVal = await signMetaCookie(env, meta); // `<id>.<hmac>` — the proof-of-ownership
      // Secure over HTTPS (production / workers.dev); omitted on local http dev so the cookie still sets.
      const secure = url.protocol === 'https:' ? '; Secure' : '';
      // Scope the cookie to the mount prefix so it doesn't leak to sibling paths on a shared host.
      const cookiePath = base || '/';
      setCookie = {
        'Set-Cookie': `${COOKIE}=${cookieVal}; Path=${cookiePath}; Max-Age=${TEN_YEARS}; SameSite=Lax; HttpOnly${secure}`,
      };
    }

    try {
      // --- Find: search the local member index by username (cache-first; upstream lookup deferred).
      if (path === '/api/members' && request.method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim();
        const rows = await env.DB.prepare(
          `SELECT m.uid, m.username,
                  AVG(r.score_bp) AS avg_bp,
                  COUNT(r.score_bp) AS cnt
             FROM members m
             LEFT JOIN ratings r ON r.target_uid = m.uid
            WHERE m.username LIKE ?1
            GROUP BY m.uid
            ORDER BY m.username
            LIMIT 25`,
        )
          .bind(`%${q}%`)
          .all<{ uid: string; username: string; avg_bp: number | null; cnt: number }>();
        let list = rows.results;
        // Cache-first: on a genuine miss, resolve one exact username upstream (public search) and cache it.
        // Username is OPAQUE upstream data (legacy names break any allowlist), so we only bound length
        // and reject control chars; the query is URL-encoded in resolveMemberUpstream.
        if (list.length === 0 && q.length >= 2 && q.length <= 60 && !/[\x00-\x1f\x7f]/.test(q)) {
          const res = await resolveMemberUpstream(q, env);
          if (res.status === 'found') list = [res.member];
        }
        return json(
          list.map((m) => ({
            uid: m.uid,
            username: m.username,
            stars: m.avg_bp == null ? null : r1(bpToStars(m.avg_bp)),
            count: m.cnt ?? 0,
          })),
          setCookie,
        );
      }

      // --- The default rating template VERSION (its criteria) for the rich rating UI. The `id`
      // returned is a template_version id — ratings bind to the version, so this is what /api/rate
      // expects back as `template_version_id`. v1 default: the Standard template's latest version.
      if (path === '/api/template' && request.method === 'GET') {
        const wanted = (url.searchParams.get('version') ?? '').trim();
        const ver = await loadVersion(env, wanted || null);
        if (!ver) return json({ error: 'no_template' }, setCookie);
        // `id` mirrors version_id so both the V3 clients and the current front (which sends `id`
        // back as template_version_id) work during the transition to the F frontend.
        return json({ id: ver.version_id, ...ver }, setCookie);
      }

      // --- Discovery: all templates (latest version each) with tier + stats, deterministically
      // ordered Standard → Featured → Community, then uses desc, forks desc, published_at. Community
      // junk never dominates; standard/featured (operator-curated) float to the top.
      if (path === '/api/templates' && request.method === 'GET') {
        // The current version of every ACTIVE template (archived/hidden drop out of discovery).
        const latest = await env.DB.prepare(
          `SELECT t.id AS template_id, t.tier, t.author_identity_id AS author_identity,
                  tv.id AS version_id, tv.version_no, tv.name, tv.published_at, tv.calculation_config,
                  (SELECT COUNT(*) FROM template_criterion tc WHERE tc.template_version_id = tv.id) AS criteria_count
             FROM template t
             JOIN template_version tv ON tv.id = t.current_version_id
            WHERE t.status = 'active'`,
        ).all<{
          template_id: string;
          tier: Tier;
          author_identity: string;
          version_id: string;
          version_no: number;
          name: string;
          published_at: string;
          calculation_config: string;
          criteria_count: number;
        }>();
        // uses = ratings bound to any version of the template; forks = other templates whose v1
        // was derived from a version of this template.
        const usesRows = await env.DB.prepare(
          `SELECT tv.template_id AS tid, COUNT(*) AS uses
             FROM ratings r JOIN template_version tv ON tv.id = r.template_version_id
            GROUP BY tv.template_id`,
        ).all<{ tid: string; uses: number }>();
        const forkRows = await env.DB.prepare(
          `SELECT parent.template_id AS tid, COUNT(*) AS forks
             FROM template_version child JOIN template_version parent ON parent.id = child.parent_version_id
            WHERE child.version_no = 1 AND child.parent_version_id IS NOT NULL
            GROUP BY parent.template_id`,
        ).all<{ tid: string; forks: number }>();
        const uses = new Map(usesRows.results.map((r) => [r.tid, r.uses]));
        const forks = new Map(forkRows.results.map((r) => [r.tid, r.forks]));
        const list = latest.results
          .map((t) => {
            const calc = parseJson<CalculationConfig>(t.calculation_config, { kind: 'native' });
            return {
              template_id: t.template_id,
              version_id: t.version_id,
              name: t.name,
              author: t.author_identity,
              tier: t.tier,
              version_no: t.version_no,
              criteriaCount: t.criteria_count,
              calcType: calc.kind === 'expression' ? 'expression' : calc.aggregator ?? 'weighted_mean',
              uses: uses.get(t.template_id) ?? 0,
              forks: forks.get(t.template_id) ?? 0,
              published_at: t.published_at,
            };
          })
          .sort(
            (a, b) =>
              (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) ||
              b.uses - a.uses ||
              b.forks - a.forks ||
              a.published_at.localeCompare(b.published_at),
          );
        return json(list, setCookie);
      }

      // --- Create a root template, or fork an exact version. Body: { name, description?,
      // parent_version_id?, criteria:[{criterion_id?, label, description?, type?, position?,
      // default_active?, default_weight_milli?, scoring_config?, presentation_config?}] }.
      // parent_version_id → FORK (new work whose v1 derives from that exact version). New criteria
      // mint a server-owned id; a reused id (fork) MUST exist in the source version (no spoofed
      // lineage). Author is the current meta identity, NEVER the body. New works are tier=community.
      // NO destructive dedup — publishing always creates; snapshot_hash/logic_hash are recorded for
      // discovery-level dedup + quotas, never to erase genealogy.
      if (path === '/api/templates' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          description?: string;
          parent_version_id?: string;
          calculation_config?: unknown;
          presentation_config?: unknown;
          criteria?: {
            criterion_id?: string;
            label?: string;
            description?: string;
            type?: string;
            position?: number;
            default_active?: boolean;
            default_weight_milli?: number;
            scoring_config?: unknown;
            presentation_config?: unknown;
          }[];
        };
        const nameV = vString(body.name, { required: true, max: LIMITS.name });
        if (!nameV.ok) return json({ error: 'bad_request', why: 'name' }, setCookie, 400);
        const name = nameV.value as string;
        const descV = vString(body.description, { max: LIMITS.description, trim: false });
        if (!descV.ok) return json({ error: 'bad_request', why: 'description' }, setCookie, 400);
        const description = descV.value ?? '';
        const author = meta; // author from server identity — never the request body (invariant)
        const nowIso = new Date().toISOString();

        // Fork: load the source version so reused criterion ids can be checked against ITS lineage,
        // and its config can be inherited when the body omits it.
        let parentVersionId: string | null = null;
        let rootTemplateId: string | null = null;
        let sourceIds = new Set<string>();
        let sourceVer: { calculation_config: CalculationConfig; presentation_config: Record<string, unknown> } | null = null;
        if (body.parent_version_id !== undefined && body.parent_version_id !== null) {
          const pvV = vString(body.parent_version_id, { required: true });
          if (!pvV.ok) return json({ error: 'bad_request', why: 'parent_version_id' }, setCookie, 400);
          const parentVer = await loadVersion(env, pvV.value as string);
          if (!parentVer) return json({ error: 'bad_request', why: 'unknown parent_version_id' }, setCookie, 400);
          parentVersionId = parentVer.version_id;
          const t = await env.DB.prepare(`SELECT root_template_id FROM template WHERE id = ?1`)
            .bind(parentVer.template_id)
            .first<{ root_template_id: string }>();
          rootTemplateId = t?.root_template_id ?? parentVer.template_id;
          sourceIds = new Set(parentVer.criteria.map((c) => c.id));
          sourceVer = { calculation_config: parentVer.calculation_config, presentation_config: parentVer.presentation_config };
        }

        const parsed = parseSlots(body.criteria ?? [], sourceIds);
        if (!parsed.ok) return json({ error: 'bad_request', why: parsed.why }, setCookie, 400);
        const { slots, newCriterionIds } = parsed;
        const cfg = resolveConfigs(body, sourceVer, new Set(slots.map((s) => s.criterion_id)));
        if (!cfg.ok) return json({ error: 'bad_request', why: cfg.error }, setCookie, 400);

        // Flood control (E): per-identity template cap + publish rate limit.
        const owned = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM template WHERE author_identity_id = ?1 AND status != 'hidden'`,
        )
          .bind(author)
          .first<{ n: number }>();
        if ((owned?.n ?? 0) >= LIMITS.templatesPerIdentity) {
          return json({ error: 'quota', why: 'max templates for this identity' }, setCookie, 400);
        }
        if (await recentPublishesExceeded(env, author)) {
          return json({ error: 'quota', why: 'max publishes per 24h' }, setCookie, 400);
        }

        const calc = cfg.value.calc;
        const pres = cfg.value.pres;
        const forHash = { name, description, calculation_config: calc, presentation_config: pres, criteria: slots };
        const snapshot = await snapshotHash(forHash);
        const logic = await logicHash(forHash);

        const templateId = 'tpl-' + crypto.randomUUID();
        const versionId = 'tplv-' + crypto.randomUUID();
        const root = rootTemplateId ?? templateId; // a fresh root points at itself
        const writes: D1PreparedStatement[] = [
          env.DB.prepare(
            // name + author_identity are 0007 vestigial NOT NULL columns kept denormalised; tier/
            // status/author_identity_id/current_version_id are the authoritative V3 fields.
            `INSERT INTO template (id, root_template_id, name, author_identity, author_identity_id, tier, status, created_at, current_version_id)
               VALUES (?1, ?2, ?3, ?4, ?5, 'community', 'active', ?6, ?7)`,
          ).bind(templateId, root, name, author, author, nowIso, versionId),
          env.DB.prepare(
            // canonical_hash is a 0007 vestigial NOT NULL column (no default) — set it to snapshot_hash
            // to satisfy the constraint; V3 reads snapshot_hash/logic_hash, not canonical_hash.
            `INSERT INTO template_version
               (id, template_id, version_no, parent_version_id, name, description, calculation_config,
                presentation_config, snapshot_hash, logic_hash, change_note, published_at, canonical_hash)
               VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Initial version.', ?10, ?8)`,
          ).bind(versionId, templateId, parentVersionId, name, description, JSON.stringify(calc), JSON.stringify(pres), snapshot, logic, nowIso),
          ...slotWrites(env, versionId, slots, newCriterionIds, nowIso),
        ];
        await env.DB.batch(writes);
        return json(
          { template_id: templateId, version_id: versionId, name, tier: 'community', snapshot_hash: snapshot },
          setCookie,
        );
      }

      // --- Publish a REVISION of an existing template (owner only): same template_id, version_no+1,
      // parent = the current version. Old versions stay immutable + addressable; ratings keep their
      // version. Reused criterion ids must exist in the current version's lineage.
      if (path.startsWith('/api/templates/') && path.endsWith('/versions') && request.method === 'POST') {
        const templateId = path.slice('/api/templates/'.length, -'/versions'.length);
        const tpl = await env.DB.prepare(
          `SELECT id, author_identity_id, status, current_version_id FROM template WHERE id = ?1`,
        )
          .bind(templateId)
          .first<{ id: string; author_identity_id: string; status: string; current_version_id: string }>();
        if (!tpl) return json({ error: 'not_found' }, setCookie, 404);
        if (tpl.author_identity_id !== meta) return forbidden(setCookie); // owner only
        if (tpl.status !== 'active') return json({ error: 'bad_request', why: 'template not active' }, setCookie, 400);
        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          description?: string;
          change_note?: string;
          calculation_config?: unknown;
          presentation_config?: unknown;
          criteria?: SlotInput[];
        };
        const nameV = vString(body.name, { required: true, max: LIMITS.name });
        if (!nameV.ok) return json({ error: 'bad_request', why: 'name' }, setCookie, 400);
        const name = nameV.value as string;
        const descV = vString(body.description, { max: LIMITS.description, trim: false });
        if (!descV.ok) return json({ error: 'bad_request', why: 'description' }, setCookie, 400);
        const description = descV.value ?? '';
        const cnV = vString(body.change_note, { max: LIMITS.description, trim: false });
        if (!cnV.ok) return json({ error: 'bad_request', why: 'change_note' }, setCookie, 400);
        const changeNote = cnV.value ?? '';
        const current = await loadVersion(env, tpl.current_version_id);
        const lineageIds = new Set((current?.criteria ?? []).map((c) => c.id));
        const parsed = parseSlots(body.criteria ?? [], lineageIds);
        if (!parsed.ok) return json({ error: 'bad_request', why: parsed.why }, setCookie, 400);
        // Config: explicit → validate; omitted → inherit the CURRENT version's config (not reset).
        const cfg = resolveConfigs(
          body,
          current ? { calculation_config: current.calculation_config, presentation_config: current.presentation_config } : null,
          new Set(parsed.slots.map((s) => s.criterion_id)),
        );
        if (!cfg.ok) return json({ error: 'bad_request', why: cfg.error }, setCookie, 400);
        // Quotas (E): versions/template + publishes/24h.
        const vcount = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM template_version WHERE template_id = ?1`,
        )
          .bind(templateId)
          .first<{ n: number }>();
        if ((vcount?.n ?? 0) >= LIMITS.versionsPerTemplate) {
          return json({ error: 'quota', why: 'max versions for this template' }, setCookie, 400);
        }
        if (await recentPublishesExceeded(env, meta)) {
          return json({ error: 'quota', why: 'max publishes per 24h' }, setCookie, 400);
        }
        const nowIso = new Date().toISOString();
        const nextNo = await env.DB.prepare(
          `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM template_version WHERE template_id = ?1`,
        )
          .bind(templateId)
          .first<{ n: number }>();
        const calc = cfg.value.calc;
        const pres = cfg.value.pres;
        const forHash = { name, description, calculation_config: calc, presentation_config: pres, criteria: parsed.slots };
        const snapshot = await snapshotHash(forHash);
        const logic = await logicHash(forHash);
        const versionId = 'tplv-' + crypto.randomUUID();
        const writes: D1PreparedStatement[] = [
          env.DB.prepare(
            `INSERT INTO template_version
               (id, template_id, version_no, parent_version_id, name, description, calculation_config,
                presentation_config, snapshot_hash, logic_hash, change_note, published_at, canonical_hash)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?9)`,
          ).bind(
            versionId,
            templateId,
            nextNo?.n ?? 1,
            tpl.current_version_id, // parent = the version being revised
            name,
            description,
            JSON.stringify(calc),
            JSON.stringify(pres),
            snapshot,
            logic,
            changeNote || 'Revision.',
            nowIso,
          ),
          ...slotWrites(env, versionId, parsed.slots, parsed.newCriterionIds, nowIso),
          // Advance the work's pointer to the new current version (name denormalised on the work).
          env.DB.prepare(`UPDATE template SET current_version_id = ?1, name = ?2 WHERE id = ?3`).bind(
            versionId,
            name,
            templateId,
          ),
        ];
        await env.DB.batch(writes);
        return json({ template_id: templateId, version_id: versionId, version_no: nextNo?.n ?? 1, name }, setCookie);
      }

      // --- Archive a template (owner only): drops out of discovery + blocks new ratings; historical
      // ratings still render. Never deletes referenced published data.
      if (path.startsWith('/api/templates/') && path.endsWith('/archive') && request.method === 'POST') {
        const templateId = path.slice('/api/templates/'.length, -'/archive'.length);
        const tpl = await env.DB.prepare(`SELECT author_identity_id FROM template WHERE id = ?1`)
          .bind(templateId)
          .first<{ author_identity_id: string }>();
        if (!tpl) return json({ error: 'not_found' }, setCookie, 404);
        if (tpl.author_identity_id !== meta) return forbidden(setCookie);
        await env.DB.prepare(`UPDATE template SET status = 'archived' WHERE id = ?1`).bind(templateId).run();
        return json({ ok: true, template_id: templateId, status: 'archived' }, setCookie);
      }

      // --- Operator-only tier promote/demote (community <-> featured), never mutating a version.
      // Standard is system-owned and not settable here. Gated by the admin secret (the operator).
      if (path.startsWith('/api/templates/') && path.endsWith('/tier') && request.method === 'POST') {
        if (!isAdmin(request, env)) return forbidden(setCookie);
        const templateId = path.slice('/api/templates/'.length, -'/tier'.length);
        const body = (await request.json().catch(() => ({}))) as { tier?: unknown };
        const tier = body.tier;
        if (tier !== 'community' && tier !== 'featured') return json({ error: 'bad_request', why: 'tier' }, setCookie, 400);
        const tpl = await env.DB.prepare(`SELECT tier FROM template WHERE id = ?1`)
          .bind(templateId)
          .first<{ tier: string }>();
        if (!tpl) return json({ error: 'not_found' }, setCookie, 404);
        if (tpl.tier === 'standard') return json({ error: 'bad_request', why: 'cannot retier standard' }, setCookie, 400);
        await env.DB.prepare(`UPDATE template SET tier = ?1 WHERE id = ?2`).bind(tier, templateId).run();
        return json({ ok: true, template_id: templateId, tier }, setCookie);
      }

      // --- Operator-only: backfill snapshot_hash/logic_hash for any published version missing them
      // (V2 community rows migrated by 0008 land with NULL hashes). Deterministic — uses the SAME
      // snapshotHash/logicHash as runtime publication. Idempotent; run once after a V2→V3 migration.
      if (path === '/api/admin/backfill-hashes' && request.method === 'POST') {
        if (!isAdmin(request, env)) return forbidden(setCookie);
        const missing = await env.DB.prepare(
          `SELECT id FROM template_version WHERE snapshot_hash IS NULL OR logic_hash IS NULL`,
        ).all<{ id: string }>();
        let backfilled = 0;
        for (const row of missing.results) {
          const ver = await loadVersion(env, row.id);
          if (!ver) continue;
          const forHash = {
            name: ver.name,
            description: ver.description ?? '',
            calculation_config: ver.calculation_config,
            presentation_config: ver.presentation_config,
            criteria: ver.criteria.map((c) => ({
              criterion_id: c.id,
              label: c.label,
              description: c.description,
              type: c.type,
              position: c.position,
              default_active: c.default_active,
              default_weight_milli: c.default_weight_milli,
              scoring_config: c.scoring_config,
              presentation_config: c.presentation_config,
            })),
          };
          const snapshot = await snapshotHash(forHash);
          const logic = await logicHash(forHash);
          await env.DB.prepare(
            `UPDATE template_version SET snapshot_hash = ?1, logic_hash = ?2 WHERE id = ?3`,
          )
            .bind(snapshot, logic, row.id)
            .run();
          backfilled++;
        }
        return json({ ok: true, backfilled }, setCookie);
      }

      // --- A single template version (its criteria + config), addressable forever.
      if (path.startsWith('/api/template-versions/') && !path.endsWith('/diff') && request.method === 'GET') {
        const versionId = path.slice('/api/template-versions/'.length);
        const ver = await loadVersion(env, versionId);
        if (!ver) return json({ error: 'not_found' }, setCookie, 404);
        return json(ver, setCookie);
      }

      // --- Deterministic diff of a version against its parent — full semantic snapshot: version-level
      // (name/description/calculation_config/presentation_config) + every criterion field, keyed on the
      // stable criterion_id (modified vs added/removed). Broadly explains why snapshot_hash changed.
      if (path.startsWith('/api/template-versions/') && path.endsWith('/diff') && request.method === 'GET') {
        const versionId = path.slice('/api/template-versions/'.length, -'/diff'.length);
        const ver = await loadVersion(env, versionId);
        if (!ver) return json({ error: 'not_found' }, setCookie, 404);
        const parent = ver.parent_version_id ? await loadVersion(env, ver.parent_version_id) : null;
        const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        const version: Record<string, unknown> = {};
        if (parent) {
          if (parent.name !== ver.name) version.name = { from: parent.name, to: ver.name };
          if ((parent.description ?? '') !== (ver.description ?? ''))
            version.description = { from: parent.description, to: ver.description };
          if (!sameJson(parent.calculation_config, ver.calculation_config))
            version.calculation_config = { from: parent.calculation_config, to: ver.calculation_config };
          if (!sameJson(parent.presentation_config, ver.presentation_config))
            version.presentation_config = { from: parent.presentation_config, to: ver.presentation_config };
        }
        const before = new Map((parent?.criteria ?? []).map((c) => [c.id, c]));
        const after = new Map(ver.criteria.map((c) => [c.id, c]));
        const criteria: Record<string, unknown>[] = [];
        for (const [id, a] of after) {
          const b = before.get(id);
          if (!b) {
            criteria.push({ criterion_id: id, change: 'added', label: a.label });
            continue;
          }
          const fields: Record<string, unknown> = {};
          if (a.label !== b.label) fields.label = { from: b.label, to: a.label };
          if ((a.description ?? '') !== (b.description ?? '')) fields.description = { from: b.description, to: a.description };
          if (a.type !== b.type) fields.type = { from: b.type, to: a.type };
          if (a.position !== b.position) fields.position = { from: b.position, to: a.position };
          if (a.default_active !== b.default_active) fields.default_active = { from: b.default_active, to: a.default_active };
          if (a.default_weight_milli !== b.default_weight_milli)
            fields.default_weight_milli = { from: b.default_weight_milli, to: a.default_weight_milli };
          if (!sameJson(a.scoring_config, b.scoring_config)) fields.scoring_config = { from: b.scoring_config, to: a.scoring_config };
          if (!sameJson(a.presentation_config, b.presentation_config))
            fields.presentation_config = { from: b.presentation_config, to: a.presentation_config };
          if (Object.keys(fields).length) criteria.push({ criterion_id: id, change: 'modified', fields });
        }
        for (const [id, b] of before) {
          if (!after.has(id)) criteria.push({ criterion_id: id, change: 'removed', label: b.label });
        }
        return json({ version_id: versionId, parent_version_id: ver.parent_version_id, version, criteria }, setCookie);
      }

      // --- Template detail read-model (P1): the work + its current version + stats + version history.
      // One call feeds the F detail/history/genealogy/compare/edit/fork/old-version surfaces.
      if (
        path.startsWith('/api/templates/') &&
        !path.endsWith('/versions') &&
        !path.endsWith('/archive') &&
        !path.endsWith('/tier') &&
        request.method === 'GET'
      ) {
        const templateId = path.slice('/api/templates/'.length);
        const t = await env.DB.prepare(
          `SELECT id, root_template_id, author_identity_id, tier, status, created_at, current_version_id
             FROM template WHERE id = ?1`,
        )
          .bind(templateId)
          .first<Record<string, string>>();
        if (!t) return json({ error: 'not_found' }, setCookie, 404);
        const current = t.current_version_id ? await loadVersion(env, t.current_version_id) : null;
        const uses = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM ratings r JOIN template_version tv ON tv.id = r.template_version_id WHERE tv.template_id = ?1`,
        )
          .bind(templateId)
          .first<{ n: number }>();
        const forks = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM template_version child JOIN template_version parent ON parent.id = child.parent_version_id
             WHERE child.version_no = 1 AND parent.template_id = ?1`,
        )
          .bind(templateId)
          .first<{ n: number }>();
        const versions = await env.DB.prepare(
          `SELECT id AS version_id, version_no, parent_version_id, name, change_note, published_at, snapshot_hash, logic_hash
             FROM template_version WHERE template_id = ?1 ORDER BY version_no`,
        )
          .bind(templateId)
          .all<Record<string, unknown>>();
        return json(
          {
            template_id: t.id,
            root_template_id: t.root_template_id,
            author_identity_id: t.author_identity_id,
            tier: t.tier,
            status: t.status,
            created_at: t.created_at,
            current_version_id: t.current_version_id,
            current_version: current,
            uses: uses?.n ?? 0,
            forks: forks?.n ?? 0,
            versions: versions.results,
          },
          setCookie,
        );
      }

      // --- See: one member's aggregate + this browser's current rating (with rich breakdown).
      if (path === '/api/profile' && request.method === 'GET') {
        const uid = (url.searchParams.get('uid') ?? '').trim();
        const member = await env.DB.prepare(
          `SELECT uid, username, posts, reg_date FROM members WHERE uid = ?1`,
        )
          .bind(uid)
          .first<{ uid: string; username: string; posts: number | null; reg_date: string | null }>();
        if (!member) return json({ error: 'not_found' }, setCookie, 404);
        const agg = await env.DB.prepare(
          `SELECT AVG(score_bp) AS avg_bp, COUNT(*) AS cnt FROM ratings WHERE target_uid = ?1`,
        )
          .bind(uid)
          .first<{ avg_bp: number | null; cnt: number }>();
        const mine = await env.DB.prepare(
          `SELECT id, score_bp, mode, template_version_id, comment FROM ratings WHERE rater_meta_id = ?1 AND target_uid = ?2`,
        )
          .bind(meta, uid)
          .first<{ id: string; score_bp: number; mode: string; template_version_id: string | null; comment: string | null }>();
        // Sampled reviews shown on the profile. Q6 (sampling policy) is open — v1 uses recency.
        const reviews = await env.DB.prepare(
          `SELECT comment, score_bp FROM ratings
             WHERE target_uid = ?1 AND comment IS NOT NULL AND comment != ''
             ORDER BY updated_at DESC LIMIT 5`,
        )
          .bind(uid)
          .all<{ comment: string; score_bp: number }>();
        // This browser's rich breakdown + the AUTHORITATIVE evaluation trace (re-evaluated server-side
        // from the stored raw values against the exact version) for "Visa beräkningen".
        let yourValues: { criterion_id: string; raw: unknown; normalized_bp: number; weight_milli: number }[] = [];
        let yourEvaluation: {
          score_bp: number;
          base_bp: number;
          aggregator: string;
          lines: unknown[];
          modifiers: unknown[];
        } | null = null;
        if (mine?.mode === 'rich' && mine.template_version_id) {
          const rc = await env.DB.prepare(
            `SELECT criterion_id, raw_value_json, normalized_score_bp, weight_milli
               FROM rating_criterion_value WHERE rating_id = ?1`,
          )
            .bind(mine.id)
            .all<{ criterion_id: string; raw_value_json: string; normalized_score_bp: number; weight_milli: number }>();
          yourValues = rc.results.map((v) => ({
            criterion_id: v.criterion_id,
            raw: parseJson(v.raw_value_json, {}),
            normalized_bp: v.normalized_score_bp,
            weight_milli: v.weight_milli,
          }));
          const version = await loadVersion(env, mine.template_version_id);
          if (version) {
            const bySlot = new Map(version.criteria.map((c) => [c.id, c]));
            const evalInputs: EvalInput[] = rc.results
              .map((v) => {
                const slot = bySlot.get(v.criterion_id);
                return slot
                  ? {
                      criterion_id: slot.id,
                      label: slot.label,
                      type: slot.type,
                      scoring_config: slot.scoring_config,
                      raw: parseJson(v.raw_value_json, {}),
                      weight_milli: v.weight_milli,
                    }
                  : null;
              })
              .filter((x): x is EvalInput => x !== null);
            const ev = evaluate(version.calculation_config, evalInputs);
            yourEvaluation = { score_bp: ev.score_bp, base_bp: ev.base_bp, aggregator: ev.aggregator, lines: ev.lines, modifiers: ev.modifiers };
          }
        }
        // Reputation R = min(5, B + 0.1·P): community rating B plus a small activity bump. Activity
        // is a SEPARATE component (not quality) and only applies when there's a community rating.
        // The MATHS runs at full precision; display rounding is applied ONLY to the response fields
        // (P1 — internal formula must not depend on presentation rounding; display precision is an
        // open question, left as-is here).
        const p = postsPerDay(member.posts, member.reg_date);
        const communityExact = agg?.avg_bp == null ? null : bpToStars(agg.avg_bp); // B (full precision)
        const reputationExact = communityExact == null ? null : Math.min(5, communityExact + ACTIVITY_WEIGHT * (p ?? 0));
        return json(
          {
            uid: member.uid,
            username: member.username,
            community: communityExact == null ? null : r1(communityExact),
            postsPerDay: p == null ? null : r1(p),
            activityBonus: p == null ? 0 : r1(ACTIVITY_WEIGHT * p),
            reputation: reputationExact == null ? null : r1(reputationExact),
            posts: member.posts,
            regDate: member.reg_date,
            count: agg?.cnt ?? 0,
            yourScoreBp: mine?.score_bp ?? null,
            yourStars: mine?.score_bp == null ? null : r1(bpToStars(mine.score_bp)),
            yourMode: mine?.mode ?? null,
            yourTemplateVersion: mine?.template_version_id ?? null,
            yourComment: mine?.comment ?? null,
            yourValues,
            yourEvaluation,
            reviews: reviews.results.map((r) => ({ text: r.comment, stars: r1(bpToStars(r.score_bp)) })),
          },
          setCookie,
        );
      }

      // --- Rate: upsert this browser's rating for a member. Re-rating updates, never stacks.
      // Two modes: 'direct' ({stars 0..5} or legacy {halfsteps 0..10}) or 'rich'
      // ({template_version_id, values:[{criterion_id, raw, weight_milli?}]}). In rich mode the server
      // NORMALIZES each raw value + EVALUATES the version's calculation pipeline (authoritative score);
      // the result is stored in basis points (score_bp) and the per-criterion raw + normalized values
      // are kept, so the rating is reproducible forever against the exact version.
      if (path === '/api/rate' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          uid?: unknown;
          mode?: unknown;
          stars?: unknown;
          halfsteps?: unknown;
          template_version_id?: unknown;
          values?: { criterion_id?: unknown; raw?: unknown; weight_milli?: unknown }[];
          // legacy shape (pre-F front): {criteria:[{criterion_id, halfsteps, weight}]}
          criteria?: { criterion_id?: unknown; halfsteps?: unknown; weight?: unknown }[];
          comment?: unknown;
        };
        const uidV = vString(body.uid, { required: true });
        if (!uidV.ok) return json({ error: 'bad_request', why: 'uid' }, setCookie, 400);
        const uid = uidV.value as string;
        // mode fails closed: if supplied it must be exactly 'direct' or 'rich' (omitted → direct/legacy).
        if (body.mode !== undefined && body.mode !== 'direct' && body.mode !== 'rich') {
          return json({ error: 'bad_request', why: 'mode' }, setCookie, 400);
        }
        const comment = cleanComment(body.comment);
        if (comment === false) return json({ error: 'bad_request', why: 'comment' }, setCookie, 400);
        const member = await env.DB.prepare(`SELECT uid FROM members WHERE uid = ?1`)
          .bind(uid)
          .first();
        if (!member) return json({ error: 'not_found' }, setCookie, 404);

        const now = new Date().toISOString();
        const ratingId = `${meta}:${uid}`;
        let scoreBp: number;
        let mode: 'direct' | 'rich';
        let templateVersionId: string | null = null;
        let valueRows: {
          criterion_id: string;
          raw_value_json: string;
          normalized_score_bp: number;
          weight_milli: number;
        }[] = [];
        let trace: ReturnType<typeof evaluate> | null = null;

        if (body.mode === 'rich') {
          mode = 'rich';
          const tvV = vString(body.template_version_id, { required: true });
          if (!tvV.ok) return json({ error: 'bad_request', why: 'template_version_id' }, setCookie, 400);
          templateVersionId = tvV.value as string;
          const version = await loadVersion(env, templateVersionId);
          if (!version) return json({ error: 'bad_request', why: 'unknown version' }, setCookie, 400);
          // Archived/hidden templates refuse NEW ratings (P0-3); historical reads still render.
          if (version.template_status !== 'active') {
            return json({ error: 'template_not_active' }, setCookie, 409);
          }
          const bySlot = new Map(version.criteria.map((c) => [c.id, c]));
          // The V3 {values} shape, or the legacy {criteria:[{halfsteps,weight}]} shape — the legacy
          // shape is TYPE-validated BEFORE conversion (A–E.3), so string numerics don't slip through.
          let input: { criterion_id?: unknown; raw?: unknown; weight_milli?: unknown }[];
          if (Array.isArray(body.values) && body.values.length) {
            input = body.values;
          } else {
            input = [];
            for (const c of body.criteria ?? []) {
              if (!isRecord(c)) return json({ error: 'bad_request', why: 'legacy criterion' }, setCookie, 400);
              if (typeof c.criterion_id !== 'string' || !c.criterion_id) return json({ error: 'bad_request', why: 'legacy criterion_id' }, setCookie, 400);
              if (typeof c.halfsteps !== 'number' || !Number.isInteger(c.halfsteps) || c.halfsteps < 0 || c.halfsteps > 10)
                return json({ error: 'bad_request', why: 'legacy halfsteps' }, setCookie, 400);
              if (typeof c.weight !== 'number' || !Number.isFinite(c.weight) || c.weight < 0)
                return json({ error: 'bad_request', why: 'legacy weight' }, setCookie, 400);
              const wm = Math.round(c.weight * 1000);
              if (!validateWeightMilli(wm).ok) return json({ error: 'bad_request', why: 'legacy weight' }, setCookie, 400);
              input.push({ criterion_id: c.criterion_id, raw: { value: c.halfsteps / 2 }, weight_milli: wm });
            }
          }
          if (input.length < 1 || input.length > MAX_ACTIVE_CRITERIA) {
            return json({ error: 'bad_request' }, setCookie, 400);
          }
          const seen = new Set<string>();
          const evalInputs: EvalInput[] = [];
          for (const v of input) {
            if (!isRecord(v)) return json({ error: 'bad_request', why: 'each value must be an object' }, setCookie, 400);
            if (typeof v.criterion_id !== 'string') return json({ error: 'bad_request', why: 'criterion_id' }, setCookie, 400);
            const slot = bySlot.get(v.criterion_id);
            if (!slot || seen.has(slot.id)) return json({ error: 'bad_request' }, setCookie, 400); // lineage
            seen.add(slot.id);
            // Weight bounded (P0-7): provided override or the slot default, integer 0..MAX.
            const wv = validateWeightMilli(v.weight_milli != null ? v.weight_milli : slot.default_weight_milli);
            if (!wv.ok) return json({ error: 'bad_request', why: 'weight_milli' }, setCookie, 400);
            // STRICT raw validation (P0-1): reject malformed input — never coerce to a real 0 score.
            const rv = validateRawValue(slot.type, slot.scoring_config, v.raw);
            if (!rv.ok) return json({ error: 'bad_request', why: rv.error }, setCookie, 400);
            evalInputs.push({
              criterion_id: slot.id,
              label: slot.label,
              type: slot.type,
              scoring_config: slot.scoring_config,
              raw: rv.value.canonical_raw, // canonicalized — no arbitrary client JSON persisted (P0-6)
              weight_milli: wv.value,
            });
          }
          trace = evaluate(version.calculation_config, evalInputs);
          if (trace.error || trace.scoring_count === 0) {
            // e.g. all weights zero, or an unsupported (expression) calculation — reject, not 0.
            return json({ error: 'bad_request', why: trace.error ?? 'no scoring criteria' }, setCookie, 400);
          }
          scoreBp = trace.score_bp;
          valueRows = evalInputs.map((i, idx) => ({
            criterion_id: i.criterion_id,
            raw_value_json: JSON.stringify(i.raw),
            normalized_score_bp: trace!.lines[idx].normalized_bp,
            weight_milli: i.weight_milli,
          }));
        } else {
          mode = 'direct';
          if (body.stars != null) {
            const s = body.stars;
            // Direct input is HALF-STAR only (0..5, step 0.5): 4.5 ok, 4.37 rejected. Rich calculation
            // is where finer precision comes from — direct must stay on the half-star grid.
            if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 5 || !Number.isInteger(s * 2)) {
              return json({ error: 'bad_request', why: 'stars must be 0..5 in half-star steps' }, setCookie, 400);
            }
            scoreBp = Math.round(s * (BP_MAX / 5)); // 4.5 → 9000
          } else {
            const hs = body.halfsteps;
            if (typeof hs !== 'number' || !Number.isInteger(hs) || hs < 0 || hs > 10) {
              return json({ error: 'bad_request', why: 'halfsteps must be an integer 0..10' }, setCookie, 400);
            }
            scoreBp = hs * 1000;
          }
        }

        // Atomic: upsert the rating + replace its criterion values (D1 batch = one transaction), so the
        // stored score never desyncs from its breakdown. score_bp is canonical; score_halfsteps is kept
        // in sync (rounded) only for the legacy column.
        const halfsteps = Math.round(scoreBp / 1000);
        const writes: D1PreparedStatement[] = [
          env.DB.prepare(
            `INSERT INTO ratings (rater_meta_id, target_uid, id, score_halfsteps, score_bp, updated_at, mode, template_version_id, comment)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT (rater_meta_id, target_uid) DO UPDATE SET
               score_halfsteps = excluded.score_halfsteps, score_bp = excluded.score_bp,
               updated_at = excluded.updated_at, mode = excluded.mode,
               template_version_id = excluded.template_version_id, comment = excluded.comment`,
          ).bind(meta, uid, ratingId, halfsteps, scoreBp, now, mode, templateVersionId, comment),
          env.DB.prepare(`DELETE FROM rating_criterion_value WHERE rating_id = ?1`).bind(ratingId),
          ...valueRows.map((r) =>
            env.DB.prepare(
              `INSERT INTO rating_criterion_value (rating_id, criterion_id, raw_value_json, normalized_score_bp, weight_milli)
                 VALUES (?1, ?2, ?3, ?4, ?5)`,
            ).bind(ratingId, r.criterion_id, r.raw_value_json, r.normalized_score_bp, r.weight_milli),
          ),
        ];
        await env.DB.batch(writes);

        const agg = await env.DB.prepare(
          `SELECT AVG(score_bp) AS avg_bp, COUNT(*) AS cnt FROM ratings WHERE target_uid = ?1`,
        )
          .bind(uid)
          .first<{ avg_bp: number | null; cnt: number }>();
        return json(
          {
            ok: true,
            score_bp: scoreBp,
            stars: r1(bpToStars(scoreBp)),
            community_stars: agg?.avg_bp == null ? null : r1(bpToStars(agg.avg_bp)),
            count: agg?.cnt ?? 0,
            yourMode: mode,
            trace: trace ? { base_bp: trace.base_bp, aggregator: trace.aggregator, lines: trace.lines, modifiers: trace.modifiers } : null,
          },
          setCookie,
        );
      }

      // --- Cold-boot preseed: populate the member index from Flashback's PUBLIC moderators page.
      // (The top-posters memberlist is authenticated-only — 401 — so it stays on the far side of the
      // trust-domain boundary and is deliberately NOT fetched here.) Later this becomes a background
      // job; for now it's an explicit trigger so the fetch/parse pipeline can be run and verified.
      if (path === '/api/preseed/moderators' && request.method === 'POST') {
        if (!isAdmin(request, env)) return forbidden(setCookie);
        const page = await fetchFlashback('https://www.flashback.org/moderatorer');
        if (!page.ok) return json({ error: 'upstream', status: page.status }, setCookie);
        const re = /href="\/u(\d+)"\s+class="bold">([^<]+)<\/a>/g;
        const seen = new Set<string>();
        let upserted = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(page.html)) !== null) {
          const uid = m[1];
          if (uid === '0' || seen.has(uid)) continue;
          seen.add(uid);
          const username = decodeEntities(m[2]).trim();
          if (!username) continue;
          await upsertMember(env, { uid, username, sourceUrl: 'https://www.flashback.org/u' + uid });
          upserted++;
        }
        return json({ source: 'moderatorer', upserted, encoding: page.encoding }, setCookie);
      }

      // --- Import a memberlist page the operator exported while logged in. The authenticated
      // fetch happens on the human's side (we hold no session); we only parse FACTS (UID, username,
      // reg date, post count) out of the posted HTML and drop everything else (avatars etc.).
      if (path === '/api/preseed/memberlist' && request.method === 'POST') {
        if (!isAdmin(request, env)) return forbidden(setCookie);
        // The operator uploads saved memberlist HTML; the normalizer yields canonical UTF-8
        // regardless of whether the browser saved it as UTF-8 (with a stale ISO-8859-1 meta).
        const page = normalizeBytes(
          new Uint8Array(await request.arrayBuffer()),
          'https://www.flashback.org/memberlist.php?do=getall',
          request.headers.get('Content-Type'),
        );
        const re =
          /flashback\.org\/u(\d+)\s+class=bold>([^<]+)<\/a>[\s\S]{0,400}?Reg:\s*(\d{4}-\d{2}-\d{2})[\s\S]{0,200}?Inlägg:\s*([^<]+?)</g;
        const seen = new Set<string>();
        let upserted = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(page.html)) !== null) {
          const uid = m[1];
          if (seen.has(uid)) continue;
          seen.add(uid);
          const username = decodeEntities(m[2]).trim();
          if (!username) continue;
          const posts = parseInt(m[4].replace(/[^\d]/g, ''), 10) || null;
          await upsertMember(env, {
            uid,
            username,
            regDate: m[3],
            posts,
            sourceUrl: 'https://www.flashback.org/u' + uid,
          });
          upserted++;
        }
        return json({ source: 'memberlist', upserted, encoding: page.encoding }, setCookie);
      }

      // --- The see-and-feel front end.
      if (path === '/' && request.method === 'GET') {
        const { FRONT_HTML } = await import('./front');
        // Inject the mount prefix so the front end's fetch() calls target `${base}/api/...`.
        const html = FRONT_HTML.replaceAll('__BASE_PATH__', base);
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...(setCookie ?? {}) },
        });
      }

      return new Response('Not found', { status: 404, headers: setCookie });
    } catch (err) {
      // External errors stay minimal (security-boundary invariant); details stay server-side.
      console.error(err);
      return json({ error: 'internal' }, setCookie);
    }
  },
};
