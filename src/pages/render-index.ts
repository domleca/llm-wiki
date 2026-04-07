import type { KnowledgeBase } from "../core/kb.js";
import type { FilterSettings } from "../core/filters.js";
import { isQualityEntity, isQualityConcept } from "../core/filters.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function renderIndexPage(
  kb: KnowledgeBase,
  filterSettings: FilterSettings,
  today = todayIso(),
): string {
  const qualityEntities = kb
    .allEntities()
    .filter((e) => isQualityEntity(e, filterSettings))
    .sort((a, b) => a.name.localeCompare(b.name));

  const qualityConcepts = kb
    .allConcepts()
    .filter((c) => isQualityConcept(c, filterSettings))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allSources = kb.allSources().sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [
    `# LLM Wiki Index`,
    "",
    `*Generated ${today}*`,
    "",
    `## Entities (${qualityEntities.length})`,
    "",
  ];

  for (const e of qualityEntities) {
    lines.push(`- [[entities/${e.id}|${e.name}]]`);
  }
  lines.push("");

  lines.push(`## Concepts (${qualityConcepts.length})`, "");
  for (const c of qualityConcepts) {
    lines.push(`- [[concepts/${c.id}|${c.name}]]`);
  }
  lines.push("");

  lines.push(`## Sources (${allSources.length})`, "");
  for (const s of allSources) {
    lines.push(`- [[sources/${s.id}|${s.id}]]`);
  }
  lines.push("");

  return lines.join("\n");
}
