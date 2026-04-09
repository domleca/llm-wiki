import { describe, it, expect } from "vitest";
import {
  allModels,
  modelsForProvider,
  completionModels,
  embeddingModels,
  findModel,
  defaultCompletionModel,
  defaultEmbeddingModel,
  searchModels,
} from "../../src/llm/catalog.js";

describe("catalog", () => {
  it("allModels returns entries for all three providers", () => {
    const all = allModels();
    const providers = new Set(all.map((m) => m.provider));
    expect(providers).toEqual(new Set(["openai", "anthropic", "google"]));
  });

  it("modelsForProvider filters correctly", () => {
    const anthropic = modelsForProvider("anthropic");
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.every((m) => m.provider === "anthropic")).toBe(true);
  });

  it("completionModels excludes embedding-only models", () => {
    const openaiCompletion = completionModels("openai");
    expect(openaiCompletion.every((m) => m.canComplete)).toBe(true);
    expect(openaiCompletion.some((m) => m.id.includes("embedding"))).toBe(
      false,
    );
  });

  it("embeddingModels returns embedding-capable models", () => {
    const openaiEmbed = embeddingModels("openai");
    expect(openaiEmbed.length).toBeGreaterThan(0);
    expect(openaiEmbed.every((m) => m.canEmbed)).toBe(true);
  });

  it("Anthropic has no embedding models", () => {
    expect(embeddingModels("anthropic")).toEqual([]);
  });

  it("findModel looks up by exact id", () => {
    const entry = findModel("gpt-4o");
    expect(entry).toBeDefined();
    expect(entry!.provider).toBe("openai");
    expect(entry!.canComplete).toBe(true);
  });

  it("findModel returns undefined for unknown ids", () => {
    expect(findModel("nonexistent-model")).toBeUndefined();
  });

  it("defaultCompletionModel returns a valid model per provider", () => {
    for (const p of ["openai", "anthropic", "google"] as const) {
      const id = defaultCompletionModel(p);
      expect(findModel(id)).toBeDefined();
    }
  });

  it("defaultEmbeddingModel returns null for Anthropic", () => {
    expect(defaultEmbeddingModel("anthropic")).toBeNull();
  });

  it("defaultEmbeddingModel returns a valid model for OpenAI and Google", () => {
    for (const p of ["openai", "google"] as const) {
      const id = defaultEmbeddingModel(p);
      expect(id).not.toBeNull();
      expect(findModel(id!)).toBeDefined();
    }
  });

  it("searchModels filters by query", () => {
    const results = searchModels("flash");
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (m) =>
          m.id.toLowerCase().includes("flash") ||
          m.label.toLowerCase().includes("flash"),
      ),
    ).toBe(true);
  });

  it("searchModels filters by provider", () => {
    const results = searchModels("", "anthropic");
    expect(results.every((m) => m.provider === "anthropic")).toBe(true);
  });

  it("searchModels returns all when query is empty", () => {
    const all = searchModels("");
    expect(all.length).toBe(allModels().length);
  });
});
