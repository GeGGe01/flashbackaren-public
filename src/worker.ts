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
        return json(
          rows.results.map((m) => ({
            uid: m.uid,
            username: m.username,
            stars: toStars(m.avg_hs),
            count: m.cnt,
          })),
          setCookie,
        );
      }

      // --- See: one member's aggregate + this browser's current rating.
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
          `SELECT score_halfsteps AS hs FROM ratings WHERE rater_meta_id = ?1 AND target_uid = ?2`,
        )
          .bind(meta, uid)
          .first<{ hs: number }>();
        return json(
          {
            uid: member.uid,
            username: member.username,
            stars: toStars(agg?.avg_hs ?? null),
            count: agg?.cnt ?? 0,
            yourHalfsteps: mine?.hs ?? null,
          },
          setCookie,
        );
      }

      // --- Rate: upsert this browser's direct rating for a member. Re-rating updates, never stacks.
      if (path === '/api/rate' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          uid?: string;
          halfsteps?: number;
        };
        const uid = (body.uid ?? '').trim();
        const hs = Number(body.halfsteps);
        if (!uid || !Number.isInteger(hs) || hs < 0 || hs > 10) {
          return json({ error: 'bad_request' }, setCookie);
        }
        const member = await env.DB.prepare(`SELECT uid FROM members WHERE uid = ?1`)
          .bind(uid)
          .first();
        if (!member) return json({ error: 'not_found' }, setCookie);
        await env.DB.prepare(
          `INSERT INTO ratings (rater_meta_id, target_uid, score_halfsteps, updated_at)
             VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (rater_meta_id, target_uid)
             DO UPDATE SET score_halfsteps = excluded.score_halfsteps, updated_at = excluded.updated_at`,
        )
          .bind(meta, uid, hs, new Date().toISOString())
          .run();
        const agg = await env.DB.prepare(
          `SELECT AVG(score_halfsteps) AS avg_hs, COUNT(*) AS cnt FROM ratings WHERE target_uid = ?1`,
        )
          .bind(uid)
          .first<{ avg_hs: number | null; cnt: number }>();
        return json(
          { ok: true, stars: toStars(agg?.avg_hs ?? null), count: agg?.cnt ?? 0, yourHalfsteps: hs },
          setCookie,
        );
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
