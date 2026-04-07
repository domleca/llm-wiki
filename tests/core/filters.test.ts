import { describe, it, expect } from "vitest";
import {
  defaultFilterSettings,
  isQualityEntity,
  isQualityConcept,
  type FilterSettings,
} from "../../src/core/filters.js";
import type { Entity, Concept } from "../../src/core/types.js";

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
  const settings = defaultFilterSettings();

  it("accepts an entity with enough facts and sources", () => {
    expect(isQualityEntity(baseEntity, settings)).toBe(true);
  });

  it("rejects an entity with too few facts", () => {
    expect(
      isQualityEntity({ ...baseEntity, facts: ["only one"] }, settings),
    ).toBe(false);
  });

  it("rejects an entity with too few sources", () => {
    expect(
      isQualityEntity({ ...baseEntity, sources: ["one.md"] }, settings),
    ).toBe(false);
  });

  it("rejects a blacklisted name", () => {
    expect(
      isQualityEntity({ ...baseEntity, name: "Exact Name" }, settings),
    ).toBe(false);
  });

  it("rejects an entity with no facts and no aliases", () => {
    expect(
      isQualityEntity({ ...baseEntity, facts: [], aliases: [] }, settings),
    ).toBe(false);
  });

  it("respects custom thresholds", () => {
    const strict: FilterSettings = {
      ...defaultFilterSettings(),
      minFactsPerEntity: 5,
    };
    expect(isQualityEntity(baseEntity, strict)).toBe(false);
  });
});

describe("isQualityConcept", () => {
  const settings = defaultFilterSettings();

  it("accepts a concept with a definition and sources", () => {
    expect(isQualityConcept(baseConcept, settings)).toBe(true);
  });

  it("rejects a blacklisted name", () => {
    expect(
      isQualityConcept({ ...baseConcept, name: "Address Book" }, settings),
    ).toBe(false);
  });

  it("rejects a concept with no definition", () => {
    expect(
      isQualityConcept({ ...baseConcept, definition: "" }, settings),
    ).toBe(false);
  });
});

describe("defaultFilterSettings", () => {
  it("matches the spec defaults", () => {
    const s = defaultFilterSettings();
    expect(s.minFactsPerEntity).toBe(2);
    expect(s.minSourcesPerEntity).toBe(2);
    expect(s.skipClippingOnly).toBe(true);
  });
});
