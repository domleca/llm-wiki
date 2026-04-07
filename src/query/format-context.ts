import type { RetrievedBundle } from "./types.js";

export function formatContextMarkdown(bundle: RetrievedBundle): string {
  const lines: string[] = [];

  if (bundle.entities.length > 0) {
    lines.push("## ENTITIES");
    for (const e of bundle.entities) {
      lines.push(`### ${e.name} [${e.type}]`);
      if (e.aliases.length > 0) {
        lines.push(`Aliases: ${e.aliases.join(", ")}`);
      }
      if (e.facts.length > 0) {
        lines.push("Facts:");
        for (const f of e.facts) lines.push(`- ${f}`);
      }
      if (e.sources.length > 0) {
        lines.push(`Sources: ${e.sources.join(", ")}`);
      }
      lines.push("");
    }
  }

  if (bundle.concepts.length > 0) {
    lines.push("## CONCEPTS");
    for (const c of bundle.concepts) {
      lines.push(`### ${c.name}`);
      if (c.definition) lines.push(c.definition);
      if (c.related && c.related.length > 0) {
        lines.push(`Related: ${c.related.join(", ")}`);
      }
      if (c.sources.length > 0) {
        lines.push(`Sources: ${c.sources.join(", ")}`);
      }
      lines.push("");
    }
  }

  if (bundle.connections.length > 0) {
    lines.push("## CONNECTIONS");
    for (const c of bundle.connections) {
      lines.push(`- ${c.from} → ${c.to} (${c.type}): ${c.description}`);
    }
    lines.push("");
  }

  if (bundle.sources.length > 0) {
    lines.push("## SOURCE FILES");
    for (const s of bundle.sources) {
      lines.push(`- ${s.id} — ${s.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
