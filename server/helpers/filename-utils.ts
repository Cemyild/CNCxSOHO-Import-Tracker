/**
 * Make a reference safe to embed in a download file name.
 *
 * References like "CNCALO-102 / 2" contain path separators, which browsers and
 * file systems reject or interpret as directories.
 */
export function safeFilenamePart(
  value: string | null | undefined,
  fallback = 'export',
): string {
  const cleaned = String(value ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');

  return cleaned || fallback;
}
