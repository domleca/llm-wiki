import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";

describe("KnowledgeBase.renameSource", () => {
  function buildKb() {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      facts: ["Fact 1"],
      source: "old/watts.md",
    });
    kb.addConcept({
      name: "Zen",
      definition: "Direct experience",
      source: "old/watts.md",
    });
    kb.addConnection({
      from: "Alan Watts",
      to: "Zen",
      type: "influences",
      source: "old/watts.md",
    });
    kb.markSource({
      path: "old/watts.md",
      mtime: 100,
      origin: "user-note",
      summary: "Notes",
    });
    return kb;
  }

  it("updates the source record key to the new path", () => {
    const kb = buildKb();
    kb.renameSource("old/watts.md", "new/watts.md");
    expect(kb.data.sources["new/watts.md"]).toBeDefined();
    expect(kb.data.sources["old/watts.md"]).toBeUndefined();
  });

  it("updates source id field inside the source record", () => {
    const kb = buildKb();
    kb.renameSource("old/watts.md", "new/watts.md");
    expect(kb.data.sources["new/watts.md"]!.id).toBe("new/watts.md");
  });

  it("updates entity sources arrays", () => {
    const kb = buildKb();
    kb.renameSource("old/watts.md", "new/watts.md");
    expect(kb.data.entities["alan-watts"]!.sources).toContain("new/watts.md");
    expect(kb.data.entities["alan-watts"]!.sources).not.toContain("old/watts.md");
  });

  it("updates concept sources arrays", () => {
    const kb = buildKb();
    kb.renameSource("old/watts.md", "new/watts.md");
    expect(kb.data.concepts["zen"]!.sources).toContain("new/watts.md");
    expect(kb.data.concepts["zen"]!.sources).not.toContain("old/watts.md");
  });

  it("updates connection sources arrays", () => {
    const kb = buildKb();
    kb.renameSource("old/watts.md", "new/watts.md");
    expect(kb.data.connections[0]!.sources).toContain("new/watts.md");
    expect(kb.data.connections[0]!.sources).not.toContain("old/watts.md");
  });

  it("is a no-op when oldPath does not exist", () => {
    const kb = buildKb();
    kb.renameSource("nonexistent.md", "new.md");
    expect(Object.keys(kb.data.sources)).toEqual(["old/watts.md"]);
  });
});
