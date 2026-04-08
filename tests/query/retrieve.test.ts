import { describe, it, expect } from "vitest";
import { retrieve } from "../../src/query/retrieve.js";
import { KnowledgeBase } from "../../src/core/kb.js";

function buildSampleKB() {
  const kb = new KnowledgeBase();
  kb.addEntity({
    name: "Alan Watts",
    type: "person",
    aliases: ["Watts"],
    facts: [
      "British philosopher",
      "Wrote The Way of Zen",
      "Lectured on Eastern philosophy",
    ],
    source: "Books/Watts.md",
  });
  kb.addEntity({
    name: "Andrej Karpathy",
    type: "person",
    aliases: [],
    facts: ["AI researcher", "Stanford alum", "Wrote Software 2.0"],
    source: "Learn/Karpathy.md",
  });
  kb.addEntity({
    name: "exact name",
    type: "other",
    aliases: [],
    facts: ["should be hidden"],
    source: "x.md",
  });
  kb.addConcept({
    name: "Zen",
    definition: "A school of Mahayana Buddhism",
    related: ["meditation"],
    source: "Books/Watts.md",
  });
  return kb;
}

describe("retrieve", () => {
  it("returns Alan Watts on top for 'who is alan watts'", () => {
    const kb = buildSampleKB();
    const bundle = retrieve({ question: "who is Alan Watts", kb });
    expect(bundle.entities[0]?.name).toBe("Alan Watts");
    expect(bundle.queryType).toBe("entity_lookup");
  });

  it("never returns blacklisted entities", () => {
    const kb = buildSampleKB();
    const bundle = retrieve({ question: "exact name", kb });
    expect(bundle.entities.find((e) => e.name === "exact name")).toBeUndefined();
  });

  it("respects folder scope", () => {
    const kb = buildSampleKB();
    const bundle = retrieve({
      question: "philosopher",
      kb,
      folder: "Learn",
    });
    expect(bundle.entities.find((e) => e.name === "Alan Watts")).toBeUndefined();
  });

});
