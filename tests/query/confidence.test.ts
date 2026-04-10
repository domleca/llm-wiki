import { describe, it, expect } from "vitest";
import { assessConfidence } from "../../src/query/confidence.js";
import type { RetrievedBundle } from "../../src/query/types.js";

function bundle(
  entities: number,
  concepts: number,
  sources: number,
): RetrievedBundle {
  return {
    question: "test",
    queryType: "conceptual",
    entities: Array.from({ length: entities }, (_, i) => ({
      id: `e${i}`,
      name: `entity-${i}`,
      type: "other" as const,
      aliases: [],
      facts: ["fact"],
      sources: [`src${i}.md`],
    })),
    concepts: Array.from({ length: concepts }, (_, i) => ({
      id: `c${i}`,
      name: `concept-${i}`,
      definition: "def",
      related: [],
      sources: [`src${i}.md`],
    })),
    connections: [],
    sources: Array.from({ length: sources }, (_, i) => ({
      id: `src${i}.md`,
      summary: "summary",
      date: "",
      mtime: 0,
      origin: "user-note" as const,
    })),
  };
}

describe("assessConfidence", () => {
  it("returns empty when no entities or concepts", () => {
    expect(assessConfidence(bundle(0, 0, 0))).toBe("empty");
  });

  it("returns thin when very few items and one source", () => {
    expect(assessConfidence(bundle(1, 0, 1))).toBe("thin");
    expect(assessConfidence(bundle(0, 2, 1))).toBe("thin");
    expect(assessConfidence(bundle(1, 1, 0))).toBe("thin");
  });

  it("returns confident with enough material", () => {
    expect(assessConfidence(bundle(3, 0, 2))).toBe("confident");
    expect(assessConfidence(bundle(2, 1, 2))).toBe("confident");
    expect(assessConfidence(bundle(0, 5, 3))).toBe("confident");
  });

  it("returns confident when few items but many sources", () => {
    expect(assessConfidence(bundle(1, 1, 3))).toBe("confident");
  });
});
