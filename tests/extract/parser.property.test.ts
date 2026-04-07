import { describe, it } from "vitest";
import fc from "fast-check";
import { parseExtraction } from "../../src/extract/parser.js";

describe("parseExtraction — property invariants", () => {
  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseExtraction(s);
      }),
      { numRuns: 500 },
    );
  });

  it("returns null or a fully-shaped object — never a partial", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseExtraction(s);
        if (r === null) return;
        if (typeof r.source_summary !== "string") {
          throw new Error("source_summary not string");
        }
        if (!Array.isArray(r.entities)) throw new Error("entities not array");
        if (!Array.isArray(r.concepts)) throw new Error("concepts not array");
        if (!Array.isArray(r.connections)) {
          throw new Error("connections not array");
        }
      }),
      { numRuns: 500 },
    );
  });
});
