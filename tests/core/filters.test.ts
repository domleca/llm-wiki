import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isQualityEntity,
  isQualityConcept,
} from "../../src/core/filters.js";
import type { Entity, Concept, KBData } from "../../src/core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "../fixtures/sample-kb.json");
const fixture: KBData = JSON.parse(readFileSync(fixturePath, "utf-8"));

const baseEntity: Entity = {
  id: "alan-watts",
  name: "Alan Watts",
  type: "person",
  aliases: [],
  facts: ["Author of Wisdom of Insecurity", "Master of reversed effort"],
  sources: ["Books/Watts.md", "Learn/Zen.md"],
};

const baseConcept: Concept = {
  id: "zen-buddhism",
  name: "Zen Buddhism",
  definition: "The practice of direct experience",
  related: ["Alan Watts"],
  sources: ["Books/Watts.md"],
};

describe("isQualityEntity", () => {
  it("accepts an entity with enough facts and sources", () => {
    expect(isQualityEntity(baseEntity)).toBe(true);
  });

  it("rejects an entity with too few facts", () => {
    expect(isQualityEntity({ ...baseEntity, facts: ["only one"] })).toBe(
      false,
    );
  });

  it("rejects an entity with too few sources", () => {
    expect(isQualityEntity({ ...baseEntity, sources: ["one.md"] })).toBe(
      false,
    );
  });

  it("rejects a blacklisted name", () => {
    expect(isQualityEntity({ ...baseEntity, name: "Exact Name" })).toBe(
      false,
    );
  });

  it("rejects an entity with no facts and no aliases", () => {
    expect(isQualityEntity({ ...baseEntity, facts: [], aliases: [] })).toBe(
      false,
    );
  });
});

describe("isQualityConcept", () => {
  it("accepts a concept with a definition and sources", () => {
    expect(isQualityConcept(baseConcept)).toBe(true);
  });

  it("rejects a blacklisted name", () => {
    expect(isQualityConcept({ ...baseConcept, name: "Address Book" })).toBe(
      false,
    );
  });

  it("rejects a concept with no definition", () => {
    expect(isQualityConcept({ ...baseConcept, definition: "" })).toBe(false);
  });
});

describe("filters against sample-kb fixture", () => {
  it("accepts the high-quality entities", () => {
    expect(isQualityEntity(fixture.entities["alan-watts"]!)).toBe(true);
    expect(isQualityEntity(fixture.entities["andrej-karpathy"]!)).toBe(true);
  });

  it("rejects the noise entities", () => {
    expect(isQualityEntity(fixture.entities["exact-name"]!)).toBe(false);
    expect(isQualityEntity(fixture.entities["lonely-entity"]!)).toBe(false);
  });

  it("accepts the high-quality concepts", () => {
    expect(isQualityConcept(fixture.concepts["zen-buddhism"]!)).toBe(true);
    expect(isQualityConcept(fixture.concepts["law-of-reversed-effort"]!)).toBe(
      true,
    );
  });

  it("rejects the noise concept", () => {
    expect(isQualityConcept(fixture.concepts["address-book"]!)).toBe(false);
  });

  it("after filtering, sample-kb yields exactly 2 entities and 2 concepts", () => {
    const goodEntities = Object.values(fixture.entities).filter((e) =>
      isQualityEntity(e),
    );
    const goodConcepts = Object.values(fixture.concepts).filter((c) =>
      isQualityConcept(c),
    );
    expect(goodEntities).toHaveLength(2);
    expect(goodConcepts).toHaveLength(2);
  });
});
