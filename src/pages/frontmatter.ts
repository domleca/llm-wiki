import type { Entity, Concept, SourceRecord } from "../core/types.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function entityFrontmatter(
  entity: Entity,
  today = todayIso(),
): Record<string, unknown> {
  return {
    type: "entity",
    "entity-type": entity.type,
    name: entity.name,
    aliases: [...entity.aliases],
    tags: ["llm-wiki/entity", `llm-wiki/entity/${entity.type}`],
    "source-count": entity.sources.length,
    "date-updated": today,
    cssclasses: [],
  };
}

export function conceptFrontmatter(
  concept: Concept,
  today = todayIso(),
): Record<string, unknown> {
  return {
    type: "concept",
    name: concept.name,
    aliases: [],
    tags: ["llm-wiki/concept"],
    "source-count": concept.sources.length,
    "date-updated": today,
    cssclasses: [],
  };
}

export function sourceFrontmatter(
  source: SourceRecord,
): Record<string, unknown> {
  return {
    type: "source",
    origin: source.origin,
    date: source.date,
    tags: ["llm-wiki/source"],
    aliases: [],
    cssclasses: [],
  };
}

function yamlScalar(value: unknown): string {
  if (typeof value === "string") {
    // Quote if value contains YAML-unsafe characters
    if (/[:{}[\],#&*!|>'"%@`]/.test(value) || value.trim() !== value) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

/**
 * Serialize a frontmatter object to a YAML block (including --- delimiters).
 * Handles strings, numbers, booleans, and arrays of primitives.
 */
export function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${yamlScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}
