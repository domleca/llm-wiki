/**
 * Returns true when `path` is within at least one configured folder.
 * Empty folder lists mean "no restriction".
 */
export function isInAnyFolder(path: string, folders: readonly string[]): boolean {
  if (folders.length === 0) return true;
  return folders.some((folder) => {
    const normalized = folder.endsWith("/") ? folder.slice(0, -1) : folder;
    const prefix = `${normalized}/`;
    return path === normalized || path.startsWith(prefix);
  });
}
