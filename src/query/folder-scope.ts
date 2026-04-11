import type { RetrievedBundle } from "./types.js";
import { isInAnyFolder } from "../vault/path-scope.js";

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
