import type { Concept, Entity } from "../core/types.js";

const MAX_FACTS = 5;
const MAX_DEF = 200;

export function contextualTextForEntity(e: Entity): string {
  const parts: string[] = [`Entity [${e.type}]: ${e.name}.`];
  if (e.aliases.length > 0) {
    parts.push(`Also known as: ${e.aliases.join(", ")}.`);
  }
  if (e.facts.length > 0) {
    parts.push(e.facts.slice(0, MAX_FACTS).join(" "));
  }
  return parts.join(" ");
}

export function contextualTextForConcept(c: Concept): string {
  const def = (c.definition ?? "").slice(0, MAX_DEF);
  const parts: string[] = [`Concept: ${c.name}.`];
  if (def.length > 0) parts.push(def);
  if (c.related && c.related.length > 0) {
    parts.push(`Related to: ${c.related.join(", ")}.`);
  }
  return parts.join(" ");
}
