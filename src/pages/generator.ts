import type { KnowledgeBase } from "../core/kb.js";
import type { FilterSettings } from "../core/filters.js";
import { isQualityEntity, isQualityConcept } from "../core/filters.js";
import { renderEntityPage } from "./render-entity.js";
import { renderConceptPage } from "./render-concept.js";
import { renderSourcePage } from "./render-source.js";
import {
  safeWritePage,
  safeDeletePage,
  listPagePaths,
  type SafeWriteApp,
} from "../vault/safe-write.js";

export interface GenerateResult {
  written: number;
  deleted: number;
}

export async function generatePages(
  app: SafeWriteApp,
  kb: KnowledgeBase,
  filterSettings: FilterSettings,
): Promise<GenerateResult> {
  const written = new Set<string>();

  // Entities — only quality items get pages
  for (const entity of kb.allEntities()) {
    if (!isQualityEntity(entity, filterSettings)) continue;
    const path = `wiki/entities/${entity.id}.md`;
    const connections = kb.connectionsFor(entity.id);
    await safeWritePage(app, path, renderEntityPage(entity, connections));
    written.add(path);
  }

  // Concepts — only quality items get pages
  for (const concept of kb.allConcepts()) {
    if (!isQualityConcept(concept, filterSettings)) continue;
    const path = `wiki/concepts/${concept.id}.md`;
    await safeWritePage(app, path, renderConceptPage(concept));
    written.add(path);
  }

  // Sources — every source gets a page (no quality filter for sources)
  for (const source of kb.allSources()) {
    const path = sourcePagePath(source.id);
    const relatedEntities = kb
      .allEntities()
      .filter((e) => e.sources.includes(source.id));
    const relatedConcepts = kb
      .allConcepts()
      .filter((c) => c.sources.includes(source.id));
    await safeWritePage(
      app,
      path,
      renderSourcePage(source, relatedEntities, relatedConcepts),
    );
    written.add(path);
  }

  // Prune stale pages
  const existing = [
    ...(await listPagePaths(app, "wiki/entities/")),
    ...(await listPagePaths(app, "wiki/concepts/")),
    ...(await listPagePaths(app, "wiki/sources/")),
  ];
  let deleted = 0;
  for (const existingPath of existing) {
    if (!written.has(existingPath)) {
      await safeDeletePage(app, existingPath);
      deleted++;
    }
  }

  return { written: written.size, deleted };
}

export function sourcePagePath(sourcePath: string): string {
  return `wiki/sources/${sourcePath}`;
}
