import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";

describe("KnowledgeBase — construction", () => {
  it("starts empty when no data is given", () => {
    const kb = new KnowledgeBase();
    expect(kb.data.entities).toEqual({});
    expect(kb.data.concepts).toEqual({});
    expect(kb.data.connections).toEqual([]);
    expect(kb.data.sources).toEqual({});
    expect(kb.data.meta.version).toBe(1);
    expect(kb.data.meta.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(kb.data.meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("loads from a pre-built data object", () => {
    const data = {
      meta: { version: 1, created: "2026-01-01", updated: "2026-01-02" },
      entities: {
        "alan-watts": {
          id: "alan-watts",
          name: "Alan Watts",
          type: "person" as const,
          aliases: [],
          facts: ["Author of Wisdom of Insecurity"],
          sources: ["Books/Watts.md"],
        },
      },
      concepts: {},
      connections: [],
      sources: {},
    };
    const kb = new KnowledgeBase(data);
    expect(kb.data.entities["alan-watts"]?.name).toBe("Alan Watts");
  });
});

describe("KnowledgeBase.addEntity", () => {
  it("creates a new entity when the ID is not present", () => {
    const kb = new KnowledgeBase();
    const e = kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["Author of Wisdom of Insecurity"],
      source: "Books/Watts.md",
    });
    expect(e.id).toBe("alan-watts");
    expect(e.name).toBe("Alan Watts");
    expect(e.type).toBe("person");
    expect(e.facts).toEqual(["Author of Wisdom of Insecurity"]);
    expect(e.sources).toEqual(["Books/Watts.md"]);
    expect(kb.data.entities["alan-watts"]).toBe(e);
  });

  it("merges new facts and sources into an existing entity", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["Author of Wisdom of Insecurity"],
      source: "Books/Watts.md",
    });
    const merged = kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["Master of the law of reversed effort"],
      aliases: ["A.W. Watts"],
      source: "Learn/Buddhism.md",
    });
    expect(merged.facts).toHaveLength(2);
    expect(merged.facts).toContain("Author of Wisdom of Insecurity");
    expect(merged.facts).toContain("Master of the law of reversed effort");
    expect(merged.aliases).toEqual(["A.W. Watts"]);
    expect(merged.sources).toEqual(["Books/Watts.md", "Learn/Buddhism.md"]);
  });

  it("does not duplicate facts when adding the same fact twice", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["Author of Wisdom of Insecurity"],
    });
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["Author of Wisdom of Insecurity"],
    });
    expect(kb.data.entities["alan-watts"]?.facts).toHaveLength(1);
  });

  it("does not add an alias that equals the canonical name", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Alan Watts", type: "person", aliases: ["Alan Watts"] });
    expect(kb.data.entities["alan-watts"]?.aliases).toEqual([]);
  });
});

describe("KnowledgeBase.addConcept", () => {
  it("creates a new concept when the ID is not present", () => {
    const kb = new KnowledgeBase();
    const c = kb.addConcept({
      name: "Zen Buddhism",
      definition: "The practice of direct experience",
      related: ["Alan Watts"],
      source: "Books/Watts.md",
    });
    expect(c.id).toBe("zen-buddhism");
    expect(c.definition).toBe("The practice of direct experience");
    expect(c.related).toEqual(["Alan Watts"]);
    expect(c.sources).toEqual(["Books/Watts.md"]);
  });

  it("keeps the longer definition when merging", () => {
    const kb = new KnowledgeBase();
    kb.addConcept({ name: "Zen", definition: "Short def" });
    kb.addConcept({
      name: "Zen",
      definition: "A much longer and more thorough definition of Zen",
    });
    expect(kb.data.concepts["zen"]?.definition).toBe(
      "A much longer and more thorough definition of Zen",
    );
  });

  it("does not shrink an existing definition", () => {
    const kb = new KnowledgeBase();
    kb.addConcept({ name: "Zen", definition: "A long thorough definition" });
    kb.addConcept({ name: "Zen", definition: "Short" });
    expect(kb.data.concepts["zen"]?.definition).toBe(
      "A long thorough definition",
    );
  });

  it("merges related items without duplication", () => {
    const kb = new KnowledgeBase();
    kb.addConcept({ name: "Zen", related: ["Alan Watts"] });
    kb.addConcept({ name: "Zen", related: ["Alan Watts", "D.T. Suzuki"] });
    expect(kb.data.concepts["zen"]?.related).toEqual([
      "Alan Watts",
      "D.T. Suzuki",
    ]);
  });
});
