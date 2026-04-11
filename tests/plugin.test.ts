import { __setLanguage } from "obsidian";
import { describe, expect, it } from "vitest";
import LlmWikiPlugin, {
  describeExtractionLanguage,
} from "../src/plugin.js";

describe("LlmWikiPlugin embedding model selection", () => {
  it("uses the custom embedding model for OpenAI-compatible providers", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      providerType: "openai-compatible",
      customOpenAIBaseUrl: "https://api.example.com",
      customOpenAIEmbeddingModel: "text-embedding-3-small",
      customOpenAIModel: "gpt-4o-mini",
    } as never;

    expect(plugin.activeEmbeddingModel).toBe("text-embedding-3-small");
  });

  it("falls back to the custom completion model when no embedding model is set", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      providerType: "openai-compatible",
      customOpenAIBaseUrl: "https://api.example.com",
      customOpenAIEmbeddingModel: "",
      customOpenAIModel: "text-embedding-3-small",
    } as never;

    expect(plugin.activeEmbeddingModel).toBe("text-embedding-3-small");
  });

  it("falls back to Ollama models when custom provider has no base URL", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      providerType: "openai-compatible",
      customOpenAIBaseUrl: "",
      customOpenAIEmbeddingModel: "text-embedding-3-small",
      customOpenAIModel: "gpt-4o-mini",
      ollamaModel: "qwen2.5:7b",
    } as never;

    expect(plugin.activeModel).toBe("qwen2.5:7b");
    expect(plugin.activeEmbeddingModel).toBe("nomic-embed-text");
  });

  it("uses provider defaults for built-in cloud providers", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      providerType: "openai",
    } as never;

    expect(plugin.activeEmbeddingModel).toBe("text-embedding-3-small");
  });
});

describe("extraction language selection", () => {
  it("uses the configured explicit language", () => {
    expect(describeExtractionLanguage("fr", "en")).toBe("French");
  });

  it("uses the Obsidian app language when set to auto", () => {
    expect(describeExtractionLanguage("app", "fr")).toBe("French");
  });

  it("falls back to a descriptive label for unknown app languages", () => {
    expect(describeExtractionLanguage("app", "nl")).toBe(
      "the app language (nl)",
    );
  });

  it("resolves the plugin getter via the current Obsidian language", () => {
    __setLanguage("de");
    const plugin = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
    plugin.settings = {
      extractionOutputLanguage: "app",
    } as never;

    expect(plugin.extractionOutputLanguage).toBe("German");
    __setLanguage("en");
  });
});
