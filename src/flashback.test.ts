import { describe, expect, it } from 'vitest';

import { detectEncoding, normalizeBytes } from './flashback';

const utf8 = (s: string) => new TextEncoder().encode(s);
// Encode a string as ISO-8859-1 (latin1) bytes — the encoding live Flashback pages use.
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.codePointAt(0)!));

// The one sentence we care about surviving every upstream encoding, verbatim, as UTF-8.
const SAMPLE = 'Reg: 2006-09-06 · Inlägg: 12 866 · Åke Öberg';

describe('FlashbackNormalizer encoding boundary', () => {
  it('decodes live latin1 (no charset header, Flashback legacy) to correct UTF-8', () => {
    const bytes = latin1(`<html><body>${SAMPLE}</body></html>`);
    const r = normalizeBytes(bytes, 'https://www.flashback.org/u1');
    expect(r.encoding).toBe('iso-8859-1');
    expect(r.html).toContain('Inlägg');
    expect(r.html).toContain('Åke Öberg');
    expect(r.html).not.toContain('�'); // no replacement chars
  });

  it('decodes browser-saved UTF-8 that still declares <meta charset=ISO-8859-1>', () => {
    // The regression that started this: UTF-8 bytes + a stale latin1 meta. The UTF-8 sniff must win.
    const bytes = utf8(`<html><head><meta charset="ISO-8859-1"></head><body>${SAMPLE}</body></html>`);
    const r = normalizeBytes(bytes, 'memberlist');
    expect(r.encoding).toBe('utf-8');
    expect(r.html).toContain('Inlägg');
    expect(r.html).toContain('Åke Öberg');
  });

  it('honours an authoritative HTTP Content-Type charset over everything', () => {
    const bytes = latin1(SAMPLE);
    expect(detectEncoding('text/html; charset=ISO-8859-1', bytes)).toBe('iso-8859-1');
    expect(detectEncoding('text/html; charset=UTF-8', utf8(SAMPLE))).toBe('utf-8');
  });

  it('detects a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SAMPLE)]);
    expect(detectEncoding(null, bytes)).toBe('utf-8');
  });

  it('produces identical UTF-8 from latin1 and UTF-8 inputs of the same text', () => {
    const fromLatin1 = normalizeBytes(latin1(SAMPLE), 'a').html;
    const fromUtf8 = normalizeBytes(utf8(SAMPLE), 'b').html;
    expect(fromLatin1).toBe(fromUtf8);
    expect(fromLatin1).toBe(SAMPLE);
  });
});
