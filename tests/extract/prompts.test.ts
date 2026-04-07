import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "../../src/extract/prompts.js";

describe("buildExtractionPrompt", () => {
  it("substitutes vocabulary, source path, and content", () => {
    const out = buildExtractionPrompt({
      vocabulary: "=== KNOWN ENTITIES ===\n- [person] Alan Watts",
      sourcePath: "Books/watts.md",
      content: "Alan Watts wrote The Wisdom of Insecurity.",
    });
    expect(out).toContain("=== KNOWN ENTITIES ===");
    expect(out).toContain("- [person] Alan Watts");
    expect(out).toContain("DOCUMENT (Books/watts.md):");
    expect(out).toContain("Alan Watts wrote The Wisdom of Insecurity.");
    expect(out).toContain("RULES:");
    expect(out).toContain("JSON object, no markdown fences");
    expect(out).toContain("source_summary");
    expect(out).toContain("entities");
    expect(out).toContain("concepts");
    expect(out).toContain("connections");
  });

  it("does not leave unsubstituted placeholders", () => {
    const out = buildExtractionPrompt({
      vocabulary: "(empty)",
      sourcePath: "x.md",
      content: "body",
    });
    expect(out).not.toMatch(/\{vocabulary\}|\{source_path\}|\{content\}/);
  });
});
