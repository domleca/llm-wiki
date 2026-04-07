import type { Connection, Entity } from "../core/types.js";
import { entityFrontmatter, serializeFrontmatter } from "./frontmatter.js";

export function renderEntityPage(
  entity: Entity,
  connections: Connection[],
  today?: string,
): string {
  const fm = entityFrontmatter(entity, today);
  const outgoing = connections.filter((c) => c.from === entity.id);
  const incoming = connections.filter((c) => c.to === entity.id);

  const lines: string[] = [serializeFrontmatter(fm), "", `# ${entity.name}`, ""];

  if (entity.facts.length > 0) {
    lines.push("## Facts", "");
    for (const f of entity.facts) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  if (outgoing.length > 0 || incoming.length > 0) {
    lines.push("## Connections", "");
    for (const c of outgoing) {
      lines.push(`- [[${c.to}]] *(${c.type})*`);
    }
    for (const c of incoming) {
      lines.push(`- [[${c.from}]] *(${c.type})*`);
    }
    lines.push("");
  }

  if (entity.sources.length > 0) {
    lines.push("## Sources", "");
    for (const s of entity.sources) {
      lines.push(`- [[${s}]]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
