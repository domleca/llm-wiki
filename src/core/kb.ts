import type {
  Concept,
  Connection,
  ConnectionType,
  Entity,
  EntityType,
  KBData,
  SourceOrigin,
  SourceRecord,
} from "./types.js";
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

export interface AddConnectionArgs {
  from: string;
  to: string;
  type: ConnectionType;
  description?: string;
  source?: string;
}

export interface MarkSourceArgs {
  path: string;
  mtime: number;
  origin: SourceOrigin;
  summary?: string;
  date?: string;
  /** SHA-256 hex digest of the file's content at extraction time. */
  contentHash?: string;
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

  addConnection(args: AddConnectionArgs): Connection {
    const fromId = makeId(args.from);
    const toId = makeId(args.to);
    const existing = this.data.connections.find(
      (c) => c.from === fromId && c.to === toId && c.type === args.type,
    );
    if (existing) {
      if (args.source && !existing.sources.includes(args.source)) {
        existing.sources.push(args.source);
      }
      return existing;
    }
    const connection: Connection = {
      from: fromId,
      to: toId,
      type: args.type,
      description: args.description ?? "",
      sources: args.source ? [args.source] : [],
    };
    this.data.connections.push(connection);
    return connection;
  }

  markSource(args: MarkSourceArgs): void {
    const record: SourceRecord = {
      id: args.path,
      summary: args.summary ?? "",
      date: args.date ?? todayIso(),
      mtime: args.mtime,
      origin: args.origin,
    };
    if (args.contentHash !== undefined) {
      record.contentHash = args.contentHash;
    }
    this.data.sources[args.path] = record;
  }

  /**
   * Decides whether a file needs (re-)extraction.
   *
   * The primary signal is the content hash: if the stored record has a
   * `contentHash` and it matches the current file's hash, the file is
   * identical to what we last extracted and we skip it. This is immune
   * to mtime drift from iCloud re-sync, backup restores, vault moves,
   * clock skew, and cross-tool unit mismatches (seconds vs milliseconds).
   *
   * The secondary signal, used only for pre-migration entries that lack
   * a stored hash, is the mtime comparison we used before hash-based
   * dedupe shipped. Those entries get their hash backfilled on skip
   * (see `backfillContentHash`), so after one successful run every
   * source has a hash and the fallback path is never taken again.
   */
  needsExtraction(
    path: string,
    currentMtime: number,
    currentContentHash: string,
  ): boolean {
    const stored = this.data.sources[path];
    if (!stored) return true;
    if (stored.contentHash !== undefined) {
      return currentContentHash !== stored.contentHash;
    }
    // Pre-migration entry: no stored hash, fall back to mtime.
    return currentMtime > stored.mtime;
  }

  /**
   * Populates or updates `contentHash` on an existing source without
   * touching `summary`, `date`, or `origin`. Called by the extraction
   * queue when a file is skipped as up-to-date — the queue has just
   * computed the file's hash and we want to cache it so future runs
   * use the hash path instead of the mtime fallback.
   *
   * No-op if the source does not exist.
   */
  backfillContentHash(path: string, contentHash: string, mtime: number): void {
    const stored = this.data.sources[path];
    if (!stored) return;
    stored.contentHash = contentHash;
    // Upgrade stored mtime to match the current on-disk value, so a
    // future mtime-based comparison (e.g. from an older tool) does not
    // spuriously flag this file as needing re-extraction.
    stored.mtime = mtime;
  }

  isProcessed(path: string): boolean {
    return path in this.data.sources;
  }

  allEntities(): Entity[] {
    return Object.values(this.data.entities);
  }

  allConcepts(): Concept[] {
    return Object.values(this.data.concepts);
  }

  allConnections(): Connection[] {
    return this.data.connections;
  }

  allSources(): SourceRecord[] {
    return Object.values(this.data.sources);
  }

  getEntity(nameOrId: string): Entity | undefined {
    const id = makeId(nameOrId);
    if (this.data.entities[id]) return this.data.entities[id];
    const lower = nameOrId.toLowerCase();
    for (const e of Object.values(this.data.entities)) {
      if (e.aliases.some((a) => a.toLowerCase() === lower)) {
        return e;
      }
    }
    return undefined;
  }

  getConcept(nameOrId: string): Concept | undefined {
    const id = makeId(nameOrId);
    return this.data.concepts[id];
  }

  removeSource(path: string): void {
    delete this.data.sources[path];
    for (const [id, entity] of Object.entries(this.data.entities)) {
      entity.sources = entity.sources.filter((s) => s !== path);
      if (entity.sources.length === 0) delete this.data.entities[id];
    }
    for (const [id, concept] of Object.entries(this.data.concepts)) {
      concept.sources = concept.sources.filter((s) => s !== path);
      if (concept.sources.length === 0) delete this.data.concepts[id];
    }
    this.data.connections = this.data.connections.filter((conn) => {
      conn.sources = conn.sources.filter((s) => s !== path);
      return conn.sources.length > 0;
    });
  }

  renameSource(oldPath: string, newPath: string): void {
    const source = this.data.sources[oldPath];
    if (!source) return;
    delete this.data.sources[oldPath];
    source.id = newPath;
    this.data.sources[newPath] = source;
    for (const entity of Object.values(this.data.entities)) {
      entity.sources = entity.sources.map((s) => (s === oldPath ? newPath : s));
    }
    for (const concept of Object.values(this.data.concepts)) {
      concept.sources = concept.sources.map((s) =>
        s === oldPath ? newPath : s,
      );
    }
    for (const conn of this.data.connections) {
      conn.sources = conn.sources.map((s) => (s === oldPath ? newPath : s));
    }
  }

  connectionsFor(nameOrId: string): Connection[] {
    const id = makeId(nameOrId);
    return this.data.connections.filter(
      (c) => c.from === id || c.to === id,
    );
  }

  stats(): {
    entities: number;
    concepts: number;
    connections: number;
    sources: number;
  } {
    return {
      entities: Object.keys(this.data.entities).length,
      concepts: Object.keys(this.data.concepts).length,
      connections: this.data.connections.length,
      sources: Object.keys(this.data.sources).length,
    };
  }
}
