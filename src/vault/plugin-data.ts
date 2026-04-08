import {
  safeReadPluginData,
  safeWritePluginData,
  type SafeWriteApp,
} from "./safe-write.js";

export interface EmbeddingsCacheEntry {
  sourceText: string;
  vector: number[];
}

export interface EmbeddingsCache {
  entries: Record<string, EmbeddingsCacheEntry>;
}

const EMBEDDINGS_CACHE_FILE = "embeddings-cache.json";

export async function loadEmbeddingsCache(
  app: SafeWriteApp,
): Promise<EmbeddingsCache> {
  const text = await safeReadPluginData(app, EMBEDDINGS_CACHE_FILE);
  if (!text) return { entries: {} };
  return JSON.parse(text) as EmbeddingsCache;
}

export async function saveEmbeddingsCache(
  app: SafeWriteApp,
  cache: EmbeddingsCache,
): Promise<void> {
  await safeWritePluginData(
    app,
    EMBEDDINGS_CACHE_FILE,
    JSON.stringify(cache, null, 2),
  );
}
