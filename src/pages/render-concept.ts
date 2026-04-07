import type { Concept } from "../core/types.js";
import { makeId } from "../core/ids.js";
import { conceptFrontmatter, serializeFrontmatter } from "./frontmatter.js";

export function renderConceptPage(concept: Concept, today?: string): string {
  const fm = conceptFrontmatter(concept, today);
  const lines: string[] = [
    serializeFrontmatter(fm),
    "",
    `# ${concept.name}`,
    "",
  ];

  if (concept.definition) {
    lines.push(concept.definition, "");
  }

  if (concept.related.length > 0) {
    lines.push("## Related", "");
    for (const r of concept.related) {
      lines.push(`- [[${makeId(r)}|${r}]]`);
    }
    lines.push("");
  }

  if (concept.sources.length > 0) {
    lines.push("## Sources", "");
    for (const s of concept.sources) {
      lines.push(`- [[${s}]]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
