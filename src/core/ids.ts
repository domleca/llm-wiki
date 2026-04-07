/**
 * Deterministic slug generator for entity and concept IDs.
 *
 * Port of `make_id` in ~/tools/llm-wiki/kb.py:
 *   "Andrej Karpathy" -> "andrej-karpathy"
 *   "Retrieval-Augmented Generation" -> "retrieval-augmented-generation"
 *
 * Properties:
 *   - lowercase
 *   - only [a-z0-9-]
 *   - no leading/trailing/double hyphens
 *   - idempotent: makeId(makeId(x)) === makeId(x)
 */
export function makeId(name: string): string {
  const lowered = name.toLowerCase().trim();
  const filtered = Array.from(lowered)
    .map((c) => (isAlnum(c) || c === "-" || c === " " ? c : ""))
    .join("");
  const collapsed = filtered.split(/\s+/).filter((s) => s.length > 0).join("-");
  return collapsed.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function isAlnum(c: string): boolean {
  return /^[a-z0-9]$/.test(c);
}
