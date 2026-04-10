import type { RetrievedBundle } from "./types.js";

/**
 * Check if a path is inside one of the given folders.
 * If folders array is empty, all paths are considered "inside".
 */
function isInAnyFolder(path: string, folders: string[]): boolean {
  if (folders.length === 0) return true;
  return folders.some((folder) => {
    const prefix = folder.endsWith("/") ? folder : folder + "/";
    return path === folder || path.startsWith(prefix);
  });
}

export function filterBundleByFolder(
  bundle: RetrievedBundle,
  folders: string[],
): RetrievedBundle {
  if (folders.length === 0) return bundle;

  return {
    ...bundle,
    entities: bundle.entities.filter((e) =>
      e.sources.some((source) => isInAnyFolder(source, folders)),
    ),
    concepts: bundle.concepts.filter((c) =>
      c.sources.some((source) => isInAnyFolder(source, folders)),
    ),
    sources: bundle.sources.filter((s) => isInAnyFolder(s.id, folders)),
    // connections kept as-is — they reference entity names, not paths
  };
}
