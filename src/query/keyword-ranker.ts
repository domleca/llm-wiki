import type { KnowledgeBase } from "../core/kb.js";
import type { RankedItem } from "./types.js";

const NAME_HIT = 3;
const FACT_HIT = 1;
const BIGRAM_BOOST = 6;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function rankByKeyword(
  kb: KnowledgeBase,
  terms: readonly string[],
): RankedItem[] {
  if (terms.length === 0) return [];
  const items: Array<{ id: string; score: number; richness: number }> = [];

  for (const e of kb.allEntities()) {
    let score = 0;
    const nameLower = e.name.toLowerCase();
    const aliasesLower = e.aliases.map((a) => a.toLowerCase());
    for (const t of terms) {
      if (nameLower.includes(t)) score += NAME_HIT;
      else if (aliasesLower.some((a) => a.includes(t))) score += NAME_HIT;
      for (const f of e.facts) {
        if (f.toLowerCase().includes(t)) score += FACT_HIT;
      }
    }
    for (let i = 0; i < terms.length - 1; i++) {
      const bigram = `${terms[i]} ${terms[i + 1]}`;
      if (nameLower.includes(bigram)) score += BIGRAM_BOOST;
    }
    if (score > 0) {
      items.push({
        id: slug(e.name),
        score,
        richness: e.facts.length + e.sources.length,
      });
    }
  }

  for (const c of kb.allConcepts()) {
    let score = 0;
    const nameLower = c.name.toLowerCase();
    const defLower = (c.definition ?? "").toLowerCase();
    for (const t of terms) {
      if (nameLower.includes(t)) score += NAME_HIT;
      if (defLower.includes(t)) score += FACT_HIT;
    }
    if (score > 0) {
      items.push({
        id: `concept:${slug(c.name)}`,
        score,
        richness: (c.related?.length ?? 0) + c.sources.length,
      });
    }
  }

  items.sort((a, b) => b.score - a.score || b.richness - a.richness);
  return items.map(({ id, score }) => ({ id, score }));
}
