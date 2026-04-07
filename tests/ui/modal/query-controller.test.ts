import { describe, it, expect } from "vitest";
import { QueryController } from "../../../src/ui/modal/query-controller.js";
import { KnowledgeBase } from "../../../src/core/kb.js";
import { MockLLMProvider } from "../../helpers/mock-llm-provider.js";
import type { QueryControllerState } from "../../../src/ui/modal/query-controller.js";

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
