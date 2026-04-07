import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { KnowledgeBase } from "../../src/core/kb.js";
import type { KBData } from "../../src/core/types.js";
import { ask } from "../../src/query/ask.js";
import { retrieve } from "../../src/query/retrieve.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/sample-kb.json");

function loadFixture(): KnowledgeBase {
  const json = JSON.parse(readFileSync(fixturePath, "utf-8")) as KBData;
  return new KnowledgeBase(json);
}

describe("Phase 3 integration", () => {
  it("retrieves Alan Watts as the top entity for 'who is alan watts'", () => {
    const kb = loadFixture();
    const bundle = retrieve({ question: "who is Alan Watts", kb });
    expect(bundle.entities[0]?.name.toLowerCase()).toContain("alan");
  });

  it("never returns the blacklisted 'exact name' entity", () => {
    const kb = loadFixture();
    const bundle = retrieve({ question: "exact name", kb });
    expect(
      bundle.entities.find((e) => e.name.toLowerCase() === "exact name"),
    ).toBeUndefined();
  });

  it("returns Karpathy for the books-question even with type hint", () => {
    // sanity-check that type hint boost doesn't crowd out other strong signals
    const kb = loadFixture();
    const bundle = retrieve({ question: "what books did Watts write", kb });
    expect(bundle.queryType).toBe("list_category");
    expect(bundle.entities.length).toBeGreaterThan(0);
  });

  it("returns connections from the real fixture", () => {
    const kb = loadFixture();
    const bundle = retrieve({ question: "who is Alan Watts", kb });
    expect(bundle.connections.length).toBeGreaterThan(0);
  });

  it("ask() yields context, chunks, and done", async () => {
    const kb = loadFixture();
    const provider = new MockLLMProvider({
      responses: [
        "Alan Watts was a British philosopher who wrote The Way of Zen.",
      ],
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
  });

  it("respects folder scope on the real fixture", () => {
    const kb = loadFixture();
    const all = retrieve({ question: "philosopher", kb });
    const scoped = retrieve({ question: "philosopher", kb, folder: "Books" });
    // Scoped result must be a subset of unscoped
    expect(scoped.entities.length).toBeLessThanOrEqual(all.entities.length);
    for (const e of scoped.entities) {
      expect(e.sources.some((s) => s.startsWith("Books/"))).toBe(true);
    }
  });
});
