import type { RankedItem } from "./types.js";

export function rrfFuse(
  ranked: ReadonlyArray<readonly RankedItem[]>,
  weights: readonly number[],
  k: number,
): RankedItem[] {
  const acc = new Map<string, number>();
  for (let i = 0; i < ranked.length; i++) {
    const list = ranked[i]!;
    const w = weights[i] ?? 1.0;
    for (let r = 0; r < list.length; r++) {
      const item = list[r]!;
      const contribution = w / (k + r + 1);
      acc.set(item.id, (acc.get(item.id) ?? 0) + contribution);
    }
  }
  return Array.from(acc.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
