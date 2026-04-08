import { describe, it, expect, vi } from "vitest";
import { rewriteFollowUp } from "../../src/chat/rewrite.js";
import type { LLMProvider } from "../../src/llm/provider.js";
import type { ChatTurn } from "../../src/chat/types.js";

function mockProvider(response: string): LLMProvider {
  return {
    complete: () =>
      (async function* () {
        yield response;
      })(),
    embed: async () => [],
    ping: async () => true,
    showModel: async () => ({ contextLength: null }),
  };
}

const turn = (q: string, a: string): ChatTurn => ({
  question: q,
  answer: a,
  sourceIds: [],
  rewrittenQuery: null,
  createdAt: 0,
});

describe("rewriteFollowUp", () => {
  it("returns the trimmed model response", async () => {
    const p = mockProvider("  What is the runtime of the embedding index?  ");
    const out = await rewriteFollowUp({
      provider: p,
      model: "m",
      history: [turn("what is the embedding index?", "It's a cache.")],
      question: "what's its runtime?",
    });
    expect(out).toBe("What is the runtime of the embedding index?");
  });

  it("passes history and raw question into the prompt", async () => {
    const spy = vi.fn((_opts: unknown) =>
      (async function* () {
        yield "rewritten";
      })(),
    );
    const p: LLMProvider = {
      complete: spy as never,
      embed: async () => [],
      ping: async () => true,
      showModel: async () => ({ contextLength: null }),
    };
    await rewriteFollowUp({
      provider: p,
      model: "m",
      history: [turn("q1", "a1")],
      question: "and then?",
    });
    const call = (spy.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(call).toContain("q1");
    expect(call).toContain("a1");
    expect(call).toContain("and then?");
  });

  it("falls back to the raw question if the model returns empty", async () => {
    const p = mockProvider("   ");
    const out = await rewriteFollowUp({
      provider: p,
      model: "m",
      history: [turn("q", "a")],
      question: "raw",
    });
    expect(out).toBe("raw");
  });
});
