import type { KnowledgeBase } from "../core/kb.js";
import type { Concept, Entity } from "../core/types.js";
import { classifyQuery } from "./classify.js";
import { rankByKeyword } from "./keyword-ranker.js";
import { rankByPath } from "./path-ranker.js";
import { rankByEmbedding } from "./embedding-ranker.js";
import { rrfFuse } from "./rrf.js";
import {
  RETRIEVAL_CONCEPT_BLACKLIST,
  RETRIEVAL_ENTITY_BLACKLIST,
  detectTypeHint,
  qualityMultiplier,
} from "./quality.js";
import { extractQueryTerms } from "./terms.js";
import { filterBundleByFolder } from "./folder-scope.js";
import type { QueryType, RankedItem, RetrievedBundle } from "./types.js";

const QUERY_WEIGHTS: Record<QueryType, [number, number, number]> = {
  entity_lookup: [2.0, 0.5, 0.3],
  list_category: [0.8, 0.8, 1.5],
  relational: [1.0, 1.2, 0.5],
  conceptual: [0.8, 1.5, 0.5],
};

const TYPE_HINT_BOOST = 2.5;
const RRF_K = 60;
const MAX_ENTITIES = 12;
const MAX_CONCEPTS = 8;

export interface RetrieveArgs {
  question: string;
  kb: KnowledgeBase;
  embeddingIndex?: ReadonlyMap<string, number[]>;
  queryEmbedding?: number[] | null;
  folder?: string;
}

export function retrieve(args: RetrieveArgs): RetrievedBundle {
  const terms = extractQueryTerms(args.question);
  const queryType = classifyQuery(args.question);
  const [wKeyword, wEmbed, wPath] = QUERY_WEIGHTS[queryType];

  const kwRanked = rankByKeyword(args.kb, terms);
  const pathRanked = rankByPath(args.kb, terms);
  const embedRanked: RankedItem[] =
    args.embeddingIndex && args.queryEmbedding
      ? rankByEmbedding(args.embeddingIndex, args.queryEmbedding)
      : [];

  const fused = rrfFuse(
    [kwRanked, embedRanked, pathRanked],
    [wKeyword, wEmbed, wPath],
    RRF_K,
  );

  const typeHint = detectTypeHint(terms);

  // Build id-keyed lookup maps once so id resolution is O(1).
  const entitiesById = new Map<string, Entity>();
  for (const e of args.kb.allEntities()) entitiesById.set(e.id, e);
  const conceptsById = new Map<string, Concept>();
  for (const c of args.kb.allConcepts()) conceptsById.set(c.id, c);

  // Apply quality multipliers and type-hint boost
  const adjusted = fused
    .map((item) => {
      let score = item.score * qualityMultiplier(item.id, args.kb);
      if (typeHint && !item.id.startsWith("concept:")) {
        const ent = entitiesById.get(item.id);
        if (ent && ent.type === typeHint) score *= TYPE_HINT_BOOST;
      }
      return { id: item.id, score };
    })
    .sort((a, b) => b.score - a.score);

  // Resolve to entities and concepts, filtering blacklist
  const entities: RetrievedBundle["entities"] = [];
  const concepts: RetrievedBundle["concepts"] = [];
  for (const item of adjusted) {
    if (item.id.startsWith("concept:")) {
      if (concepts.length >= MAX_CONCEPTS) continue;
      const conceptId = item.id.slice("concept:".length);
      const c = conceptsById.get(conceptId);
      if (!c) continue;
      if (
        RETRIEVAL_CONCEPT_BLACKLIST.has(conceptId) ||
        RETRIEVAL_CONCEPT_BLACKLIST.has(c.name.toLowerCase())
      ) {
        continue;
      }
      concepts.push(c);
    } else {
      if (entities.length >= MAX_ENTITIES) continue;
      const e = entitiesById.get(item.id);
      if (!e) continue;
      if (
        RETRIEVAL_ENTITY_BLACKLIST.has(item.id) ||
        RETRIEVAL_ENTITY_BLACKLIST.has(e.name.toLowerCase())
      ) {
        continue;
      }
      entities.push(e);
    }
  }

  // Gather connections that touch any of our entities (by id, not name).
  const entityIds = new Set(entities.map((e) => e.id));
  const connections = args.kb
    .allConnections()
    .filter((c) => entityIds.has(c.from) || entityIds.has(c.to));

  // Gather source records referenced by surviving entities/concepts
  const sourcePaths = new Set<string>();
  for (const e of entities) for (const s of e.sources) sourcePaths.add(s);
  for (const c of concepts) for (const s of c.sources) sourcePaths.add(s);
  const sources = args.kb
    .allSources()
    .filter((s) => sourcePaths.has(s.id));

  const bundle: RetrievedBundle = {
    question: args.question,
    queryType,
    entities,
    concepts,
    connections,
    sources,
  };

  return filterBundleByFolder(bundle, args.folder ?? "");
}
