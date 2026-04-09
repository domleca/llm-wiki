import { describe, it } from "vitest";
import * as fc from "fast-check";
import {
  entityFrontmatter,
  conceptFrontmatter,
  sourceFrontmatter,
} from "../../src/pages/frontmatter.js";
import { validateBasesFrontmatter } from "../helpers/validate-bases.js";
import type { Entity, Concept, SourceRecord } from "../../src/core/types.js";

const entityTypeArb = fc.constantFrom(
  "person" as const,
  "org" as const,
  "tool" as const,
  "project" as const,
  "book" as const,
  "article" as const,
  "place" as const,
  "event" as const,
  "other" as const,
);

const originArb = fc.constantFrom(
  "user-note" as const,
  "promoted" as const,
  "daily" as const,
);

const entityArb: fc.Arbitrary<Entity> = fc.record({
  id: fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/),
  name: fc.string({ minLength: 1, maxLength: 80 }),
  type: entityTypeArb,
  aliases: fc.array(fc.string({ minLength: 1, maxLength: 40 }), {
    maxLength: 5,
  }),
  facts: fc.array(fc.string({ minLength: 1, maxLength: 100 }), {
    maxLength: 10,
  }),
  sources: fc.array(fc.string({ minLength: 1, maxLength: 60 }), {
    maxLength: 5,
  }),
});

const conceptArb: fc.Arbitrary<Concept> = fc.record({
  id: fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/),
  name: fc.string({ minLength: 1, maxLength: 80 }),
  definition: fc.string({ maxLength: 200 }),
  related: fc.array(fc.string({ minLength: 1, maxLength: 60 }), {
    maxLength: 5,
  }),
  sources: fc.array(fc.string({ minLength: 1, maxLength: 60 }), {
    maxLength: 5,
  }),
});

const sourceArb: fc.Arbitrary<SourceRecord> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 80 }),
  summary: fc.string({ maxLength: 200 }),
  date: fc
    .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31") })
    .map((d) => d.toISOString().slice(0, 10)),
  mtime: fc.integer({ min: 0 }),
  origin: originArb,
});

describe("entityFrontmatter property", () => {
  it("always produces Bases-valid output for arbitrary entities", () => {
    fc.assert(
      fc.property(entityArb, (entity) => {
        const fm = entityFrontmatter(entity, "2026-04-07");
        const errors = validateBasesFrontmatter(fm);
        if (errors.length > 0) {
          throw new Error(
            `Bases errors for entity "${entity.name}": ${errors.join(", ")}`,
          );
        }
      }),
    );
  });
});

describe("conceptFrontmatter property", () => {
  it("always produces Bases-valid output for arbitrary concepts", () => {
    fc.assert(
      fc.property(conceptArb, (concept) => {
        const fm = conceptFrontmatter(concept, "2026-04-07");
        const errors = validateBasesFrontmatter(fm);
        if (errors.length > 0) {
          throw new Error(
            `Bases errors for concept "${concept.name}": ${errors.join(", ")}`,
          );
        }
      }),
    );
  });
});

describe("sourceFrontmatter property", () => {
  it("always produces Bases-valid output for arbitrary sources", () => {
    fc.assert(
      fc.property(sourceArb, (source) => {
        const fm = sourceFrontmatter(source);
        const errors = validateBasesFrontmatter(fm);
        if (errors.length > 0) {
          throw new Error(
            `Bases errors for source "${source.id}": ${errors.join(", ")}`,
          );
        }
      }),
    );
  });
});
