import type { KnowledgeBase } from "../core/kb.js";
import type { LLMProvider } from "../llm/provider.js";
import type { EmbeddingsCache } from "../vault/plugin-data.js";
import {
  contextualTextForConcept,
  contextualTextForEntity,
} from "./embedding-text.js";

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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface BuildEmbeddingIndexArgs {
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  cache: EmbeddingsCache;
  signal?: AbortSignal;
}

export async function buildEmbeddingIndex(
  args: BuildEmbeddingIndexArgs,
): Promise<Map<string, number[]>> {
  const index = new Map<string, number[]>();

  for (const e of args.kb.allEntities()) {
    const id = slug(e.name);
    const text = contextualTextForEntity(e);
    const cached = args.cache.entries[id];
    if (cached && cached.sourceText === text) {
      index.set(id, cached.vector);
      continue;
    }
    const vec = await args.provider.embed({
      text,
      model: args.model,
      signal: args.signal,
    });
    args.cache.entries[id] = { sourceText: text, vector: vec };
    index.set(id, vec);
  }

  for (const c of args.kb.allConcepts()) {
    const id = `concept:${slug(c.name)}`;
    const text = contextualTextForConcept(c);
    const cached = args.cache.entries[id];
    if (cached && cached.sourceText === text) {
      index.set(id, cached.vector);
      continue;
    }
    const vec = await args.provider.embed({
      text,
      model: args.model,
      signal: args.signal,
    });
    args.cache.entries[id] = { sourceText: text, vector: vec };
    index.set(id, vec);
  }

  return index;
}
