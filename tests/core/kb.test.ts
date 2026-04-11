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

describe("KnowledgeBase.addConnection", () => {
  it("creates a new connection between two normalized IDs", () => {
    const kb = new KnowledgeBase();
    const c = kb.addConnection({
      from: "Alan Watts",
      to: "Zen Buddhism",
      type: "influences",
      description: "Watts popularized Zen in the West",
      source: "Books/Watts.md",
    });
    expect(c.from).toBe("alan-watts");
    expect(c.to).toBe("zen-buddhism");
    expect(c.type).toBe("influences");
    expect(c.description).toBe("Watts popularized Zen in the West");
    expect(c.sources).toEqual(["Books/Watts.md"]);
    expect(kb.data.connections).toHaveLength(1);
  });

  it("dedupes by (from, to, type) — adds source to existing connection instead", () => {
    const kb = new KnowledgeBase();
    kb.addConnection({
      from: "Alan Watts",
      to: "Zen Buddhism",
      type: "influences",
      source: "Books/Watts.md",
    });
    kb.addConnection({
      from: "Alan Watts",
      to: "Zen Buddhism",
      type: "influences",
      source: "Learn/Buddhism.md",
    });
    expect(kb.data.connections).toHaveLength(1);
    expect(kb.data.connections[0]?.sources).toEqual([
      "Books/Watts.md",
      "Learn/Buddhism.md",
    ]);
  });

  it("creates separate connections when type differs", () => {
    const kb = new KnowledgeBase();
    kb.addConnection({
      from: "Alan Watts",
      to: "Zen Buddhism",
      type: "influences",
    });
    kb.addConnection({
      from: "Alan Watts",
      to: "Zen Buddhism",
      type: "uses",
    });
    expect(kb.data.connections).toHaveLength(2);
  });
});

