import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { extractFile } from "../../src/extract/extractor.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

const HAPPY_JSON = `{
  "source_summary": "About Alan Watts.",
  "entities": [
    {"name": "Alan Watts", "type": "person", "aliases": ["A.W."], "facts": ["wrote The Wisdom of Insecurity"]}
  ],
  "concepts": [
    {"name": "Zen", "definition": "School of Mahayana.", "related": ["Alan Watts"]}
  ],
  "connections": [
    {"from": "Alan Watts", "to": "Zen", "type": "influences", "description": "popularized zen"}
  ]
}`;

describe("extractFile", () => {
  it("calls the provider and merges the parsed result into the KB", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON]);

    const result = await extractFile({
      provider,
      kb,
      file: {
        path: "Books/watts.md",
        content: "Alan Watts wrote about Zen.",
        mtime: 1000,
        origin: "user-note",
      },
      model: "qwen2.5:7b",
    });

    expect(result).not.toBeNull();
    expect(kb.stats().entities).toBe(1);
    expect(kb.data.entities["alan-watts"]?.name).toBe("Alan Watts");
    expect(kb.data.entities["alan-watts"]?.aliases).toContain("A.W.");
    expect(kb.data.concepts["zen"]?.definition).toBe("School of Mahayana.");
    expect(kb.data.connections).toHaveLength(1);
    expect(kb.data.sources["Books/watts.md"]?.mtime).toBe(1000);
    expect(kb.data.sources["Books/watts.md"]?.origin).toBe("user-note");

    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0]!;
    expect(call.model).toBe("qwen2.5:7b");
    expect(call.prompt).toContain("DOCUMENT (Books/watts.md):");
    expect(call.prompt).toContain("Alan Watts wrote about Zen.");
  });

  it("returns null when the provider yields no JSON", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider(["I'm sorry, I can't do that."]);
    const result = await extractFile({
      provider,
      kb,
      file: {
        path: "x.md",
        content: "body",
        mtime: 1,
        origin: "user-note",
      },
      model: "qwen2.5:7b",
    });
    expect(result).toBeNull();
    expect(kb.stats().entities).toBe(0);
    expect(kb.isProcessed("x.md")).toBe(false);
  });

  it("truncates content longer than DEFAULT_CHAR_LIMIT before prompting", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON]);
    const huge = "x".repeat(20_000);
    await extractFile({
      provider,
      kb,
      file: {
        path: "big.md",
        content: huge,
        mtime: 1,
        origin: "user-note",
      },
      model: "qwen2.5:7b",
    });
    const prompt = provider.calls[0]!.prompt;
    expect(prompt).toContain("[... truncated ...]");
    expect(prompt.length).toBeLessThan(20_000);
  });

  it("propagates AbortError from the provider", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractFile({
        provider,
        kb,
        file: {
          path: "y.md",
          content: "body",
          mtime: 1,
          origin: "user-note",
        },
        model: "qwen2.5:7b",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "LLMAbortError" });
  });
});
