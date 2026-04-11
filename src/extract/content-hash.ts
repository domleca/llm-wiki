/**
 * SHA-256 hex digest of a string, used as the primary dedupe key for
 * extraction. Implemented on top of Web Crypto's `SubtleCrypto.digest`
 * so the same code runs in Obsidian's Electron renderer and in the
 * Node 20+ test environment without polyfills.
 *
 * Why a hash and not just mtime: file mtimes are not stable in this
 * environment. iCloud Drive, vault moves, backup restores, and tools
 * that store mtimes in seconds vs milliseconds all cause mtime drift,
 * which used to spuriously trigger full re-extraction even when the
 * underlying file content was identical. A content hash is immune to
 * all of those.
 */
export async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}
