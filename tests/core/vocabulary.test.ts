import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { exportVocabulary } from "../../src/core/vocabulary.js";

describe("exportVocabulary", () => {
  it("returns the empty placeholder when KB is empty", () => {
    const kb = new KnowledgeBase();
    const vocab = exportVocabulary(kb);
    expect(vocab).toContain("(empty");
  });

  it("lists known entities with type prefix", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Alan Watts", type: "person" });
    const vocab = exportVocabulary(kb);
    expect(vocab).toContain("=== KNOWN ENTITIES ===");
    expect(vocab).toContain("[person] Alan Watts");
  });

  it("includes aliases inline when present", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      aliases: ["A.W. Watts", "AW"],
    });
    const vocab = exportVocabulary(kb);
    expect(vocab).toContain("Alan Watts (aka A.W. Watts, AW)");
  });

  it("lists concepts with truncated definition", () => {
    const kb = new KnowledgeBase();
    kb.addConcept({
      name: "Zen Buddhism",
      definition:
        "An extended philosophical tradition emphasizing direct experience over scriptural study and intellectual analysis",
    });
    const vocab = exportVocabulary(kb);
    expect(vocab).toContain("=== KNOWN CONCEPTS ===");
    expect(vocab).toContain("Zen Buddhism:");
    // Should be capped at 80 chars
    const conceptLine = vocab.split("\n").find((l) => l.includes("Zen Buddhism:"));
    expect(conceptLine).toBeDefined();
    expect(conceptLine!.length).toBeLessThanOrEqual(120);
  });

  it("respects the maxItems cap", () => {
    const kb = new KnowledgeBase();
    for (let i = 0; i < 50; i++) {
      kb.addEntity({ name: `Entity ${i}`, type: "person" });
    }
    const vocab = exportVocabulary(kb, 10);
    const entityLines = vocab.split("\n").filter((l) => l.startsWith("- ["));
    expect(entityLines.length).toBeLessThanOrEqual(10);
  });
});
