import type { QueryType } from "./types.js";

const LIST_PATTERNS = [
  /\bwhat\s+(books|articles|tools|people|places|events|projects)\b/i,
  /\blist\s+(all|the)\b/i,
  /\bhow\s+many\b/i,
  /\bwhich\s+(books|articles|tools|people)\b/i,
  /\ball\s+the\b/i,
];

const ENTITY_PATTERNS = [
  /^who\s+is\b/i,
  /^what\s+is\b/i,
  /^tell\s+me\s+about\b/i,
  /^who\s+was\b/i,
  /^what\s+was\b/i,
];

const RELATIONAL_PATTERNS = [
  /\brelate(s|d)?\s+to\b/i,
  /\bconnection\s+between\b/i,
  /\binfluence(s|d)?\b/i,
  /\bhow\s+does\b.*\b(relate|connect|influence)\b/i,
];

export function classifyQuery(text: string): QueryType {
  for (const p of LIST_PATTERNS) if (p.test(text)) return "list_category";
  for (const p of RELATIONAL_PATTERNS) if (p.test(text)) return "relational";
  for (const p of ENTITY_PATTERNS) if (p.test(text)) return "entity_lookup";
  return "conceptual";
}
