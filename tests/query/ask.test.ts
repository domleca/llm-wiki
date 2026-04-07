import { describe, it, expect } from "vitest";
import { ask } from "../../src/query/ask.js";
import { KnowledgeBase } from "../../src/core/kb.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

function buildKB() {
  const kb = new KnowledgeBase();
  kb.addEntity({
    name: "Alan Watts",
    type: "person",
    aliases: ["Watts"],
    facts: ["British philosopher", "Wrote The Way of Zen"],
    source: "Books/Watts.md",
  });
  return kb;
}

describe("ask", () => {
  it("yields a context event then chunks then done", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: ["Alan Watts was a British philosopher."],
      chunked: true,
    });
    const events: Array<{ kind: string; text?: string }> = [];
    for await (const ev of ask({
      question: "who is Alan Watts",
      kb,
      provider,
      model: "test",
    })) {
      events.push({ kind: ev.kind, text: ev.text });
    }
    expect(events[0]?.kind).toBe("context");
    expect(events.some((e) => e.kind === "chunk")).toBe(true);
    expect(events[events.length - 1]?.kind).toBe("done");
    const fullText = events
      .filter((e) => e.kind === "chunk")
      .map((e) => e.text)
      .join("");
    expect(fullText).toContain("Alan Watts");
  });

  it("yields an error event when the provider throws", async () => {
    const kb = buildKB();
    const provider = new MockLLMProvider({
      responses: [],
      errors: [new Error("network down")],
    });
    const events: Array<{ kind: string }> = [];
    for await (const ev of ask({
      question: "who is Alan Watts",
      kb,
      provider,
      model: "test",
    })) {
      events.push({ kind: ev.kind });
    }
    expect(events[events.length - 1]?.kind).toBe("error");
  });
});
