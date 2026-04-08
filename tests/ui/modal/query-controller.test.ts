import { describe, it, expect, beforeEach } from "vitest";
import { QueryController } from "../../../src/ui/modal/query-controller.js";
import { KnowledgeBase } from "../../../src/core/kb.js";
import { MockLLMProvider } from "../../helpers/mock-llm-provider.js";
import type { QueryControllerState } from "../../../src/ui/modal/query-controller.js";
import type { Chat } from "../../../src/chat/types.js";
import { _resetModelContextCache } from "../../../src/chat/model-context.js";

function buildKB() {
  const kb = new KnowledgeBase();
  kb.addEntity({
    name: "Alan Watts",
    type: "person",
    aliases: [],
    facts: ["philosopher"],
    source: "x.md",
  });
  return kb;
}

describe("QueryController", () => {
  it("transitions idle → loading → streaming → done", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: ["answer text"],
      chunked: true,
    });
    const states: QueryControllerState[] = [];
    const chunks: string[] = [];
    const ctrl = new QueryController({
      kb,
      provider,
      model: "test",
      onState: (s) => states.push(s),
      onChunk: (t) => chunks.push(t),
      onContext: () => {},
    });
    await ctrl.run("who is Alan Watts");
    expect(states).toEqual(["loading", "streaming", "done"]);
    expect(chunks.join("")).toContain("answer");
  });

  it("transitions to error when provider throws", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: [],
      errors: [new Error("oops")],
    });
    const states: QueryControllerState[] = [];
    const ctrl = new QueryController({
      kb,
      provider,
      model: "test",
      onState: (s) => states.push(s),
      onChunk: () => {},
      onContext: () => {},
    });
    await ctrl.run("q");
    expect(states[states.length - 1]).toBe("error");
  });

  it("cancel() aborts the in-flight request", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: ["very long answer"],
      chunked: true,
      chunkDelayMs: 50,
    });
    const states: QueryControllerState[] = [];
    const ctrl = new QueryController({
      kb,
      provider,
      model: "test",
      onState: (s) => states.push(s),
      onChunk: () => {},
      onContext: () => {},
    });
    const p = ctrl.run("q");
    await new Promise((r) => setTimeout(r, 10));
    ctrl.cancel();
    await p;
    expect(states).toContain("cancelled");
  });
});

describe("QueryController.runChatTurn", () => {
  beforeEach(() => {
    _resetModelContextCache();
  });

  function buildEmptyChat(): Chat {
    return {
      id: "c1",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      folder: "",
      model: "test",
      turns: [],
    };
  }

  function buildChatWithOneTurn(): Chat {
    return {
      id: "c1",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      folder: "",
      model: "test",
      turns: [
        {
          question: "who is Alan Watts",
          answer: "a philosopher",
          sourceIds: [],
          rewrittenQuery: null,
          createdAt: 0,
        },
      ],
    };
  }

  it("turn 1 (empty history): does not call rewrite, calls complete once", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: ["answer text"],
      chunked: false,
    });
    const retrievalQueries: string[] = [];
    const ctrl = new QueryController({
      kb,
      provider,
      model: "test",
      onState: () => {},
      onChunk: () => {},
      onContext: () => {},
      onRetrievalQuery: (q) => retrievalQueries.push(q),
    });

    await ctrl.runChatTurn({ chat: buildEmptyChat(), question: "hello" });

    // Only one complete() call (the ask, no rewrite)
    expect(provider.calls).toHaveLength(1);
    // The single call's prompt must NOT contain the rewrite prompt marker
    expect(provider.calls[0]!.prompt).not.toContain("Standalone question:");
    // onRetrievalQuery called with the raw question
    expect(retrievalQueries).toEqual(["hello"]);
  });

  it("turn 2 (non-empty history): calls complete twice — rewrite then ask", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: ["rewritten standalone Q", "final answer chunk"],
      chunked: false,
    });
    const retrievalQueries: string[] = [];
    const ctrl = new QueryController({
      kb,
      provider,
      model: "test",
      onState: () => {},
      onChunk: () => {},
      onContext: () => {},
      onRetrievalQuery: (q) => retrievalQueries.push(q),
    });

    await ctrl.runChatTurn({ chat: buildChatWithOneTurn(), question: "and why?" });

    // Two complete() calls: rewrite + ask
    expect(provider.calls).toHaveLength(2);
    // Second call is the ask: prompt includes "Question: and why?" and history markers
    const askPrompt = provider.calls[1]!.prompt;
    expect(askPrompt).toContain("Question: and why?");
    expect(askPrompt).toContain("Conversation so far:");
    expect(askPrompt).toContain("[user]");
    // onRetrievalQuery called with the rewritten query
    expect(retrievalQueries).toEqual(["rewritten standalone Q"]);
  });

  it("emits state transitions: loading → streaming → done", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: ["answer"],
      chunked: false,
    });
    const states: QueryControllerState[] = [];
    const ctrl = new QueryController({
      kb,
      provider,
      model: "test",
      onState: (s) => states.push(s),
      onChunk: () => {},
      onContext: () => {},
    });

    await ctrl.runChatTurn({ chat: buildEmptyChat(), question: "hello" });

    expect(states).toEqual(["loading", "streaming", "done"]);
  });
});
