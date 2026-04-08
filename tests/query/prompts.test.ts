import { describe, it, expect } from "vitest";
import { buildAskPrompt } from "../../src/query/prompts.js";
import type { ChatTurn } from "../../src/chat/types.js";

describe("buildAskPrompt", () => {
  it("includes the question and context block", () => {
    const p = buildAskPrompt({
      question: "who is alan watts",
      context: "## ENTITIES\n### Alan Watts",
    });
    expect(p).toContain("who is alan watts");
    expect(p).toContain("Alan Watts");
  });

  it("contains the 9 numbered rules", () => {
    const p = buildAskPrompt({ question: "x", context: "y" });
    for (let i = 1; i <= 9; i++) {
      expect(p).toMatch(new RegExp(`(^|\\n)${i}\\.`));
    }
  });

  it("instructs the LLM to use only KB data", () => {
    const p = buildAskPrompt({ question: "x", context: "y" });
    expect(p.toLowerCase()).toContain("only");
    expect(p.toLowerCase()).toContain("knowledge");
  });
});

describe("buildAskPrompt with history", () => {
  const turn = (q: string, a: string): ChatTurn => ({
    question: q,
    answer: a,
    sourceIds: [],
    rewrittenQuery: null,
    createdAt: 0,
  });

  it("injects history between rules and context", () => {
    const out = buildAskPrompt({
      question: "and why?",
      context: "CTX",
      history: [turn("what is X?", "X is a thing.")],
    });
    expect(out).toContain("Conversation so far:");
    expect(out).toContain("[user] what is X?");
    expect(out).toContain("[assistant] X is a thing.");
    expect(out.indexOf("Question: and why?")).toBeGreaterThan(
      out.indexOf("[assistant]"),
    );
    expect(out.indexOf("Knowledge base context:")).toBeGreaterThan(
      out.indexOf("[assistant]"),
    );
  });

  it("omits the history block when history is empty or missing", () => {
    expect(buildAskPrompt({ question: "q", context: "c" })).not.toContain(
      "Conversation so far:",
    );
    expect(
      buildAskPrompt({ question: "q", context: "c", history: [] }),
    ).not.toContain("Conversation so far:");
  });
});
