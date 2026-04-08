import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getModelContextWindow,
  FALLBACK_CONTEXT_WINDOW,
  _resetModelContextCache,
} from "../../src/chat/model-context.js";
import type { LLMProvider } from "../../src/llm/provider.js";

function makeProvider(ctx: number | null): LLMProvider {
  return {
    complete: () => (async function* () {})(),
    embed: async () => [],
    ping: async () => true,
    showModel: async () => ({ contextLength: ctx }),
  };
}

describe("getModelContextWindow", () => {
  beforeEach(() => _resetModelContextCache());

  it("returns the reported context length", async () => {
    expect(await getModelContextWindow(makeProvider(32768), "m")).toBe(32768);
  });

  it("falls back when null", async () => {
    expect(await getModelContextWindow(makeProvider(null), "m")).toBe(
      FALLBACK_CONTEXT_WINDOW,
    );
  });

  it("caches per model (showModel called once across calls)", async () => {
    const show = vi.fn(async () => ({ contextLength: 4096 }));
    const p: LLMProvider = {
      complete: () => (async function* () {})(),
      embed: async () => [],
      ping: async () => true,
      showModel: show,
    };
    await getModelContextWindow(p, "m");
    await getModelContextWindow(p, "m");
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("falls back if showModel throws", async () => {
    const p: LLMProvider = {
      complete: () => (async function* () {})(),
      embed: async () => [],
      ping: async () => true,
      showModel: async () => {
        throw new Error("boom");
      },
    };
    expect(await getModelContextWindow(p, "m")).toBe(FALLBACK_CONTEXT_WINDOW);
  });
});
