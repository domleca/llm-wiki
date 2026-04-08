import { describe, it, expect } from "vitest";
import {
  budgetHistory,
  approximateTokens,
} from "../../src/chat/history-budget.js";
import type { ChatTurn } from "../../src/chat/types.js";

const turn = (q: string, a: string): ChatTurn => ({
  question: q,
  answer: a,
  sourceIds: [],
  rewrittenQuery: null,
  createdAt: 0,
});

describe("approximateTokens", () => {
  it("is ceil(chars/4)", () => {
    expect(approximateTokens("")).toBe(0);
    expect(approximateTokens("abcd")).toBe(1);
    expect(approximateTokens("abcde")).toBe(2);
  });
});

describe("budgetHistory", () => {
  it("keeps all turns when within budget", () => {
    const turns = [turn("a", "b"), turn("c", "d")];
    expect(budgetHistory(turns, { availableTokens: 1000 })).toEqual(turns);
  });

  it("drops oldest first until under budget", () => {
    const turns = [
      turn("a".repeat(400), "b".repeat(400)),
      turn("c".repeat(400), "d".repeat(400)),
      turn("e".repeat(400), "f".repeat(400)),
    ];
    const kept = budgetHistory(turns, { availableTokens: 300 });
    expect(kept).toEqual([turns[2]]);
  });

  it("returns empty when budget is zero", () => {
    expect(budgetHistory([turn("a", "b")], { availableTokens: 0 })).toEqual([]);
  });

  it("does not mutate input", () => {
    const turns = [turn("a", "b"), turn("c", "d")];
    const snapshot = [...turns];
    budgetHistory(turns, { availableTokens: 5 });
    expect(turns).toEqual(snapshot);
  });
});
