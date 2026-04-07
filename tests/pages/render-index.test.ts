import { describe, it, expect } from "vitest";
import { renderIndexPage } from "../../src/pages/render-index.js";
import { KnowledgeBase } from "../../src/core/kb.js";
import { defaultFilterSettings } from "../../src/core/filters.js";

function buildKb() {
  const kb = new KnowledgeBase();
  // Alan Watts: 2 facts after merge (2 calls same entity), 2 sources → passes filter
  kb.addEntity({
    name: "Alan Watts",
    type: "person",
    facts: ["Fact 1", "Fact 2"],
    source: "Books/Watts.md",
  });
  kb.addEntity({
    name: "Alan Watts",
    type: "person",
    source: "Learn/Zen.md",
  });
  // Lonely Entity: 1 fact, 1 source → fails filter
  kb.addEntity({
    name: "Lonely Entity",
    type: "person",
    facts: ["Only fact"],
    source: "notes/a.md",
  });
  // Zen Buddhism: has definition → passes concept filter
  kb.addConcept({
    name: "Zen Buddhism",
    definition: "Direct experience",
    source: "Books/Watts.md",
  });
  // Source record
  kb.markSource({
    path: "Books/Watts.md",
    mtime: 1709251200,
    origin: "user-note",
    summary: "",
  });
  return kb;
}

describe("renderIndexPage", () => {
  it("contains a # LLM Wiki Index heading", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("# LLM Wiki Index");
  });

  it("includes the generated date", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("2026-04-07");
  });

  it("lists only quality entities under ## Entities", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("## Entities");
    expect(md).toContain("Alan Watts");
    expect(md).not.toContain("Lonely Entity");
  });

  it("shows entity count in heading", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toMatch(/## Entities \(1\)/);
  });

  it("lists quality concepts under ## Concepts", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("## Concepts");
    expect(md).toContain("Zen Buddhism");
  });

  it("lists all sources under ## Sources", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("## Sources");
    expect(md).toContain("Books/Watts.md");
  });

  it("entity wikilinks point to wiki/entities/ path", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("[[entities/alan-watts|Alan Watts]]");
  });

  it("concept wikilinks point to wiki/concepts/ path", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("[[concepts/zen-buddhism|Zen Buddhism]]");
  });

  it("source wikilinks point to wiki/sources/ path", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md).toContain("[[sources/Books/Watts.md|Books/Watts.md]]");
  });

  it("output ends with a newline", () => {
    const md = renderIndexPage(buildKb(), defaultFilterSettings(), "2026-04-07");
    expect(md.endsWith("\n")).toBe(true);
  });
});
