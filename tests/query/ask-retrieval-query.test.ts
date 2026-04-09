import { describe, it, expect, vi } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

// Must be hoisted before ask.ts is imported so the mock is in place.
vi.mock("../../src/query/retrieve.js", () => ({
  retrieve: vi.fn(() => ({
    question: "standalone Q",
    queryType: "conceptual" as const,
    entities: [
      { id: "e1", name: "Test", type: "other", aliases: [], facts: ["f1", "f2", "f3"], sources: ["a.md"] },
      { id: "e2", name: "Test2", type: "other", aliases: [], facts: ["f1"], sources: ["b.md"] },
      { id: "e3", name: "Test3", type: "other", aliases: [], facts: ["f1"], sources: ["c.md"] },
    ],
    concepts: [],
    connections: [],
    sources: [{ id: "a.md", summary: "s", date: null, mtime: 0, origin: "user-note" }],
  })),
}));

// Import after mock is registered.
import { ask } from "../../src/query/ask.js";
import { retrieve } from "../../src/query/retrieve.js";

describe("ask — retrievalQuery", () => {
  it("uses retrievalQuery for retrieval but question for the prompt", async () => {
    const retrieveMock = vi.mocked(retrieve);
    retrieveMock.mockClear();

    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider({
      responses: ["Some answer."],
      chunked: false,
    });

    for await (const _ev of ask({
      question: "and why?",
      retrievalQuery: "standalone Q",
      kb,
      provider,
      model: "test",
    })) {
      // consume all events
    }

    expect(retrieveMock).toHaveBeenCalledWith(
      expect.objectContaining({ question: "standalone Q" }),
    );
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Question: and why?");
  });
});
