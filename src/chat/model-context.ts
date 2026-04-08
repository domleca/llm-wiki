/**
 * Per-model context-window discovery with in-memory caching.
 *
 * Asks the provider for the model's reported context length and caches the
 * result per model id. Falls back to FALLBACK_CONTEXT_WINDOW if the provider
 * returns null or throws — the caller never has to handle errors.
 */
import type { LLMProvider } from "../llm/provider.js";

export const FALLBACK_CONTEXT_WINDOW = 4096;

const cache = new Map<string, number>();

/** Test-only: reset the in-memory cache between cases. */
export function _resetModelContextCache(): void {
  cache.clear();
}

export async function getModelContextWindow(
  provider: LLMProvider,
  model: string,
): Promise<number> {
  const hit = cache.get(model);
  if (hit !== undefined) return hit;
  try {
    const { contextLength } = await provider.showModel(model);
    const value = contextLength ?? FALLBACK_CONTEXT_WINDOW;
    cache.set(model, value);
    return value;
  } catch {
    cache.set(model, FALLBACK_CONTEXT_WINDOW);
    return FALLBACK_CONTEXT_WINDOW;
  }
}
