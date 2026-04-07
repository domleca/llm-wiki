import type { KnowledgeBase } from "./kb.js";

const DEFAULT_MAX = 300;
const DEFINITION_CAP = 80;

/**
 * Compact text listing of all known entities and concepts. Sent to the LLM
 * at extraction time so it normalizes against existing terms (the Karpathy
 * deduplication-at-extraction-time pattern).
 *
 * Port of `KnowledgeBase.vocabulary` in ~/tools/llm-wiki/kb.py.
 */
export function exportVocabulary(kb: KnowledgeBase, maxItems = DEFAULT_MAX): string {
  const lines: string[] = [];
  const entities = Object.values(kb.data.entities).slice(0, maxItems);
  const conceptBudget = Math.max(0, maxItems - entities.length);
  const concepts = Object.values(kb.data.concepts).slice(0, conceptBudget);

  if (entities.length > 0) {
    lines.push("=== KNOWN ENTITIES ===");
    for (const e of entities) {
      const aliases = e.aliases.length > 0 ? ` (aka ${e.aliases.join(", ")})` : "";
      lines.push(`- [${e.type}] ${e.name}${aliases}`);
    }
  }

  if (concepts.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("=== KNOWN CONCEPTS ===");
    for (const c of concepts) {
      const def = (c.definition ?? "").slice(0, DEFINITION_CAP);
      lines.push(`- ${c.name}: ${def}`);
    }
  }

  return lines.length > 0
    ? lines.join("\n")
    : "(empty — no entities or concepts yet)";
}
