import { describe, it, expect } from "vitest";
import { buildAskPrompt } from "../../src/query/prompts.js";

describe("buildAskPrompt", () => {
  it("includes the question and context block", () => {
    const p = buildAskPrompt({
      question: "who is alan watts",
      context: "## ENTITIES\n### Alan Watts",
    });
    expect(p).toContain("who is alan watts");
    expect(p).toContain("Alan Watts");
  });

  it("contains the 8 numbered rules", () => {
    const p = buildAskPrompt({ question: "x", context: "y" });
    for (let i = 1; i <= 8; i++) {
      expect(p).toMatch(new RegExp(`(^|\\n)${i}\\.`));
    }
  });

  it("instructs the LLM to use only KB data", () => {
    const p = buildAskPrompt({ question: "x", context: "y" });
    expect(p.toLowerCase()).toContain("only");
    expect(p.toLowerCase()).toContain("knowledge");
  });
});
