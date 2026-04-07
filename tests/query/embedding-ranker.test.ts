import { describe, it, expect } from "vitest";
import { rankByEmbedding } from "../../src/query/embedding-ranker.js";

describe("rankByEmbedding", () => {
  it("ranks items by cosine similarity to the query vector", () => {
    const index = new Map<string, number[]>([
      ["a", [1, 0, 0]],
      ["b", [0.5, 0.8, 0]],
      ["c", [0.9, 0.1, 0]],
    ]);
    const ranked = rankByEmbedding(index, [1, 0, 0]);
    expect(ranked[0]?.id).toBe("a");
    expect(ranked[1]?.id).toBe("c");
    expect(ranked[2]?.id).toBe("b");
  });

  it("caps results at 50", () => {
    const index = new Map<string, number[]>();
    for (let i = 0; i < 100; i++) index.set(`e${i}`, [Math.random()]);
    expect(rankByEmbedding(index, [1]).length).toBe(50);
  });
});
