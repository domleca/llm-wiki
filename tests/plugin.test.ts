import { describe, expect, it } from "vitest";
import LlmWikiPlugin from "../src/plugin.js";

describe("LlmWikiPlugin embedding model selection", () => {
  it("uses the custom embedding model for OpenAI-compatible providers", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      providerType: "openai-compatible",
      customOpenAIEmbeddingModel: "text-embedding-3-small",
      customOpenAIModel: "gpt-4o-mini",
    } as never;

    expect(plugin.activeEmbeddingModel).toBe("text-embedding-3-small");
  });

  it("falls back to the custom completion model when no embedding model is set", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      providerType: "openai-compatible",
      customOpenAIEmbeddingModel: "",
      customOpenAIModel: "text-embedding-3-small",
    } as never;

    expect(plugin.activeEmbeddingModel).toBe("text-embedding-3-small");
  });

  it("uses provider defaults for built-in cloud providers", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      providerType: "openai",
    } as never;

    expect(plugin.activeEmbeddingModel).toBe("text-embedding-3-small");
  });
});
