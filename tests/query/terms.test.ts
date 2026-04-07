import { describe, it, expect } from "vitest";
import { extractQueryTerms } from "../../src/query/terms.js";

describe("extractQueryTerms", () => {
  it("lowercases and tokenizes a question", () => {
    expect(extractQueryTerms("Who is Alan Watts?")).toEqual(["alan", "watts"]);
  });

  it("drops common English stop words", () => {
    expect(extractQueryTerms("what is the meaning of zen")).toEqual([
      "meaning",
      "zen",
    ]);
  });

  it("dedupes while preserving order", () => {
    expect(extractQueryTerms("zen and zen and more zen")).toEqual([
      "zen",
      "more",
    ]);
  });

  it("strips punctuation", () => {
    expect(extractQueryTerms("Karpathy's videos, please!")).toEqual([
      "karpathy",
      "videos",
      "please",
    ]);
  });

  it("returns empty for empty input", () => {
    expect(extractQueryTerms("")).toEqual([]);
    expect(extractQueryTerms("   ")).toEqual([]);
  });
});
