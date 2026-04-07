import { describe, it, expect } from "vitest";
import { formatContextMarkdown } from "../../src/query/format-context.js";
import type { RetrievedBundle } from "../../src/query/types.js";

const bundle: RetrievedBundle = {
  question: "who is Alan Watts",
  queryType: "entity_lookup",
  entities: [
    {
      id: "alan-watts",
      name: "Alan Watts",
      type: "person",
      aliases: ["Watts"],
      facts: ["British philosopher", "Wrote The Way of Zen"],
      sources: ["Books/Watts.md"],
    },
  ],
  concepts: [
    {
      id: "zen",
      name: "Zen",
      definition: "Mahayana school",
      related: [],
      sources: ["Books/Watts.md"],
    },
  ],
  connections: [
    {
      from: "Alan Watts",
      to: "Zen",
      type: "influences",
      description: "wrote about it",
      sources: ["Books/Watts.md"],
    },
  ],
  sources: [
    {
      id: "Books/Watts.md",
      summary: "Notes on Watts",
      date: "2026-01-01",
      mtime: 0,
      origin: "user-note",
    },
  ],
};

describe("formatContextMarkdown", () => {
  it("emits all four sections in order", () => {
    const md = formatContextMarkdown(bundle);
    const order = ["## ENTITIES", "## CONCEPTS", "## CONNECTIONS", "## SOURCE FILES"];
    let lastIdx = -1;
    for (const h of order) {
      const idx = md.indexOf(h);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("includes facts, aliases, and source paths", () => {
    const md = formatContextMarkdown(bundle);
    expect(md).toContain("Alan Watts");
    expect(md).toContain("Watts");
    expect(md).toContain("British philosopher");
    expect(md).toContain("Books/Watts.md");
    expect(md).toContain("Mahayana school");
  });

  it("omits empty sections", () => {
    const md = formatContextMarkdown({
      ...bundle,
      concepts: [],
      connections: [],
    });
    expect(md).not.toContain("## CONCEPTS");
    expect(md).not.toContain("## CONNECTIONS");
  });
});
