import { cosineSim } from "./embeddings.js";
import type { RankedItem } from "./types.js";

const TOP_N = 50;

export function rankByEmbedding(
  index: ReadonlyMap<string, number[]>,
  queryVec: readonly number[],
): RankedItem[] {
  const scored: RankedItem[] = [];
  for (const [id, vec] of index) {
    const score = cosineSim(queryVec, vec);
    if (score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_N);
}
