import { describe, it, expect } from "vitest";
import { generatePages, sourcePagePath } from "../../src/pages/generator.js";
import { KnowledgeBase } from "../../src/core/kb.js";
import { defaultFilterSettings } from "../../src/core/filters.js";
import { createMockApp } from "../helpers/mock-app.js";

function buildRichKb() {
  const kb = new KnowledgeBase();
  // alan-watts: 2 facts, 2 sources → passes entity filter
  kb.addEntity({ name: "Alan Watts", type: "person", facts: ["Fact 1", "Fact 2"], source: "Books/Watts.md" });
  kb.addEntity({ name: "Alan Watts", type: "person", source: "Learn/Zen.md" });
  // lonely: 1 fact, 1 source → fails entity filter
  kb.addEntity({ name: "Lonely Entity", type: "person", facts: ["Only fact"], source: "notes/a.md" });
  // zen-buddhism: has definition → passes concept filter
  kb.addConcept({ name: "Zen Buddhism", definition: "Direct experience", source: "Books/Watts.md" });
  // address-book: blacklisted → fails concept filter
  kb.addConcept({ name: "Address Book", definition: "", source: "notes/b.md" });
  // sources
  kb.markSource({ path: "Books/Watts.md", mtime: 1, origin: "user-note", summary: "Watts notes" });
  kb.markSource({ path: "Learn/Zen.md", mtime: 2, origin: "user-note", summary: "Zen notes" });
  kb.markSource({ path: "notes/a.md", mtime: 3, origin: "user-note", summary: "" });
  return kb;
}

describe("generatePages", () => {
  it("writes entity pages only for quality entities", async () => {
    const { app, files } = createMockApp();
    await generatePages(app as never, buildRichKb(), defaultFilterSettings());
    expect(files.has("wiki/entities/alan-watts.md")).toBe(true);
    expect(files.has("wiki/entities/lonely-entity.md")).toBe(false);
  });

  it("writes concept pages only for quality concepts", async () => {
    const { app, files } = createMockApp();
    await generatePages(app as never, buildRichKb(), defaultFilterSettings());
    expect(files.has("wiki/concepts/zen-buddhism.md")).toBe(true);
    expect(files.has("wiki/concepts/address-book.md")).toBe(false);
  });

  it("writes a source page for every source", async () => {
    const { app, files } = createMockApp();
    await generatePages(app as never, buildRichKb(), defaultFilterSettings());
    expect(files.has("wiki/sources/Books/Watts.md")).toBe(true);
    expect(files.has("wiki/sources/Learn/Zen.md")).toBe(true);
    expect(files.has("wiki/sources/notes/a.md")).toBe(true);
  });

  it("returns correct written count", async () => {
    const { app } = createMockApp();
    const result = await generatePages(app as never, buildRichKb(), defaultFilterSettings());
    // 1 entity + 1 concept + 3 sources = 5
    expect(result.written).toBe(5);
  });

  it("deletes stale entity pages after regeneration", async () => {
    const { app, files } = createMockApp();
    // pre-seed a stale entity page
    files.set("wiki/entities/old-entity.md", {
      path: "wiki/entities/old-entity.md",
      content: "old",
      mtime: 0,
      ctime: 0,
    });
    const result = await generatePages(app as never, buildRichKb(), defaultFilterSettings());
    expect(files.has("wiki/entities/old-entity.md")).toBe(false);
    expect(result.deleted).toBe(1);
  });

  it("entity page content contains the entity name", async () => {
    const { app, files } = createMockApp();
    await generatePages(app as never, buildRichKb(), defaultFilterSettings());
    const content = files.get("wiki/entities/alan-watts.md")!.content;
    expect(content).toContain("Alan Watts");
  });
});

describe("sourcePagePath", () => {
  it("maps a flat source path", () => {
    expect(sourcePagePath("notes.md")).toBe("wiki/sources/notes.md");
  });

  it("maps a nested source path preserving folder structure", () => {
    expect(sourcePagePath("Books/Watts.md")).toBe("wiki/sources/Books/Watts.md");
  });
});
