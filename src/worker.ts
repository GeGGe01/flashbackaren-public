// Flashbackaren — v1-core see-and-feel slice.
// The irreducible loop: find a member -> rate them (direct 0-5, half-star) -> see the aggregate.
// Deliberately trivial to game (no anti-abuse hardening) — the point of the first surface is to
// feel the reputation model with honest users, not to resist abuse. See PoAG.md / the AI docs.

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
}
interface Env {
  DB: D1Database;
}

const COOKIE = 'fb_meta';
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
const UA = 'flashbackaren/0.1 (prototype)';

// Resolve an exact username to a member via Flashback's PUBLIC member search: sok/?query=p:<name>
// 302-redirects to the profile /uNNN on an exact match. We read the redirect (don't follow),
// take the canonical username from the public profile <title>, cache the fact, and return it.
// Returns null on no exact match or any upstream hiccup. Facts only — no content.
async function resolveMemberUpstream(
  q: string,
  env: Env,
): Promise<{ uid: string; username: string; avg_hs: number | null; cnt: number } | null> {
  try {
    const sres = await fetch(
      'https://www.flashback.org/sok/?query=' + encodeURIComponent('p:' + q),
      { headers: { 'User-Agent': UA }, redirect: 'manual' },
    );
    const loc = sres.headers.get('Location') ?? '';
    const um = loc.match(/\/u(\d+)/);
    if (!um) return null;
    const uid = um[1];
    const pres = await fetch('https://www.flashback.org/u' + uid, { headers: { 'User-Agent': UA } });
    const phtml = new TextDecoder('iso-8859-1').decode(await pres.arrayBuffer());
    const tm = phtml.match(/Visa profil:\s*([^<]+)</);
    const username = (tm ? decodeEntities(tm[1]) : q).trim();
    if (!username) return null;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO members (uid, username, first_seen, last_seen) VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (uid) DO UPDATE SET username = excluded.username, last_seen = excluded.last_seen`,
    )
      .bind(uid, username, now)
      .run();
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
        const member = await env.DB.prepare(`SELECT uid, username FROM members WHERE uid = ?1`)
          .bind(uid)
          .first<{ uid: string; username: string }>();
        if (!member) return json({ error: 'not_found' }, setCookie);
        const agg = await env.DB.prepare(
          `SELECT AVG(score_halfsteps) AS avg_hs, COUNT(*) AS cnt FROM ratings WHERE target_uid = ?1`,
        )
          .bind(uid)
          .first<{ avg_hs: number | null; cnt: number }>();
        const mine = await env.DB.prepare(
          `SELECT score_halfsteps AS hs, mode, template_id FROM ratings WHERE rater_meta_id = ?1 AND target_uid = ?2`,
        )
          .bind(meta, uid)
          .first<{ hs: number; mode: string; template_id: string | null }>();
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
        return json(
          {
            uid: member.uid,
            username: member.username,
            stars: toStars(agg?.avg_hs ?? null),
            count: agg?.cnt ?? 0,
            yourHalfsteps: mine?.hs ?? null,
            yourMode: mine?.mode ?? null,
            yourCriteria,
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
        };
        const uid = (body.uid ?? '').trim();
        if (!uid) return json({ error: 'bad_request' }, setCookie);
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

        await env.DB.prepare(
          `INSERT INTO ratings (rater_meta_id, target_uid, score_halfsteps, updated_at, mode, template_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (rater_meta_id, target_uid) DO UPDATE SET
             score_halfsteps = excluded.score_halfsteps, updated_at = excluded.updated_at,
             mode = excluded.mode, template_id = excluded.template_id`,
        )
          .bind(meta, uid, finalHs, now, mode, templateId)
          .run();

        // Replace any prior per-criterion breakdown for this (rater, target).
        await env.DB.prepare(
          `DELETE FROM rating_criteria WHERE rater_meta_id = ?1 AND target_uid = ?2`,
        )
          .bind(meta, uid)
          .run();
        for (const r of rows) {
          await env.DB.prepare(
            `INSERT INTO rating_criteria (rater_meta_id, target_uid, criterion_id, score_halfsteps, weight)
               VALUES (?1, ?2, ?3, ?4, ?5)`,
          )
            .bind(meta, uid, r.criterion_id, r.halfsteps, r.weight)
            .run();
        }

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
        const res = await fetch('https://www.flashback.org/moderatorer', {
          headers: { 'User-Agent': 'flashbackaren-preseed/0.1 (prototype)' },
        });
        if (!res.ok) return json({ error: 'upstream', status: res.status }, setCookie);
        const html = new TextDecoder('iso-8859-1').decode(await res.arrayBuffer());
        const re = /href="\/u(\d+)"\s+class="bold">([^<]+)<\/a>/g;
        const now = new Date().toISOString();
        const seen = new Set<string>();
        let upserted = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
          const uid = m[1];
          if (uid === '0' || seen.has(uid)) continue;
          seen.add(uid);
          const username = decodeEntities(m[2]).trim();
          if (!username) continue;
          await env.DB.prepare(
            `INSERT INTO members (uid, username, first_seen, last_seen) VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT (uid) DO UPDATE SET username = excluded.username, last_seen = excluded.last_seen`,
          )
            .bind(uid, username, now)
            .run();
          upserted++;
        }
        return json({ source: 'moderatorer', upserted }, setCookie);
      }

      // --- Import a memberlist page the operator exported while logged in. The authenticated
      // fetch happens on the human's side (we hold no session); we only parse FACTS (UID, username,
      // reg date, post count) out of the posted HTML and drop everything else (avatars etc.).
      if (path === '/api/preseed/memberlist' && request.method === 'POST') {
        const htmlBody = await request.text();
        const re =
          /flashback\.org\/u(\d+)\s+class=bold>([^<]+)<\/a>[\s\S]{0,400}?Reg:\s*(\d{4}-\d{2}-\d{2})[\s\S]{0,200}?Inlägg:\s*([^<]+?)</g;
        const now = new Date().toISOString();
        const seen = new Set<string>();
        let upserted = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(htmlBody)) !== null) {
          const uid = m[1];
          if (seen.has(uid)) continue;
          seen.add(uid);
          const username = decodeEntities(m[2]).trim();
          const regDate = m[3];
          const posts = parseInt(m[4].replace(/[^\d]/g, ''), 10) || null;
          if (!username) continue;
          await env.DB.prepare(
            `INSERT INTO members (uid, username, first_seen, last_seen, posts, reg_date)
               VALUES (?1, ?2, ?3, ?3, ?4, ?5)
             ON CONFLICT (uid) DO UPDATE SET
               username = excluded.username, last_seen = excluded.last_seen,
               posts = excluded.posts, reg_date = excluded.reg_date`,
          )
            .bind(uid, username, now, posts, regDate)
            .run();
          upserted++;
        }
        return json({ source: 'memberlist', upserted }, setCookie);
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