describe("KnowledgeBase.markSource and needsExtraction", () => {
  it("records a source with origin, mtime, and contentHash", () => {
    const kb = new KnowledgeBase();
    kb.markSource({
      path: "Books/Watts.md",
      mtime: 1700000000,
      contentHash: "hash-v1",
      origin: "user-note",
      summary: "A book about insecurity",
    });
    const src = kb.data.sources["Books/Watts.md"];
    expect(src?.id).toBe("Books/Watts.md");
    expect(src?.mtime).toBe(1700000000);
    expect(src?.contentHash).toBe("hash-v1");
    expect(src?.origin).toBe("user-note");
    expect(src?.summary).toBe("A book about insecurity");
    expect(src?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("leaves contentHash undefined when markSource omits it (pre-migration path)", () => {
    const kb = new KnowledgeBase();
    kb.markSource({ path: "a.md", mtime: 1, origin: "user-note" });
    expect(kb.data.sources["a.md"]?.contentHash).toBeUndefined();
  });

  it("needsExtraction is true for an unknown path", () => {
    const kb = new KnowledgeBase();
    expect(kb.needsExtraction("Books/Watts.md", 1700000000, "h1")).toBe(true);
  });

  it("needsExtraction is false when stored contentHash matches (mtime ignored)", () => {
    const kb = new KnowledgeBase();
    kb.markSource({
      path: "Books/Watts.md",
      mtime: 1700000000,
      contentHash: "h1",
      origin: "user-note",
    });
    // Even a newer mtime does not trigger re-extraction when the hash matches.
    expect(
      kb.needsExtraction("Books/Watts.md", 1800000000, "h1"),
    ).toBe(false);
  });

  it("needsExtraction is true when stored contentHash differs (even at same mtime)", () => {
    const kb = new KnowledgeBase();
    kb.markSource({
      path: "Books/Watts.md",
      mtime: 1700000000,
      contentHash: "h1",
      origin: "user-note",
    });
    expect(
      kb.needsExtraction("Books/Watts.md", 1700000000, "h2"),
    ).toBe(true);
  });

  it("needsExtraction falls back to mtime when stored entry has no contentHash", () => {
    const kb = new KnowledgeBase();
    // Pre-migration entry: no contentHash recorded.
    kb.markSource({
      path: "Books/Watts.md",
      mtime: 1700000000,
      origin: "user-note",
    });
    expect(
      kb.needsExtraction("Books/Watts.md", 1700000000, "any"),
    ).toBe(false);
    expect(
      kb.needsExtraction("Books/Watts.md", 1700000001, "any"),
    ).toBe(true);
  });
});

describe("KnowledgeBase.backfillContentHash", () => {
  it("populates contentHash on a pre-migration entry and upgrades mtime", () => {
    const kb = new KnowledgeBase();
    kb.markSource({ path: "a.md", mtime: 1000, origin: "user-note" });
    expect(kb.data.sources["a.md"]?.contentHash).toBeUndefined();

    kb.backfillContentHash("a.md", "fresh-hash", 2000);
    expect(kb.data.sources["a.md"]?.contentHash).toBe("fresh-hash");
    expect(kb.data.sources["a.md"]?.mtime).toBe(2000);
  });

  it("refreshes an already-set hash to the current value", () => {
    const kb = new KnowledgeBase();
    kb.markSource({
      path: "a.md",
      mtime: 1000,
      contentHash: "old",
      origin: "user-note",
    });
    kb.backfillContentHash("a.md", "new", 2000);
    expect(kb.data.sources["a.md"]?.contentHash).toBe("new");
    expect(kb.data.sources["a.md"]?.mtime).toBe(2000);
  });

  it("is a no-op for an unknown path", () => {
    const kb = new KnowledgeBase();
    expect(() => kb.backfillContentHash("missing.md", "h", 1)).not.toThrow();
    expect(kb.data.sources["missing.md"]).toBeUndefined();
  });
});

describe("KnowledgeBase.removeSource", () => {
  it("removes the source record from sources", () => {
    const kb = new KnowledgeBase();
    kb.markSource({ path: "Books/Watts.md", mtime: 1700000000, origin: "user-note" });
    kb.removeSource("Books/Watts.md");
    expect(kb.data.sources["Books/Watts.md"]).toBeUndefined();
  });

  it("decrements source-count on entities by removing the source from their list", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["fact"],
      source: "Books/Watts.md",
    });
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["fact"],
      source: "Learn/Zen.md",
    });
    kb.markSource({ path: "Books/Watts.md", mtime: 1, origin: "user-note" });
    kb.removeSource("Books/Watts.md");
    expect(kb.data.entities["alan-watts"]?.sources).toEqual(["Learn/Zen.md"]);
  });

  it("deletes concept when its last source is removed", () => {
    const kb = new KnowledgeBase();
    kb.addConcept({ name: "Zen", definition: "x", source: "Books/Watts.md" });
    kb.markSource({ path: "Books/Watts.md", mtime: 1, origin: "user-note" });
    kb.removeSource("Books/Watts.md");
    expect(kb.data.concepts["zen"]).toBeUndefined();
  });

  it("deletes connection when its last source is removed", () => {
    const kb = new KnowledgeBase();
    kb.addConnection({
      from: "Alan Watts",
      to: "Zen",
      type: "influences",
      source: "Books/Watts.md",
    });
    kb.markSource({ path: "Books/Watts.md", mtime: 1, origin: "user-note" });
    kb.removeSource("Books/Watts.md");
    expect(kb.data.connections).toHaveLength(0);
  });

  it("deletes entity when its last source is removed", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Solo", type: "person", facts: ["f1"], source: "a.md" });
    kb.markSource({ path: "a.md", mtime: 1, origin: "user-note" });
    kb.removeSource("a.md");
    expect(kb.data.entities["solo"]).toBeUndefined();
  });

  it("does not throw if the source does not exist", () => {
    const kb = new KnowledgeBase();
    expect(() => kb.removeSource("nonexistent.md")).not.toThrow();
  });
});

