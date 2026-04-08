import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChat, appendTurn } from "../../src/chat/store.js";
import { rewriteFollowUp } from "../../src/chat/rewrite.js";
import { budgetHistory } from "../../src/chat/history-budget.js";
import {
  getModelContextWindow,
  _resetModelContextCache,
} from "../../src/chat/model-context.js";
import type { LLMProvider } from "../../src/llm/provider.js";

describe("chat flow integration (unit-level composition)", () => {
  beforeEach(() => _resetModelContextCache());

  it("turn 1 has no history; turn 2 runs rewrite and budgets prior turns", async () => {
    const completeSpy = vi.fn((_opts: unknown) =>
      (async function* () {
        yield "rewritten q";
      })(),
    );
    const provider: LLMProvider = {
      complete: completeSpy as never,
      embed: async () => [],
      ping: async () => true,
      showModel: async () => ({ contextLength: 8192 }),
    };

    // turn 1 — fresh chat, empty history
    let chat = createChat({ id: "c1", now: 1, folder: "", model: "m" });
    expect(chat.turns).toHaveLength(0);

    // simulate turn 1 completing
    chat = appendTurn(
      chat,
      {
        question: "what is X?",
        answer: "X is a thing",
        sourceIds: [],
        rewrittenQuery: null,
        createdAt: 2,
      },
      2,
    );

    // turn 2 — rewrite should be invoked with the prior turn
    const rewritten = await rewriteFollowUp({
      provider,
      model: "m",
      history: chat.turns,
      question: "and why?",
    });
    expect(rewritten).toBe("rewritten q");

    // budget should include the prior turn (well within 8192 - 2048)
    const ctx = await getModelContextWindow(provider, "m");
    const budgeted = budgetHistory(chat.turns, {
      availableTokens: ctx - 2048,
    });
    expect(budgeted).toHaveLength(1);
    expect(budgeted[0]!.question).toBe("what is X?");
  });
});
