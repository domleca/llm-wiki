/**
 * Pure data types for the Knowledge Base.
 *
 * No runtime logic, no Obsidian dependencies. These types describe
 * the shape of knowledge.json — the source of truth shared with the
 * Python CLI tool at ~/tools/llm-wiki/.
 */

/** Entity types matching the Python tool's extraction prompt. */
export type EntityType =
  | "person"
  | "org"
  | "tool"
  | "project"
  | "book"
  | "article"
  | "place"
  | "event"
  | "other";

/** Connection types matching the Python tool's extraction prompt. */
export type ConnectionType =
  | "influences"
  | "uses"
  | "critiques"
  | "extends"
  | "part-of"
  | "created-by"
  | "related-to"
  | "applies-to"
  | "contrasts-with";

/** Where a source file came from in the vault. */
export type SourceOrigin = "user-note" | "promoted" | "daily";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  facts: string[];
  sources: string[];
}

export interface Concept {
  id: string;
  name: string;
  definition: string;
  related: string[];
  sources: string[];
}

export interface Connection {
  from: string;
  to: string;
  type: ConnectionType;
  description: string;
  sources: string[];
}

export interface SourceRecord {
  id: string;
  summary: string;
  date: string;
  mtime: number;
  origin: SourceOrigin;
}

export interface KBMeta {
  version: number;
  created: string;
  updated: string;
}

export interface KBData {
  meta: KBMeta;
  entities: Record<string, Entity>;
  concepts: Record<string, Concept>;
  connections: Connection[];
  sources: Record<string, SourceRecord>;
}
