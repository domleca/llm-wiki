import { LLMHttpError, LLMProtocolError } from "../../src/llm/provider.js";
import { describe, expect, it } from "vitest";

import { OpenAIProvider } from "../../src/llm/openai.js";
import { createMockFetch } from "../helpers/mock-fetch.js";

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content }, finish_reason: null }],
  })}\n\n`;
}

const SSE_DONE = "data: [DONE]\n\n";

describe("OpenAIProvider.complete", () => {
  it("streams tokens from SSE response", async () => {
    const mock = createMockFetch([
      {
        chunks: [sseChunk("Hello"), sseChunk(" world"), SSE_DONE],
      },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      fetchImpl: mock.fetch,
    });

    const tokens: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "hi",
      model: "gpt-4o-mini",
    })) {
      tokens.push(chunk);
    }

    expect(tokens.join("")).toBe("Hello world");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toBe("hi");
  });

  it("sends authorization header", async () => {
    const mock = createMockFetch([{ chunks: [SSE_DONE] }]);
    const provider = new OpenAIProvider({
      apiKey: "sk-my-key",
      fetchImpl: mock.fetch,
    });
    const tokens: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "x",
      model: "gpt-4o",
    })) {
      tokens.push(chunk);
    }
    expect(mock.calls[0]!.headers["Authorization"]).toBe(
      "Bearer sk-my-key",
    );
  });

  it("throws LLMHttpError on non-200", async () => {
    const mock = createMockFetch([{ status: 401, body: "Unauthorized" }]);
    const provider = new OpenAIProvider({
      apiKey: "sk-bad",
      fetchImpl: mock.fetch,
    });
    await expect(async () => {
      for await (const _ of provider.complete({
        prompt: "hi",
        model: "gpt-4o",
      })) {
        // consume
      }
    }).rejects.toThrow(LLMHttpError);
  });

  it("uses a custom completions endpoint", async () => {
    const mock = createMockFetch([{ chunks: [SSE_DONE] }]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.cerebras.ai",
      completionsEndpoint: "/v1/completions",
      fetchImpl: mock.fetch,
    });
    for await (const _ of provider.complete({ prompt: "hi", model: "x" })) {
      // consume
    }
    expect(mock.calls[0]!.url).toBe("https://api.cerebras.ai/v1/completions");
  });

  it("supports legacy completions payloads and streamed text deltas", async () => {
    const mock = createMockFetch([
      {
        chunks: [
          `data: ${JSON.stringify({
            choices: [{ text: "Hello", finish_reason: null }],
          })}\n\n`,
          `data: ${JSON.stringify({
            choices: [{ text: " world", finish_reason: null }],
          })}\n\n`,
          SSE_DONE,
        ],
      },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.cerebras.ai",
      completionsEndpoint: "/v1/completions",
      fetchImpl: mock.fetch,
    });

    const tokens: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "hi",
      model: "x",
    })) {
      tokens.push(chunk);
    }

    expect(tokens.join("")).toBe("Hello world");
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.prompt).toBe("hi");
    expect(body.messages).toBeUndefined();
  });

  it("omits authorization header when no api key is configured", async () => {
    const mock = createMockFetch([{ chunks: [SSE_DONE] }]);
    const provider = new OpenAIProvider({
      baseUrl: "https://api.example.com",
      fetchImpl: mock.fetch,
    });

    for await (const _ of provider.complete({
      prompt: "hi",
      model: "x",
    })) {
      // consume
    }

    expect(mock.calls[0]!.headers["Authorization"]).toBeUndefined();
  });
});

describe("OpenAIProvider.embed", () => {
  it("returns embedding vector", async () => {
    const mock = createMockFetch([
      {
        body: JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      fetchImpl: mock.fetch,
    });

    const vec = await provider.embed({
      text: "hello",
      model: "text-embedding-3-small",
    });
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(mock.calls[0]!.url).toBe(
      "https://api.openai.com/v1/embeddings",
    );
  });

  it("throws on missing embedding in response", async () => {
    const mock = createMockFetch([{ body: JSON.stringify({ data: [] }) }]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      fetchImpl: mock.fetch,
    });
    await expect(
      provider.embed({ text: "hi", model: "text-embedding-3-small" }),
    ).rejects.toThrow(LLMProtocolError);
  });

  it("uses a custom embeddings endpoint", async () => {
    const mock = createMockFetch([
      {
        body: JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }),
      },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.cerebras.ai",
      embeddingsEndpoint: "https://api.cerebras.ai/v1/embed",
      fetchImpl: mock.fetch,
    });
    await provider.embed({ text: "hi", model: "x" });
    expect(mock.calls[0]!.url).toBe("https://api.cerebras.ai/v1/embed");
  });
});

describe("OpenAIProvider.ping", () => {
  it("returns true on 200", async () => {
    const mock = createMockFetch([{ status: 200, body: "{}" }]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      fetchImpl: mock.fetch,
    });
    expect(await provider.ping()).toBe(true);
  });

  it("returns false on 401", async () => {
    const mock = createMockFetch([{ status: 401, body: "" }]);
    const provider = new OpenAIProvider({
      apiKey: "sk-bad",
      fetchImpl: mock.fetch,
    });
    expect(await provider.ping()).toBe(false);
  });

  it("returns false on network error", async () => {
    const mock = createMockFetch([
      { throwError: new Error("network down") },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      fetchImpl: mock.fetch,
    });
    expect(await provider.ping()).toBe(false);
  });
});

describe("OpenAIProvider.listModels", () => {
  it("returns model ids from /v1/models", async () => {
    const mock = createMockFetch([
      {
        body: JSON.stringify({
          data: [
            { id: "gpt-4o-mini" },
            { id: "gpt-4o" },
            { id: "text-embedding-3-small" },
          ],
        }),
      },
    ]);
    const provider = new OpenAIProvider({ apiKey: "sk-test", fetchImpl: mock.fetch });
    const models = await provider.listModels();
    expect(models).not.toBeNull();
    expect(models!.includes("gpt-4o")).toBe(true);
    expect(models!.includes("text-embedding-3-small")).toBe(true);
    expect(mock.calls[0]!.url).toBe("https://api.openai.com/v1/models");
  });

  it("returns null when model listing fails", async () => {
    const mock = createMockFetch([{ status: 401, body: "" }]);
    const provider = new OpenAIProvider({ apiKey: "sk-test", fetchImpl: mock.fetch });
    expect(await provider.listModels()).toBeNull();
  });

  it("normalizes base URL when it already ends with /v1", async () => {
    const mock = createMockFetch([
      {
        body: JSON.stringify({
          data: [{ id: "gpt-4o-mini" }],
        }),
      },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.cerebras.ai/v1",
      fetchImpl: mock.fetch,
    });
    await provider.listModels();
    expect(mock.calls[0]!.url).toBe("https://api.cerebras.ai/v1/models");
  });

  it("normalizes base URL when it ends with /v1/v1", async () => {
    const mock = createMockFetch([
      {
        body: JSON.stringify({
          data: [{ id: "gpt-4o-mini" }],
        }),
      },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.cerebras.ai/v1/v1",
      fetchImpl: mock.fetch,
    });
    await provider.listModels();
    expect(mock.calls[0]!.url).toBe("https://api.cerebras.ai/v1/models");
  });

  it("uses a custom models endpoint", async () => {
    const mock = createMockFetch([
      {
        body: JSON.stringify({ data: [{ id: "x" }] }),
      },
    ]);
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.cerebras.ai",
      modelsEndpoint: "/v1/my-models",
      fetchImpl: mock.fetch,
    });
    await provider.listModels();
    expect(mock.calls[0]!.url).toBe("https://api.cerebras.ai/v1/my-models");
  });
});

describe("OpenAIProvider.showModel", () => {
  it("returns context length from catalog", async () => {
    const provider = new OpenAIProvider({ apiKey: "sk-test" });
    const info = await provider.showModel("gpt-4o");
    expect(info.contextLength).toBe(128_000);
  });

  it("returns null for unknown model", async () => {
    const provider = new OpenAIProvider({ apiKey: "sk-test" });
    const info = await provider.showModel("nonexistent");
    expect(info.contextLength).toBeNull();
  });
});
