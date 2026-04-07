import { describe, it, expect } from "vitest";
import { MockLLMProvider } from "./mock-llm-provider.js";

describe("MockLLMProvider.embed", () => {
  it("returns canned vectors in order", async () => {
    const m = new MockLLMProvider({
      responses: [],
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    expect(await m.embed({ text: "a", model: "x" })).toEqual([1, 0, 0]);
    expect(await m.embed({ text: "b", model: "x" })).toEqual([0, 1, 0]);
  });

  it("throws when embeddings queue is exhausted", async () => {
    const m = new MockLLMProvider({ responses: [], embeddings: [[1]] });
    await m.embed({ text: "a", model: "x" });
    await expect(m.embed({ text: "b", model: "x" })).rejects.toThrow(
      /no more embeddings/i,
    );
  });
});
