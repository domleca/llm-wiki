import { describe, it, expect } from "vitest";
import { retrieve } from "../../src/query/retrieve.js";
import { KnowledgeBase } from "../../src/core/kb.js";

describe("retrieve — connection gathering (regression)", () => {
  it("returns connections that touch retrieved entities", () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      aliases: [],
      facts: ["British philosopher"],
      source: "x.md",
    });
    kb.addConcept({
      name: "Zen",
      definition: "Mahayana school",
      related: [],
      source: "x.md",
    });
    kb.addConnection({
      from: "Alan Watts",
      to: "Zen",
      type: "influences",
      description: "wrote about it",
      source: "x.md",
    });

    const bundle = retrieve({ question: "who is Alan Watts", kb });
    expect(bundle.entities.find((e) => e.name === "Alan Watts")).toBeDefined();
    expect(
      bundle.connections.find((c) => c.description === "wrote about it"),
    ).toBeDefined();
  });
});
