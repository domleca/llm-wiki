import { describe, it, expect } from "vitest";
import { rankByPath } from "../../src/query/path-ranker.js";
import { KnowledgeBase } from "../../src/core/kb.js";

describe("rankByPath", () => {
  it("scores entities by source-path term hits", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      aliases: [],
      facts: ["x"],
      source: "Books/Watts.md",
    });
    kb.addEntity({
      name: "Karpathy",
      type: "person",
      aliases: [],
      facts: ["y"],
      source: "Learn/Karpathy.md",
    });
    const ranked = rankByPath(kb, ["books"]);
    expect(ranked[0]?.id).toBe("alan-watts");
  });

  it("returns empty when no term matches any path", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "X",
      type: "other",
      aliases: [],
      facts: ["y"],
      source: "Other/X.md",
    });
    expect(rankByPath(kb, ["books"])).toEqual([]);
  });
});