describe("KnowledgeBase.getEntity and getConcept", () => {
  it("getEntity finds by canonical ID", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Alan Watts", type: "person" });
    expect(kb.getEntity("Alan Watts")?.id).toBe("alan-watts");
    expect(kb.getEntity("alan-watts")?.id).toBe("alan-watts");
  });

  it("getEntity finds by alias (case-insensitive)", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      aliases: ["A.W. Watts"],
    });
    expect(kb.getEntity("a.w. watts")?.id).toBe("alan-watts");
  });

  it("getEntity returns undefined for unknown name", () => {
    const kb = new KnowledgeBase();
    expect(kb.getEntity("nobody")).toBeUndefined();
  });

  it("getConcept finds by canonical ID", () => {
    const kb = new KnowledgeBase();
    kb.addConcept({ name: "Zen Buddhism", definition: "x" });
    expect(kb.getConcept("Zen Buddhism")?.id).toBe("zen-buddhism");
  });

  it("getConcept returns undefined for unknown name", () => {
    const kb = new KnowledgeBase();
    expect(kb.getConcept("nothing")).toBeUndefined();
  });
});

describe("KnowledgeBase.allEntities and allConcepts", () => {
  it("allEntities returns every stored entity", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Alan Watts", type: "person" });
    kb.addEntity({ name: "Andrej Karpathy", type: "person" });
    const all = kb.allEntities();
    expect(all).toHaveLength(2);
    const names = all.map((e) => e.name).sort();
    expect(names).toEqual(["Alan Watts", "Andrej Karpathy"]);
  });

  it("allConcepts returns every stored concept", () => {
    const kb = new KnowledgeBase();
    kb.addConcept({ name: "Zen", definition: "x" });
    kb.addConcept({ name: "Flow", definition: "y" });
    const all = kb.allConcepts();
    expect(all).toHaveLength(2);
    const names = all.map((c) => c.name).sort();
    expect(names).toEqual(["Flow", "Zen"]);
  });

  it("returns empty arrays when KB is empty", () => {
    const kb = new KnowledgeBase();
    expect(kb.allEntities()).toEqual([]);
    expect(kb.allConcepts()).toEqual([]);
  });
});

describe("KnowledgeBase.allConnections and allSources", () => {
  it("allConnections returns every stored connection", () => {
    const kb = new KnowledgeBase();
    kb.addConnection({ from: "Alan Watts", to: "Zen", type: "influences" });
    kb.addConnection({ from: "Zen", to: "Meditation", type: "related-to" });
    const conns = kb.allConnections();
    expect(conns).toHaveLength(2);
  });

  it("allSources returns every stored source record", () => {
    const kb = new KnowledgeBase();
    kb.markSource({ path: "Books/Watts.md", mtime: 1, origin: "user-note" });
    kb.markSource({ path: "Learn/Zen.md", mtime: 2, origin: "user-note" });
    const sources = kb.allSources();
    expect(sources).toHaveLength(2);
    const ids = sources.map((s) => s.id).sort();
    expect(ids).toEqual(["Books/Watts.md", "Learn/Zen.md"]);
  });

  it("returns empty arrays when KB is empty", () => {
    const kb = new KnowledgeBase();
    expect(kb.allConnections()).toEqual([]);
    expect(kb.allSources()).toEqual([]);
  });
});

describe("KnowledgeBase.connectionsFor and stats", () => {
  it("connectionsFor returns connections in either direction", () => {
    const kb = new KnowledgeBase();
    kb.addConnection({ from: "Alan Watts", to: "Zen", type: "influences" });
    kb.addConnection({ from: "Zen", to: "Alan Watts", type: "related-to" });
    kb.addConnection({ from: "Other", to: "Thing", type: "influences" });
    const conns = kb.connectionsFor("Alan Watts");
    expect(conns).toHaveLength(2);
  });

  it("stats reports counts", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Alan Watts", type: "person" });
    kb.addConcept({ name: "Zen", definition: "x" });
    kb.addConnection({ from: "Alan Watts", to: "Zen", type: "influences" });
    kb.markSource({ path: "Books/Watts.md", mtime: 1, origin: "user-note" });
    expect(kb.stats()).toEqual({
      entities: 1,
      concepts: 1,
      connections: 1,
      sources: 1,
    });
  });
});
