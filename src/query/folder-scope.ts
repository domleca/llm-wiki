import type { RetrievedBundle } from "./types.js";

export function filterBundleByFolder(
  bundle: RetrievedBundle,
  folder: string,
): RetrievedBundle {
  if (!folder) return bundle;
  const prefix = folder.endsWith("/") ? folder : folder + "/";
  const inFolder = (path: string): boolean =>
    path === folder || path.startsWith(prefix);

  return {
    ...bundle,
    entities: bundle.entities.filter((e) => e.sources.some(inFolder)),
    concepts: bundle.concepts.filter((c) => c.sources.some(inFolder)),
    sources: bundle.sources.filter((s) => inFolder(s.id)),
    // connections kept as-is — they reference entity names, not paths
  };
}
