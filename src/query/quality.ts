import type { KnowledgeBase } from "../core/kb.js";
import type { EntityType } from "../core/types.js";

export const RETRIEVAL_ENTITY_BLACKLIST: ReadonlySet<string> = new Set([
  "exact name",
  "exact-name",
]);

export const RETRIEVAL_CONCEPT_BLACKLIST: ReadonlySet<string> = new Set([
  "address book",
  "address-book",
]);

const TYPE_SYNONYMS: ReadonlyMap<string, EntityType> = new Map([
  ["person", "person"],
  ["people", "person"],
  ["who", "person"],
  ["org", "org"],
  ["orgs", "org"],
  ["company", "org"],
  ["companies", "org"],
  ["organization", "org"],
  ["book", "book"],
  ["books", "book"],
  ["read", "book"],
  ["tool", "tool"],
  ["tools", "tool"],
  ["project", "project"],
  ["projects", "project"],
  ["article", "article"],
  ["articles", "article"],
  ["place", "place"],
  ["places", "place"],
  ["event", "event"],
  ["events", "event"],
]);

export function detectTypeHint(terms: readonly string[]): EntityType | null {
  for (const t of terms) {
    const hit = TYPE_SYNONYMS.get(t);
    if (hit) return hit;
  }
  return null;
}

/**
 * Soft re-ranking multiplier applied AFTER RRF.
 * Looks up the entity/concept by canonical id (the slug stored on the
 * record itself, not a re-derived form of the name). Both rankers and
 * `retrieve()` emit ids in this canonical form.
 */
export function qualityMultiplier(id: string, kb: KnowledgeBase): number {
  // Concept ids are prefixed
  if (id.startsWith("concept:")) {
    const conceptId = id.slice("concept:".length);
    const concept = kb.allConcepts().find((c) => c.id === conceptId);
    if (!concept) return 1.0;
    let m = 1.0;
    const hasDef = (concept.definition ?? "").trim().length > 0;
    const hasRelated = (concept.related?.length ?? 0) > 0;
    if (hasDef && hasRelated) m *= 1.2;
    if (!hasDef) m *= 0.5;
    return m;
  }

  const entity = kb.allEntities().find((e) => e.id === id);
  if (!entity) return 1.0;

  let m = 1.0;
  if (entity.facts.length >= 3) m *= 1.3;
  if (entity.facts.length === 0) m *= 0.3;
  if (entity.sources.length >= 3) m *= 1.1;

  const allTwitter =
    entity.sources.length > 0 &&
    entity.sources.every((s) => s.toLowerCase().startsWith("twitter/"));
  if (allTwitter) m *= 0.3;

  return m;
}
