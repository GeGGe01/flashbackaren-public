// Flashbackaren — v1-core see-and-feel slice.
// The irreducible loop: find a member -> rate them (direct 0-5, half-star) -> see the aggregate.
// Deliberately trivial to game (no anti-abuse hardening) — the point of the first surface is to
// feel the reputation model with honest users, not to resist abuse. See PoAG.md / the AI docs.

// All Flashback bytes cross exactly one boundary — the FlashbackNormalizer — which yields canonical
// UTF-8 + source metadata. Nothing below decodes upstream bytes itself; parsers assume UTF-8.
import { fetchFlashback, normalizeBytes } from './flashback';

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
// Returns null on no exact match or any upstream hiccup.
async function resolveMemberUpstream(
  q: string,
  env: Env,
): Promise<{ uid: string; username: string; avg_hs: number | null; cnt: number } | null> {
  try {
    const search = await fetchFlashback(
      'https://www.flashback.org/sok/?query=' + encodeURIComponent('p:' + q),
      { redirect: 'manual' },
    );
    const um = (search.location ?? '').match(/\/u(\d+)/);
    if (!um) return null;
    const uid = um[1];
    const profileUrl = 'https://www.flashback.org/u' + uid;
    const profile = await fetchFlashback(profileUrl);
    const tm = profile.html.match(/Visa profil:\s*([^<]+)</);
    const username = (tm ? decodeEntities(tm[1]) : q).trim();
    if (!username) return null;
    // Reg date is in the static profile HTML; post count is public but JS-rendered (not here).
    const rm = profile.html.match(/Reg:\s*<strong>(\d{4}-\d{2}-\d{2})<\/strong>/);
    await upsertMember(env, { uid, username, regDate: rm ? rm[1] : null, sourceUrl: profileUrl });
    return { uid, username, avg_hs: null, cnt: 0 };
  } catch {
    return null;
  }
}

