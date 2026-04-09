import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "../../src/llm/anthropic.js";
import { createMockFetch } from "../helpers/mock-fetch.js";
import { LLMHttpError } from "../../src/llm/provider.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

function sseChunk(text: string): string {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  })}\n\n`;
}

function sseStop(): string {
  return `event: message_stop\ndata: ${JSON.stringify({
    type: "message_stop",
  })}\n\n`;
}

describe("AnthropicProvider.complete", () => {
  it("streams tokens from SSE response", async () => {
    const embedProvider = new MockLLMProvider({ embeddings: [] });
    const mock = createMockFetch([
      { chunks: [sseChunk("Hello"), sseChunk(" world"), sseStop()] },
    ]);
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      embedProvider,
      fetchImpl: mock.fetch,
    });

    const tokens: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "hi",
      model: "claude-3-5-haiku-20241022",
    })) {
      tokens.push(chunk);
    }

    expect(tokens.join("")).toBe("Hello world");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.headers["x-api-key"]).toBe("sk-ant-test");
    expect(mock.calls[0]!.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.model).toBe("claude-3-5-haiku-20241022");
    expect(body.stream).toBe(true);
  });

  it("throws LLMHttpError on non-200", async () => {
    const embedProvider = new MockLLMProvider({ embeddings: [] });
    const mock = createMockFetch([{ status: 401, body: "Unauthorized" }]);
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-bad",
      embedProvider,
      fetchImpl: mock.fetch,
    });
    await expect(async () => {
      for await (const _ of provider.complete({
        prompt: "hi",
        model: "claude-3-5-haiku-20241022",
      })) {
        // consume
      }
    }).rejects.toThrow(LLMHttpError);
  });
});

describe("AnthropicProvider.embed", () => {
  it("delegates to injected embed provider", async () => {
    const embedProvider = new MockLLMProvider({
      embeddings: [[0.1, 0.2, 0.3]],
    });
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      embedProvider,
      fetchImpl: async () => ({ ok: true, status: 200 }) as Response,
    });

    const vec = await provider.embed({
      text: "hello",
      model: "nomic-embed-text",
    });
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(embedProvider.embedCalls).toHaveLength(1);
    expect(embedProvider.embedCalls[0]!.text).toBe("hello");
  });
});

describe("AnthropicProvider.ping", () => {
  it("returns true when API responds", async () => {
    const embedProvider = new MockLLMProvider({ embeddings: [] });
    const mock = createMockFetch([{ status: 200, body: "{}" }]);
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      embedProvider,
      fetchImpl: mock.fetch,
    });
    expect(await provider.ping()).toBe(true);
  });

  it("returns false on network error", async () => {
    const embedProvider = new MockLLMProvider({ embeddings: [] });
    const mock = createMockFetch([
      { throwError: new Error("network down") },
    ]);
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      embedProvider,
      fetchImpl: mock.fetch,
    });
    expect(await provider.ping()).toBe(false);
  });
});

describe("AnthropicProvider.listModels", () => {
  it("returns catalog completion models", async () => {
    const embedProvider = new MockLLMProvider({ embeddings: [] });
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      embedProvider,
    });
    const models = await provider.listModels();
    expect(models).not.toBeNull();
    expect(models!.some((m) => m.includes("claude"))).toBe(true);
  });
});
