import type { RetrievedBundle, ScoredSource } from "./types.js";

/**
 * Re-score sources by checking which entities/concepts the LLM actually
 * mentioned in its answer.  Sources linked to unmentioned items are dropped.
 *
 * For each entity/concept whose name (or any alias) appears in the answer,
 * we carry forward its retrieval-based source scores.  Everything else
 * gets zero — it was retrieved but not used.
 */
export function groundSources(
  answer: string,
  bundle: RetrievedBundle,
  retrievalScores: readonly ScoredSource[],
): ScoredSource[] {
  if (answer.length === 0) return [...retrievalScores];

  const lower = answer.toLowerCase();

  // Collect source IDs that belong to mentioned entities/concepts
  const grounded = new Map<string, number>();

  for (const entity of bundle.entities) {
    const names = [entity.name, ...entity.aliases];
    const mentioned = names.some((n) => lower.includes(n.toLowerCase()));
    if (!mentioned) continue;
    for (const src of entity.sources) {
      grounded.set(src, (grounded.get(src) ?? 0) + 1);
    }
  }

  for (const concept of bundle.concepts) {
    if (!lower.includes(concept.name.toLowerCase())) continue;
    for (const src of concept.sources) {
      grounded.set(src, (grounded.get(src) ?? 0) + 1);
    }
  }

  // Connections: keep if both endpoints are mentioned
  for (const conn of bundle.connections) {
    const fromMentioned = lower.includes(conn.from.toLowerCase());
    const toMentioned = lower.includes(conn.to.toLowerCase());
    if (!fromMentioned && !toMentioned) continue;
    for (const src of conn.sources) {
      grounded.set(src, (grounded.get(src) ?? 0) + 1);
    }
  }

  // Keep only retrieval-scored sources that are grounded, preserving their
  // original scores (the retrieval ranking is still useful for ordering
  // among grounded sources).
  return retrievalScores.filter((s) => grounded.has(s.id));
}
