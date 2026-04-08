import type { KnowledgeBase } from "../core/kb.js";
import type { LLMProvider } from "../llm/provider.js";
import type { EmbeddingsCache } from "../vault/plugin-data.js";
import {
  contextualTextForConcept,
  contextualTextForEntity,
} from "./embedding-text.js";

/** Ollama model used to vectorize entities and questions. Hardcoded: the
 * embeddings cache is keyed only on source text, so swapping models would
 * silently mix incompatible vector spaces. */
export const EMBEDDING_MODEL = "nomic-embed-text";

export function cosineSim(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface EmbeddingIndexProgress {
  /** 1-based count of items processed so far (cache hits included). */
  readonly current: number;
  /** Total number of items the build will visit. Stable for the whole call. */
  readonly total: number;
}

export interface BuildEmbeddingIndexArgs {
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  cache: EmbeddingsCache;
  signal?: AbortSignal;
  onProgress?: (progress: EmbeddingIndexProgress) => void;
}

export async function buildEmbeddingIndex(
  args: BuildEmbeddingIndexArgs,
): Promise<Map<string, number[]>> {
  const index = new Map<string, number[]>();
  const entities = args.kb.allEntities();
  const concepts = args.kb.allConcepts();
  const total = entities.length + concepts.length;
  let current = 0;

  const tick = (): void => {
    current += 1;
    args.onProgress?.({ current, total });
  };

  for (const e of entities) {
    const id = e.id;
    const text = contextualTextForEntity(e);
    const cached = args.cache.entries[id];
    if (cached && cached.sourceText === text) {
      index.set(id, cached.vector);
      tick();
      continue;
    }
    const vec = await args.provider.embed({
      text,
      model: args.model,
      signal: args.signal,
    });
    args.cache.entries[id] = { sourceText: text, vector: vec };
    index.set(id, vec);
    tick();
  }

  for (const c of concepts) {
    const id = `concept:${c.id}`;
    const text = contextualTextForConcept(c);
    const cached = args.cache.entries[id];
    if (cached && cached.sourceText === text) {
      index.set(id, cached.vector);
      tick();
      continue;
    }
    const vec = await args.provider.embed({
      text,
      model: args.model,
      signal: args.signal,
    });
    args.cache.entries[id] = { sourceText: text, vector: vec };
    index.set(id, vec);
    tick();
  }

  return index;
}
