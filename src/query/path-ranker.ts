import type { KnowledgeBase } from "../core/kb.js";
import type { RankedItem } from "./types.js";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function rankByPath(
  kb: KnowledgeBase,
  terms: readonly string[],
): RankedItem[] {
  if (terms.length === 0) return [];
  const items: RankedItem[] = [];

  for (const e of kb.allEntities()) {
    let score = 0;
    for (const src of e.sources) {
      const lower = src.toLowerCase();
      for (const t of terms) if (lower.includes(t)) score += 1;
    }
    if (score > 0) items.push({ id: slug(e.name), score });
  }

  for (const c of kb.allConcepts()) {
    let score = 0;
    for (const src of c.sources) {
      const lower = src.toLowerCase();
      for (const t of terms) if (lower.includes(t)) score += 1;
    }
    if (score > 0) items.push({ id: `concept:${slug(c.name)}`, score });
  }

  items.sort((a, b) => b.score - a.score);
  return items;
}