function readMeta(request: Request): string | null {
  const raw = request.headers.get('Cookie') ?? '';
  const m = raw.match(/(?:^|;\s*)fb_meta=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function json(body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
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
function cleanComment(raw: unknown): string | null | false {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s.length > COMMENT_MAX_CHARS) return false;
  if (s.split(/\s+/).filter(Boolean).length > COMMENT_MAX_WORDS) return false;
  return s;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Resolve the browser-owned meta identity; mint one on first contact. This is only an
    // OWNERSHIP key (one browser = one current rating per member), not a person and not hardened.
    let meta = readMeta(request);
    let setCookie: Record<string, string> | undefined;
    if (!meta) {
      meta = crypto.randomUUID();
      setCookie = {
        'Set-Cookie': `${COOKIE}=${meta}; Path=/; Max-Age=${TEN_YEARS}; SameSite=Lax; HttpOnly`,
      };
    }

    try {
      // --- Find: search the local member index by username (cache-first; upstream lookup deferred).
      if (path === '/api/members' && request.method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim();
        const rows = await env.DB.prepare(
          `SELECT m.uid, m.username,
                  AVG(r.score_halfsteps) AS avg_hs,
                  COUNT(r.score_halfsteps) AS cnt
             FROM members m
             LEFT JOIN ratings r ON r.target_uid = m.uid
            WHERE m.username LIKE ?1
            GROUP BY m.uid
            ORDER BY m.username
            LIMIT 25`,
        )
          .bind(`%${q}%`)
          .all<{ uid: string; username: string; avg_hs: number | null; cnt: number }>();
        let list = rows.results;
        // Cache-first: on a genuine miss, resolve one exact username upstream (public search) and cache it.
        if (list.length === 0 && q.length >= 2 && /^[\wåäöÅÄÖ .-]+$/.test(q)) {
          const found = await resolveMemberUpstream(q, env);
          if (found) list = [found];
        }
        return json(
          list.map((m) => ({
            uid: m.uid,
            username: m.username,
            stars: toStars(m.avg_hs),
            count: m.cnt,
          })),
          setCookie,
        );
      }

      // --- The rating template (its criteria) for the rich rating UI. v1: the one Standard template.
      if (path === '/api/template' && request.method === 'GET') {
        const tpl = await env.DB.prepare(
          `SELECT id, name FROM templates WHERE kind = 'standard' ORDER BY created_at LIMIT 1`,
        ).first<{ id: string; name: string }>();
        if (!tpl) return json({ error: 'no_template' }, setCookie);
        const crit = await env.DB.prepare(
          `SELECT id, label FROM criteria WHERE template_id = ?1 ORDER BY position`,
        )
          .bind(tpl.id)
          .all<{ id: string; label: string }>();
        return json({ id: tpl.id, name: tpl.name, criteria: crit.results }, setCookie);
      }

      // --- See: one member's aggregate + this browser's current rating (with rich breakdown).
      if (path === '/api/profile' && request.method === 'GET') {
        const uid = (url.searchParams.get('uid') ?? '').trim();
        const member = await env.DB.prepare(
          `SELECT uid, username, posts, reg_date FROM members WHERE uid = ?1`,
        )
          .bind(uid)
          .first<{ uid: string; username: string; posts: number | null; reg_date: string | null }>();
        if (!member) return json({ error: 'not_found' }, setCookie);
        const agg = await env.DB.prepare(
          `SELECT AVG(score_halfsteps) AS avg_hs, COUNT(*) AS cnt FROM ratings WHERE target_uid = ?1`,
        )
          .bind(uid)
          .first<{ avg_hs: number | null; cnt: number }>();
        const mine = await env.DB.prepare(
          `SELECT score_halfsteps AS hs, mode, template_id, comment FROM ratings WHERE rater_meta_id = ?1 AND target_uid = ?2`,
        )
          .bind(meta, uid)
          .first<{ hs: number; mode: string; template_id: string | null; comment: string | null }>();
        // Sampled reviews shown on the profile. Q6 (sampling policy) is open — v1 uses recency.
        const reviews = await env.DB.prepare(
          `SELECT comment, score_halfsteps AS hs FROM ratings
             WHERE target_uid = ?1 AND comment IS NOT NULL AND comment != ''
             ORDER BY updated_at DESC LIMIT 5`,
        )
          .bind(uid)
          .all<{ comment: string; hs: number }>();
        let yourCriteria: { criterion_id: string; halfsteps: number; weight: number }[] = [];
        if (mine?.mode === 'rich') {
          const rc = await env.DB.prepare(
            `SELECT criterion_id, score_halfsteps AS halfsteps, weight
               FROM rating_criteria WHERE rater_meta_id = ?1 AND target_uid = ?2`,
          )
            .bind(meta, uid)
            .all<{ criterion_id: string; halfsteps: number; weight: number }>();
          yourCriteria = rc.results;
        }
        // Reputation R = min(5, B + 0.1·P): community rating B plus a small activity bump. Activity
        // is a SEPARATE component (not quality) and only applies when there's a community rating.
        const community = toStars(agg?.avg_hs ?? null); // B, or null when unrated
        const p = postsPerDay(member.posts, member.reg_date);
        const activityBonus = p == null ? 0 : r1(ACTIVITY_WEIGHT * p);
        const reputation =
          community == null ? null : r1(Math.min(5, community + ACTIVITY_WEIGHT * (p ?? 0)));
        return json(
          {
            uid: member.uid,
            username: member.username,
            community,
            postsPerDay: p == null ? null : r1(p),
            activityBonus,
            reputation,
            posts: member.posts,
            regDate: member.reg_date,
            count: agg?.cnt ?? 0,
            yourHalfsteps: mine?.hs ?? null,
            yourMode: mine?.mode ?? null,
            yourComment: mine?.comment ?? null,
            yourCriteria,
            reviews: reviews.results.map((r) => ({ text: r.comment, stars: toStars(r.hs) })),
          },
          setCookie,
        );
      }

      // --- Rate: upsert this browser's rating for a member. Re-rating updates, never stacks.
      // Two modes: 'direct' ({halfsteps}) or 'rich' ({template_id, criteria:[{criterion_id, halfsteps, weight}]}),
      // where the stored overall score is the weighted mean of the criteria.
      if (path === '/api/rate' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          uid?: string;
          mode?: string;
          halfsteps?: number;
          template_id?: string;
          criteria?: { criterion_id: string; halfsteps: number; weight: number }[];
          comment?: string;
        };
        const uid = (body.uid ?? '').trim();
        if (!uid) return json({ error: 'bad_request' }, setCookie);
        const comment = cleanComment(body.comment);
        if (comment === false) return json({ error: 'comment_too_long' }, setCookie);
        const member = await env.DB.prepare(`SELECT uid FROM members WHERE uid = ?1`)
          .bind(uid)
          .first();
        if (!member) return json({ error: 'not_found' }, setCookie);

        const now = new Date().toISOString();
        let finalHs: number;
        let mode: 'direct' | 'rich';
        let templateId: string | null = null;
        let rows: { criterion_id: string; halfsteps: number; weight: number }[] = [];

        if (body.mode === 'rich') {
          mode = 'rich';
          templateId = (body.template_id ?? '').trim();
          const input = Array.isArray(body.criteria) ? body.criteria : [];
          if (!templateId || input.length < 1 || input.length > 10) {
            return json({ error: 'bad_request' }, setCookie);
          }
          // Only accept criteria that actually belong to the template (no injected ids).
          const valid = await env.DB.prepare(`SELECT id FROM criteria WHERE template_id = ?1`)
            .bind(templateId)
            .all<{ id: string }>();
          const allowed = new Set(valid.results.map((c) => c.id));
          const seen = new Set<string>();
          let wsum = 0;
          let acc = 0;
          for (const c of input) {
            const cid = String(c.criterion_id);
            const hs = Number(c.halfsteps);
            const w = Number(c.weight);
            if (
              !allowed.has(cid) ||
              seen.has(cid) ||
              !Number.isInteger(hs) ||
              hs < 0 ||
              hs > 10 ||
              !Number.isInteger(w) ||
              w < 1 ||
              w > 5
            ) {
              return json({ error: 'bad_request' }, setCookie);
            }
            seen.add(cid);
            wsum += w;
            acc += hs * w;
            rows.push({ criterion_id: cid, halfsteps: hs, weight: w });
          }
          finalHs = Math.round(acc / wsum); // weighted mean of the criteria, 0..10
        } else {
          mode = 'direct';
          const hs = Number(body.halfsteps);
          if (!Number.isInteger(hs) || hs < 0 || hs > 10) {
            return json({ error: 'bad_request' }, setCookie);
          }
          finalHs = hs;
        }

        // Write the overall rating and its per-criterion breakdown as ONE atomic unit, so the
        // stored score can never desync from its breakdown on a mid-way failure (D1 batch = one
        // transaction). Order: upsert rating → clear old breakdown → insert new breakdown rows.
        const writes: D1PreparedStatement[] = [
          env.DB.prepare(
            `INSERT INTO ratings (rater_meta_id, target_uid, score_halfsteps, updated_at, mode, template_id, comment)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (rater_meta_id, target_uid) DO UPDATE SET
               score_halfsteps = excluded.score_halfsteps, updated_at = excluded.updated_at,
               mode = excluded.mode, template_id = excluded.template_id, comment = excluded.comment`,
          ).bind(meta, uid, finalHs, now, mode, templateId, comment),
          env.DB.prepare(
            `DELETE FROM rating_criteria WHERE rater_meta_id = ?1 AND target_uid = ?2`,
          ).bind(meta, uid),
          ...rows.map((r) =>
            env.DB.prepare(
              `INSERT INTO rating_criteria (rater_meta_id, target_uid, criterion_id, score_halfsteps, weight)
                 VALUES (?1, ?2, ?3, ?4, ?5)`,
            ).bind(meta, uid, r.criterion_id, r.halfsteps, r.weight),
          ),
        ];
        await env.DB.batch(writes);

        const agg = await env.DB.prepare(
          `SELECT AVG(score_halfsteps) AS avg_hs, COUNT(*) AS cnt FROM ratings WHERE target_uid = ?1`,
        )
          .bind(uid)
          .first<{ avg_hs: number | null; cnt: number }>();
        return json(
          {
            ok: true,
            stars: toStars(agg?.avg_hs ?? null),
            count: agg?.cnt ?? 0,
            yourHalfsteps: finalHs,
            yourMode: mode,
          },
          setCookie,
        );
      }

      // --- Cold-boot preseed: populate the member index from Flashback's PUBLIC moderators page.
      // (The top-posters memberlist is authenticated-only — 401 — so it stays on the far side of the
      // trust-domain boundary and is deliberately NOT fetched here.) Later this becomes a background
      // job; for now it's an explicit trigger so the fetch/parse pipeline can be run and verified.
      if (path === '/api/preseed/moderators' && request.method === 'POST') {
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
        return new Response(FRONT_HTML, {
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
