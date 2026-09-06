// FlashbackNormalizer — the single boundary that turns Flashback's (varying) upstream encoding
// into canonical UTF-8. Everything downstream (parsers, API, storage) assumes UTF-8 and must never
// know or care which encoding Flashback originally used. Do NOT decode bytes anywhere else.
//
// Flashback can differ in encoding between responses/endpoints, so encoding is detected PER RESPONSE:
//   1. HTTP Content-Type charset
//   2. BOM
//   3. <meta charset> / <meta http-equiv content-type>
//   4. fallback heuristic (Flashback's legacy default: ISO-8859-1)

// Honest, identifying User-Agent so Flashback can attribute our traffic and reach the operator
// directly (native PM link) if anything pushes too hard — instead of blanket-blocking an anonymous
// scraper. Every FlashbackNormalizer fetch sends this.
const UA =
  'Flashbackaren/0.1 (prototyp; kontakta oss via Flashback-PM: https://www.flashback.org/private.php?do=newpm&u=135422)';

export interface FlashbackResponse {
  ok: boolean;
  status: number;
  finalUrl: string; // response URL after redirects (or the requested URL)
  location: string | null; // redirect target, when fetched with redirect:'manual'
  html: string; // canonical UTF-8
  encoding: string; // the upstream encoding we detected (source metadata, for debugging)
  sourceUrl: string; // canonical source reference (the URL we requested)
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectEncoding(contentType: string | null, bytes: Uint8Array): string {
  // 1. HTTP Content-Type charset (authoritative)
  const ct = /charset=["']?\s*([\w-]+)/i.exec(contentType ?? '');
  if (ct) return ct[1].toLowerCase();
  // 2. BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  // 3. UTF-8 validity sniff — trust real UTF-8 bytes over a possibly-stale <meta> declaration.
  //    Browser-saved Flashback pages are UTF-8 even though the embedded <meta> still says
  //    ISO-8859-1; live latin1 pages contain isolated high bytes that are invalid UTF-8, so they
  //    correctly fall through to the meta/legacy branch below.
  if (isValidUtf8(bytes)) return 'utf-8';
  // 4. <meta charset> / <meta http-equiv=content-type ... charset=...> (scan the ASCII-safe head)
  const head = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, 4096));
  const meta =
    /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head) ??
    /<meta[^>]+http-equiv=["']?content-type["'][^>]*charset=["']?\s*([\w-]+)/i.exec(head);
  if (meta) return meta[1].toLowerCase();
  // 5. fallback: Flashback's legacy default
  return 'iso-8859-1';
}

function decodeToUtf8(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('iso-8859-1').decode(bytes); // last-resort; never throw out of the boundary
  }
}

// Normalize already-obtained bytes (e.g. an operator-uploaded saved page) to a canonical response.
export function normalizeBytes(bytes: Uint8Array, sourceUrl: string, contentType: string | null = null): FlashbackResponse {
  const encoding = detectEncoding(contentType, bytes);
  return { ok: true, status: 200, finalUrl: sourceUrl, location: null, html: decodeToUtf8(bytes, encoding), encoding, sourceUrl };
}

// Fetch a Flashback URL and return canonical UTF-8 + source metadata. This is the ONLY place
// Flashback bytes are decoded.
export async function fetchFlashback(
  url: string,
  opts: { redirect?: 'manual' | 'follow' } = {},
): Promise<FlashbackResponse> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: opts.redirect ?? 'follow' });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const encoding = detectEncoding(res.headers.get('Content-Type'), bytes);
  return {
    ok: res.ok,
    status: res.status,
    finalUrl: res.url || url,
    location: res.headers.get('Location'),
    html: decodeToUtf8(bytes, encoding),
    encoding,
    sourceUrl: url,
  };
}
