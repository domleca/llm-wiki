import { describe, it, expect } from "vitest";
import {
  entityFrontmatter,
  conceptFrontmatter,
  sourceFrontmatter,
  serializeFrontmatter,
} from "../../src/pages/frontmatter.js";
import { validateBasesFrontmatter } from "../helpers/validate-bases.js";
import type { Entity, Concept, SourceRecord } from "../../src/core/types.js";

const TODAY = "2026-04-07";

const ENTITY: Entity = {
  id: "alan-watts",
  name: "Alan Watts",
  type: "person",
  aliases: ["A.W. Watts"],
  facts: ["Wrote The Wisdom of Insecurity", "Popularized Zen in the West"],
  sources: ["Books/Watts.md", "Learn/Zen.md"],
};

const CONCEPT: Concept = {
  id: "zen-buddhism",
  name: "Zen Buddhism",
  definition: "Direct experience over scriptural study",
  related: ["Alan Watts"],
  sources: ["Books/Watts.md", "Learn/Zen.md"],
};

const SOURCE: SourceRecord = {
  id: "Books/Watts.md",
  summary: "Notes on Watts' Wisdom of Insecurity",
  date: "2026-03-01",
  mtime: 1709251200,
  origin: "user-note",
};

describe("entityFrontmatter", () => {
  it("passes Bases validation", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(validateBasesFrontmatter(fm)).toEqual([]);
  });

  it("sets type to entity", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(fm["type"]).toBe("entity");
  });

  it("sets entity-type to the entity's type", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(fm["entity-type"]).toBe("person");
  });

  it("sets aliases as a list", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(fm["aliases"]).toEqual(["A.W. Watts"]);
  });

  it("sets tags as a list containing llm-wiki/entity and entity-type tag", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(fm["tags"]).toEqual(["llm-wiki/entity", "llm-wiki/entity/person"]);
  });

  it("sets source-count as an integer", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(fm["source-count"]).toBe(2);
  });

  it("sets date-updated to TODAY", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(fm["date-updated"]).toBe(TODAY);
  });

  it("sets cssclasses to empty list", () => {
    const fm = entityFrontmatter(ENTITY, TODAY);
    expect(fm["cssclasses"]).toEqual([]);
  });

  it("handles entity with no aliases", () => {
    const e = { ...ENTITY, aliases: [] };
    const fm = entityFrontmatter(e, TODAY);
    expect(fm["aliases"]).toEqual([]);
    expect(validateBasesFrontmatter(fm)).toEqual([]);
  });
});

describe("conceptFrontmatter", () => {
  it("passes Bases validation", () => {
    const fm = conceptFrontmatter(CONCEPT, TODAY);
    expect(validateBasesFrontmatter(fm)).toEqual([]);
  });

  it("sets type to concept", () => {
    const fm = conceptFrontmatter(CONCEPT, TODAY);
    expect(fm["type"]).toBe("concept");
  });

  it("sets source-count as an integer", () => {
    const fm = conceptFrontmatter(CONCEPT, TODAY);
    expect(fm["source-count"]).toBe(2);
  });

  it("sets tags as a list", () => {
    const fm = conceptFrontmatter(CONCEPT, TODAY);
    expect(fm["tags"]).toEqual(["llm-wiki/concept"]);
  });

  it("sets aliases to empty list", () => {
    const fm = conceptFrontmatter(CONCEPT, TODAY);
    expect(fm["aliases"]).toEqual([]);
  });

  it("sets cssclasses to empty list", () => {
    const fm = conceptFrontmatter(CONCEPT, TODAY);
    expect(fm["cssclasses"]).toEqual([]);
  });

  it("sets date-updated to TODAY", () => {
    const fm = conceptFrontmatter(CONCEPT, TODAY);
    expect(fm["date-updated"]).toBe(TODAY);
  });
});

describe("sourceFrontmatter", () => {
  it("passes Bases validation", () => {
    const fm = sourceFrontmatter(SOURCE);
    expect(validateBasesFrontmatter(fm)).toEqual([]);
  });

  it("sets type to source", () => {
    const fm = sourceFrontmatter(SOURCE);
    expect(fm["type"]).toBe("source");
  });

  it("sets origin", () => {
    const fm = sourceFrontmatter(SOURCE);
    expect(fm["origin"]).toBe("user-note");
  });

  it("sets date field (ISO, not date-updated)", () => {
    const fm = sourceFrontmatter(SOURCE);
    expect(fm["date"]).toBe("2026-03-01");
  });

  it("sets tags as a list", () => {
    const fm = sourceFrontmatter(SOURCE);
    expect(fm["tags"]).toEqual(["llm-wiki/source"]);
  });

  it("sets aliases to empty list", () => {
    const fm = sourceFrontmatter(SOURCE);
    expect(fm["aliases"]).toEqual([]);
  });

  it("sets cssclasses to empty list", () => {
    const fm = sourceFrontmatter(SOURCE);
    expect(fm["cssclasses"]).toEqual([]);
  });
});

describe("serializeFrontmatter", () => {
  it("wraps output in --- delimiters", () => {
    const yaml = serializeFrontmatter({ type: "entity" });
    expect(yaml).toMatch(/^---\n/);
    expect(yaml).toMatch(/\n---\n$/);
  });

  it("serializes string values", () => {
    const yaml = serializeFrontmatter({ name: "Alan Watts" });
    expect(yaml).toContain("name: Alan Watts");
  });

  it("serializes empty array as []", () => {
    const yaml = serializeFrontmatter({ cssclasses: [] });
    expect(yaml).toContain("cssclasses: []");
  });

  it("serializes non-empty array as YAML list", () => {
    const yaml = serializeFrontmatter({ tags: ["a", "b"] });
    expect(yaml).toContain("tags:\n  - a\n  - b");
  });

  it("serializes integer values", () => {
    const yaml = serializeFrontmatter({ "source-count": 3 });
    expect(yaml).toContain("source-count: 3");
  });

  it("quotes string values containing colons", () => {
    const yaml = serializeFrontmatter({ name: "React: A Deep Dive" });
    expect(yaml).toContain('name: "React: A Deep Dive"');
  });

  it("defaults today to current ISO date when not provided", () => {
    const fm = entityFrontmatter(ENTITY);
    const expected = new Date().toISOString().slice(0, 10);
    expect(fm["date-updated"]).toBe(expected);
  });
});
