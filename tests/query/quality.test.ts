import { describe, it, expect } from "vitest";
import {
  RETRIEVAL_ENTITY_BLACKLIST,
  RETRIEVAL_CONCEPT_BLACKLIST,
  qualityMultiplier,
  detectTypeHint,
} from "../../src/query/quality.js";
import { KnowledgeBase } from "../../src/core/kb.js";

describe("blacklists", () => {
  it("includes the known bad names", () => {
    expect(RETRIEVAL_ENTITY_BLACKLIST.has("exact name")).toBe(true);
    expect(RETRIEVAL_CONCEPT_BLACKLIST.has("address book")).toBe(true);
  });
});

describe("qualityMultiplier", () => {
  function kbWith(facts: number, sources: string[]): KnowledgeBase {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "X",
      type: "person",
      aliases: [],
      facts: Array.from({ length: facts }, (_, i) => `f${i}`),
      source: sources[0] ?? "Other/x.md",
    });
    for (let i = 1; i < sources.length; i++) {
      kb.addEntity({
        name: "X",
        type: "person",
        aliases: [],
        facts: [],
        source: sources[i]!,
      });
    }
    return kb;
  }

  it("boosts entities with >=3 facts", () => {
    const kb = kbWith(3, ["Books/x.md"]);
    expect(qualityMultiplier("x", kb)).toBeGreaterThan(1.0);
  });

  it("penalises entities with 0 facts", () => {
    const kb = kbWith(0, ["Books/x.md"]);
    expect(qualityMultiplier("x", kb)).toBeLessThan(1.0);
  });

  it("penalises twitter-only sources", () => {
    const kb = kbWith(2, ["Twitter/a.md", "Twitter/b.md"]);
    expect(qualityMultiplier("x", kb)).toBeLessThan(1.0);
  });
});

describe("detectTypeHint", () => {
  it("maps plurals and synonyms to entity types", () => {
    expect(detectTypeHint(["books"])).toBe("book");
    expect(detectTypeHint(["people"])).toBe("person");
    expect(detectTypeHint(["companies"])).toBe("org");
  });
  it("returns null when no type hint present", () => {
    expect(detectTypeHint(["random", "words"])).toBeNull();
  });
});
