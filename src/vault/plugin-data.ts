import {
  safeReadPluginData,
  safeWritePluginData,
  type SafeWriteApp,
} from "./safe-write.js";

export interface DreamState {
  lastRun: string | null;
}

export interface EmbeddingsCacheEntry {
  sourceText: string;
  vector: number[];
}

export interface EmbeddingsCache {
  vaultId: string;
  entries: Record<string, EmbeddingsCacheEntry>;
}

const DREAM_STATE_FILE = "dream-state.json";
const EMBEDDINGS_CACHE_FILE = "embeddings-cache.json";

export async function loadDreamState(app: SafeWriteApp): Promise<DreamState> {
  const text = await safeReadPluginData(app, DREAM_STATE_FILE);
  if (!text) return { lastRun: null };
  return JSON.parse(text) as DreamState;
}

export async function saveDreamState(
  app: SafeWriteApp,
  state: DreamState,
): Promise<void> {
  await safeWritePluginData(app, DREAM_STATE_FILE, JSON.stringify(state, null, 2));
}

export async function loadEmbeddingsCache(
  app: SafeWriteApp,
): Promise<EmbeddingsCache> {
  const text = await safeReadPluginData(app, EMBEDDINGS_CACHE_FILE);
  if (!text) return { vaultId: "", entries: {} };
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
