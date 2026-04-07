import type { Concept, Entity, EntityType, KBData } from "./types.js";
import { makeId } from "./ids.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyKb(): KBData {
  const today = todayIso();
  return {
    meta: { version: 1, created: today, updated: today },
    entities: {},
    concepts: {},
    connections: [],
    sources: {},
  };
}

export interface AddEntityArgs {
  name: string;
  type: EntityType;
  aliases?: string[];
  facts?: string[];
  source?: string;
}

export interface AddConceptArgs {
  name: string;
  definition?: string;
  related?: string[];
  source?: string;
}

export class KnowledgeBase {
  data: KBData;

  constructor(data?: KBData) {
    this.data = data ?? emptyKb();
  }

  addEntity(args: AddEntityArgs): Entity {
    const id = makeId(args.name);
    const existing = this.data.entities[id];
    if (existing) {
      return this.mergeEntity(existing, {
        aliases: args.aliases,
        facts: args.facts,
        source: args.source,
      });
    }
    const entity: Entity = {
      id,
      name: args.name,
      type: args.type,
      aliases: (args.aliases ?? []).filter((a) => a !== args.name),
      facts: args.facts ?? [],
      sources: args.source ? [args.source] : [],
    };
    this.data.entities[id] = entity;
    return entity;
  }

  private mergeEntity(
    entity: Entity,
    patch: { aliases?: string[]; facts?: string[]; source?: string },
  ): Entity {
    if (patch.aliases) {
      for (const a of patch.aliases) {
        if (a !== entity.name && !entity.aliases.includes(a)) {
          entity.aliases.push(a);
        }
      }
    }
    if (patch.facts) {
      const existingFacts = new Set(entity.facts);
      for (const f of patch.facts) {
        if (!existingFacts.has(f)) {
          entity.facts.push(f);
          existingFacts.add(f);
        }
      }
    }
    if (patch.source && !entity.sources.includes(patch.source)) {
      entity.sources.push(patch.source);
    }
    return entity;
  }

  addConcept(args: AddConceptArgs): Concept {
    const id = makeId(args.name);
    const existing = this.data.concepts[id];
    if (existing) {
      return this.mergeConcept(existing, {
        definition: args.definition,
        related: args.related,
        source: args.source,
      });
    }
    const concept: Concept = {
      id,
      name: args.name,
      definition: args.definition ?? "",
      related: args.related ?? [],
      sources: args.source ? [args.source] : [],
    };
    this.data.concepts[id] = concept;
    return concept;
  }

  private mergeConcept(
    concept: Concept,
    patch: { definition?: string; related?: string[]; source?: string },
  ): Concept {
    if (patch.definition && patch.definition.length > concept.definition.length) {
      concept.definition = patch.definition;
    }
    if (patch.related) {
      const existing = new Set(concept.related);
      for (const r of patch.related) {
        if (!existing.has(r)) {
          concept.related.push(r);
          existing.add(r);
        }
      }
    }
    if (patch.source && !concept.sources.includes(patch.source)) {
      concept.sources.push(patch.source);
    }
    return concept;
  }
}
