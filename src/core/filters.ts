import type { Concept, Entity } from "./types.js";

export interface FilterSettings {
  minFactsPerEntity: number;
  minSourcesPerEntity: number;
  minSourceContentLength: number;
  skipClippingOnly: boolean;
}

export function defaultFilterSettings(): FilterSettings {
  return {
    minFactsPerEntity: 2,
    minSourcesPerEntity: 2,
    minSourceContentLength: 500,
    skipClippingOnly: true,
  };
}

const ENTITY_BLACKLIST = new Set(["exact name", "exact-name"]);
const CONCEPT_BLACKLIST = new Set(["address book"]);

export function isQualityEntity(e: Entity, settings: FilterSettings): boolean {
  const lower = e.name.trim().toLowerCase();
  if (ENTITY_BLACKLIST.has(lower)) return false;
  if (e.facts.length === 0 && e.aliases.length === 0) return false;
  if (e.facts.length < settings.minFactsPerEntity) return false;
  if (e.sources.length < settings.minSourcesPerEntity) return false;
  return true;
}

export function isQualityConcept(c: Concept, settings: FilterSettings): boolean {
  const lower = c.name.trim().toLowerCase();
  if (CONCEPT_BLACKLIST.has(lower)) return false;
  if (!c.definition || c.definition.trim().length === 0) return false;
  // settings is reserved for future per-concept thresholds; touch it so the lint
  // rule does not flag it as unused.
  void settings;
  return true;
}
