import { describe, expect, it } from "vitest";

import type { LLMProvider } from "../../src/llm/provider.js";
import { generateChatTitle } from "../../src/chat/title.js";

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

describe("generateChatTitle", () => {
  it("returns a trimmed ≤6-word title", async () => {
    const out = await generateChatTitle({
      provider: mockProvider("Embedding Index Runtime Details"),
      model: "m",
      question: "How does the embedding index work at runtime?",
    });
    expect(out).toBe("Embedding Index Runtime Details");
  });

  it("truncates to 6 words when the model over-produces", async () => {
    const out = await generateChatTitle({
      provider: mockProvider("one two three four five six seven eight"),
      model: "m",
      question: "q",
    });
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(6);
  });

  it("strips surrounding quotes and trailing punctuation", async () => {
    const out = await generateChatTitle({
      provider: mockProvider('"Hello World."'),
      model: "m",
      question: "q",
    });
    expect(out).toBe("Hello World");
  });

  it("falls back to 'Untitled' on empty model output", async () => {
    const out = await generateChatTitle({
      provider: mockProvider(""),
      model: "m",
      question: "q",
    });
    expect(out).toBe("Untitled");
  });

  it("falls back to 'Untitled' when complete() throws", async () => {
    const p: LLMProvider = {
      complete: () =>
        ({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new Error("boom");
              },
            };
          },
        }) as AsyncIterable<string>,
      embed: async () => [],
      ping: async () => true,
      showModel: async () => ({ contextLength: null }),
    };
    const out = await generateChatTitle({
      provider: p,
      model: "m",
      question: "q",
    });
    expect(out).toBe("Untitled");
  });
});
