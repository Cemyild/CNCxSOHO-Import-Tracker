/**
 * Repairs the filename multer reports for an uploaded file.
 *
 * Browsers send multipart filenames as UTF-8 bytes, but busboy (under multer)
 * decodes them as latin1. A Turkish name therefore arrives mangled:
 *   "A0590U KAHVERENGİ.pdf"  ->  "A0590U KAHVERENGÄ°.pdf"
 *
 * That breaks two things at once: the stored filename is wrong, and the name
 * no longer matches the key the browser used in its `meta` payload, so the
 * styles the user confirmed are dropped on the floor.
 *
 * Re-reading the bytes as UTF-8 restores the name. ASCII names are unchanged,
 * and a name that is already correct is left alone.
 */
export function decodeMultipartFilename(name: string): string {
  if (!name) return name;

  // A latin1 decode can only ever yield code points U+0000..U+00FF. Anything
  // above that proves the name was decoded correctly already — re-decoding it
  // would destroy it (İ has no latin1 byte and would collapse to "0").
  for (const ch of name) {
    if (ch.codePointAt(0)! > 0xff) return name;
  }

  const decoded = Buffer.from(name, "latin1").toString("utf8");

  // U+FFFD means the bytes were not valid UTF-8 — keep what we were given.
  if (decoded.includes("\uFFFD")) return name;

  return decoded;
}
