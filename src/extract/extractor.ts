import type { KnowledgeBase } from "../core/kb.js";
import type {
  ConnectionType,
  EntityType,
  SourceOrigin,
} from "../core/types.js";
import { exportVocabulary } from "../core/vocabulary.js";
import type { LLMProvider } from "../llm/provider.js";
import { DEFAULT_CHAR_LIMIT } from "./defaults.js";
import { buildExtractionPrompt } from "./prompts.js";
import { parseExtraction, type ParsedExtraction } from "./parser.js";

export interface ExtractFileInput {
  path: string;
  content: string;
  mtime: number;
  /**
   * SHA-256 hex digest of `content`. Computed by the caller so we can
   * skip re-extraction when the hash matches the stored record, and
   * stored alongside the extraction so future runs can compare against
   * it. See `sha256Hex` in `./content-hash.ts`.
   */
  contentHash: string;
  origin: SourceOrigin;
}

export interface ExtractFileArgs {
  provider: LLMProvider;
  kb: KnowledgeBase;
  file: ExtractFileInput;
  model: string;
  outputLanguage?: string;
  signal?: AbortSignal;
  charLimit?: number;
}

const ENTITY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  "person",
  "org",
  "tool",
  "project",
  "book",
  "article",
  "place",
  "event",
  "other",
]);

const CONNECTION_TYPES: ReadonlySet<ConnectionType> = new Set<ConnectionType>([
  "influences",
  "uses",
  "critiques",
  "extends",
  "part-of",
  "created-by",
  "related-to",
  "applies-to",
  "contrasts-with",
]);

/**
 * Extract structured knowledge from a single file and merge into the KB.
 * Returns the parsed extraction on success, or null if the LLM response
 * could not be parsed (in which case the KB is untouched and the source
 * is NOT marked as processed — a later retry will re-attempt the file).
 */
export async function extractFile(
  args: ExtractFileArgs,
): Promise<ParsedExtraction | null> {
  const limit = args.charLimit ?? DEFAULT_CHAR_LIMIT;
  const content =
    args.file.content.length > limit
      ? args.file.content.slice(0, limit) + "\n\n[... truncated ...]"
      : args.file.content;

  const prompt = buildExtractionPrompt({
    vocabulary: exportVocabulary(args.kb),
    sourcePath: args.file.path,
    content,
    outputLanguage: args.outputLanguage ?? "English",
  });

  let raw = "";
  for await (const chunk of args.provider.complete({
    prompt,
    model: args.model,
    signal: args.signal,
  })) {
    raw += chunk;
  }

  const parsed = parseExtraction(raw);
  if (!parsed) return null;

  for (const ent of parsed.entities) {
    const name = (ent.name ?? "").trim();
    if (!name) continue;
    const type: EntityType = ENTITY_TYPES.has(ent.type as EntityType)
      ? (ent.type as EntityType)
      : "other";
    args.kb.addEntity({
      name,
      type,
      aliases: ent.aliases ?? [],
      facts: ent.facts ?? [],
      source: args.file.path,
    });
  }

  for (const con of parsed.concepts) {
    const name = (con.name ?? "").trim();
    if (!name) continue;
    args.kb.addConcept({
      name,
      definition: con.definition ?? "",
      related: con.related ?? [],
      source: args.file.path,
    });
  }

  for (const conn of parsed.connections) {
    const from = (conn.from ?? "").trim();
    const to = (conn.to ?? "").trim();
    if (!from || !to) continue;
    const type: ConnectionType = CONNECTION_TYPES.has(
      conn.type as ConnectionType,
    )
      ? (conn.type as ConnectionType)
      : "related-to";
    args.kb.addConnection({
      from,
      to,
      type,
      description: conn.description ?? "",
      source: args.file.path,
    });
  }

  args.kb.markSource({
    path: args.file.path,
    summary: parsed.source_summary,
    mtime: args.file.mtime,
    contentHash: args.file.contentHash,
    origin: args.file.origin,
  });

  return parsed;
}
