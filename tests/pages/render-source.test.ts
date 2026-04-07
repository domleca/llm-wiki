import { describe, it, expect } from "vitest";
import { renderSourcePage } from "../../src/pages/render-source.js";
import type { SourceRecord, Entity, Concept } from "../../src/core/types.js";

const SOURCE: SourceRecord = {
  id: "Books/Watts.md",
  summary: "Notes on Watts' Wisdom of Insecurity",
  date: "2026-03-01",
  mtime: 1709251200,
  origin: "user-note",
};

const ENTITY: Entity = {
  id: "alan-watts",
  name: "Alan Watts",
  type: "person",
  aliases: [],
  facts: ["Wrote Wisdom of Insecurity"],
  sources: ["Books/Watts.md"],
};

const CONCEPT: Concept = {
  id: "zen-buddhism",
  name: "Zen Buddhism",
  definition: "Direct experience",
  related: [],
  sources: ["Books/Watts.md"],
};

describe("renderSourcePage", () => {
  it("starts with YAML frontmatter", () => {
    const md = renderSourcePage(SOURCE, [], []);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("\n---\n");
  });

  it("has a h1 title with the source path", () => {
    const md = renderSourcePage(SOURCE, [], []);
    expect(md).toContain("# Books/Watts.md");
  });

  it("includes the summary as a paragraph", () => {
    const md = renderSourcePage(SOURCE, [], []);
    expect(md).toContain("Notes on Watts' Wisdom of Insecurity");
  });

  it("lists related entities as wikilinks under ## Entities", () => {
    const md = renderSourcePage(SOURCE, [ENTITY], []);
    expect(md).toContain("## Entities");
    expect(md).toContain("[[alan-watts|Alan Watts]]");
  });

  it("lists related concepts as wikilinks under ## Concepts", () => {
    const md = renderSourcePage(SOURCE, [], [CONCEPT]);
    expect(md).toContain("## Concepts");
    expect(md).toContain("[[zen-buddhism|Zen Buddhism]]");
  });

  it("omits ## Entities when none reference this source", () => {
    const md = renderSourcePage(SOURCE, [], []);
    expect(md).not.toContain("## Entities");
  });

  it("omits ## Concepts when none reference this source", () => {
    const md = renderSourcePage(SOURCE, [], []);
    expect(md).not.toContain("## Concepts");
  });

  it("omits the summary paragraph when summary is empty", () => {
    const s = { ...SOURCE, summary: "" };
    const md = renderSourcePage(s, [], []);
    // after the closing --- and blank line, next thing should be the h1, not more content
    const afterFm = md.split("\n---\n")[1];
    expect(afterFm?.trimStart()).toMatch(/^# /);
  });

  it("output ends with a newline", () => {
    const md = renderSourcePage(SOURCE, [], []);
    expect(md.endsWith("\n")).toBe(true);
  });
});
