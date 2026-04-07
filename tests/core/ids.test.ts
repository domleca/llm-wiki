import { describe, it, expect } from "vitest";
import { makeId } from "../../src/core/ids.js";

describe("makeId", () => {
  it("converts a simple name to lowercase slug", () => {
    expect(makeId("Alan Watts")).toBe("alan-watts");
  });

  it("collapses multiple whitespace into a single hyphen", () => {
    expect(makeId("Alan   Watts")).toBe("alan-watts");
  });

  it("strips leading and trailing whitespace", () => {
    expect(makeId("  Alan Watts  ")).toBe("alan-watts");
  });

  it("preserves existing hyphens", () => {
    expect(makeId("Retrieval-Augmented Generation")).toBe(
      "retrieval-augmented-generation",
    );
  });

  it("strips punctuation", () => {
    expect(makeId("D.T. Suzuki")).toBe("dt-suzuki");
  });

  it("handles digits", () => {
    expect(makeId("GPT 4")).toBe("gpt-4");
  });
});
