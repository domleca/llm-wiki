import { describe, it, expect } from "vitest";
import {
  contextualTextForEntity,
  contextualTextForConcept,
} from "../../src/query/embedding-text.js";
import type { Entity, Concept } from "../../src/core/types.js";

describe("contextualTextForEntity", () => {
  it("includes type, name, aliases, and facts", () => {
    const e: Entity = {
      id: "alan-watts",
      name: "Alan Watts",
      type: "person",
      aliases: ["Watts"],
      facts: ["British philosopher", "Wrote The Way of Zen"],
      sources: ["x.md"],
    };
    const text = contextualTextForEntity(e);
    expect(text).toContain("Entity [person]");
    expect(text).toContain("Alan Watts");
    expect(text).toContain("Watts");
    expect(text).toContain("British philosopher");
  });

  it("caps facts at 5", () => {
    const e: Entity = {
      id: "x",
      name: "X",
      type: "other",
      aliases: [],
      facts: ["a", "b", "c", "d", "e", "f", "g"],
      sources: [],
    };
    const text = contextualTextForEntity(e);
    expect(text).toContain("a");
    expect(text).toContain("e");
    expect(text).not.toContain("f");
  });

  it("omits aliases line when none", () => {
    const e: Entity = {
      id: "x",
      name: "X",
      type: "other",
      aliases: [],
      facts: ["fact"],
      sources: [],
    };
    expect(contextualTextForEntity(e)).not.toContain("Also known as");
  });
});

describe("contextualTextForConcept", () => {
  it("includes name, definition, and related", () => {
    const c: Concept = {
      id: "zen",
      name: "Zen",
      definition: "A school of Mahayana Buddhism".repeat(20),
      related: ["meditation", "koan"],
      sources: ["x.md"],
    };
    const text = contextualTextForConcept(c);
    expect(text).toContain("Concept: Zen");
    expect(text).toContain("Mahayana");
    expect(text).toContain("meditation");
  });

  it("truncates definition at 200 chars", () => {
    const c: Concept = {
      id: "x",
      name: "X",
      definition: "a".repeat(500),
      related: [],
      sources: [],
    };
    const text = contextualTextForConcept(c);
    const defChars = text.match(/a+/g)?.[0]?.length ?? 0;
    expect(defChars).toBeLessThanOrEqual(200);
  });
});
