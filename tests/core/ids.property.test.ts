import { describe, it } from "vitest";
import * as fc from "fast-check";
import { makeId } from "../../src/core/ids.js";

describe("makeId — invariants", () => {
  it("always returns lowercase, [a-z0-9-] only, no leading/trailing/double hyphens", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (input) => {
        const id = makeId(input);
        // Allow empty string output (e.g. input was all punctuation)
        if (id.length === 0) return true;
        return (
          /^[a-z0-9-]+$/.test(id) &&
          !id.startsWith("-") &&
          !id.endsWith("-") &&
          !id.includes("--")
        );
      }),
    );
  });

  it("is idempotent: makeId(makeId(x)) === makeId(x)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (input) => {
        const once = makeId(input);
        const twice = makeId(once);
        return once === twice;
      }),
    );
  });
});
