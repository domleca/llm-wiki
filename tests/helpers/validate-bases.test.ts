import { describe, it, expect } from "vitest";
import { validateBasesFrontmatter } from "./validate-bases.js";

describe("validateBasesFrontmatter", () => {
  it("accepts a valid entity frontmatter object", () => {
    const errors = validateBasesFrontmatter({
      type: "entity",
      "entity-type": "person",
      "date-created": "2026-04-07",
      "date-updated": "2026-04-07",
      "source-count": 3,
      tags: ["philosophy"],
    });
    expect(errors).toEqual([]);
  });

  it("rejects nested objects", () => {
    const errors = validateBasesFrontmatter({
      type: "entity",
      source: { url: "https://example.com" },
    });
    expect(errors).toContain("Field 'source' is a nested object — flatten it.");
  });

  it("rejects strings where dates are expected", () => {
    const errors = validateBasesFrontmatter({
      type: "entity",
      "date-created": "April 7, 2026",
    });
    expect(
      errors.some((e) => e.includes("'date-created' must match")),
    ).toBe(true);
  });

  it("rejects quoted integer source-count", () => {
    const errors = validateBasesFrontmatter({
      type: "entity",
      "source-count": "3",
    });
    expect(errors).toContain(
      "Field 'source-count' must be an integer, got string",
    );
  });

  it("rejects scalar tags", () => {
    const errors = validateBasesFrontmatter({
      type: "entity",
      tags: "philosophy",
    });
    expect(errors).toContain(
      "Field 'tags' must be a list, got string. Use [] for empty.",
    );
  });

  it("rejects deprecated key names", () => {
    const errors = validateBasesFrontmatter({
      type: "entity",
      tag: ["philosophy"],
    });
    expect(errors).toContain(
      "Key 'tag' is deprecated — use 'tags' (always a list).",
    );
  });

  it("rejects null on a list-typed field", () => {
    const errors = validateBasesFrontmatter({
      type: "entity",
      tags: null,
    });
    expect(errors).toContain(
      "Field 'tags' must be a list, got null. Use [] for empty.",
    );
  });
});
