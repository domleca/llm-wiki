import { describe, it, expect } from "vitest";
import { GoogleProvider } from "../../src/llm/google.js";
import { createMockFetch } from "../helpers/mock-fetch.js";
import { LLMHttpError, LLMProtocolError } from "../../src/llm/provider.js";

function sseChunk(text: string): string {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  })}\n\n`;
}

describe("GoogleProvider.complete", () => {
  it("streams tokens from SSE response", async () => {
    const mock = createMockFetch([
      { chunks: [sseChunk("Hello"), sseChunk(" world")] },
    ]);
    const provider = new GoogleProvider({
      apiKey: "AIzaTest",
      fetchImpl: mock.fetch,
    });

    const tokens: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "hi",
      model: "gemini-2.0-flash",
    })) {
      tokens.push(chunk);
    }

    expect(tokens.join("")).toBe("Hello world");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toContain("gemini-2.0-flash");
    expect(mock.calls[0]!.url).toContain("streamGenerateContent");
    expect(mock.calls[0]!.url).toContain("key=AIzaTest");
  });

  it("sends prompt in Gemini format", async () => {
    const mock = createMockFetch([{ chunks: [sseChunk("ok")] }]);
    const provider = new GoogleProvider({
      apiKey: "AIzaTest",
      fetchImpl: mock.fetch,
    });
    for await (const _ of provider.complete({
      prompt: "my prompt",
      model: "gemini-2.0-flash",
    })) {
      // consume
    }
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.contents[0].parts[0].text).toBe("my prompt");
  });

  it("throws LLMHttpError on non-200", async () => {
    const mock = createMockFetch([{ status: 403, body: "Forbidden" }]);
    const provider = new GoogleProvider({
      apiKey: "AIzaBad",
      fetchImpl: mock.fetch,
    });
    await expect(async () => {
      for await (const _ of provider.complete({
        prompt: "hi",
        model: "gemini-2.0-flash",
      })) {
        // consume
      }
    }).rejects.toThrow(LLMHttpError);
  });
});

describe("GoogleProvider.embed", () => {
  it("returns embedding vector", async () => {
    const mock = createMockFetch([
      {
        body: JSON.stringify({
          embedding: { values: [0.1, 0.2, 0.3] },
        }),
      },
    ]);
    const provider = new GoogleProvider({
      apiKey: "AIzaTest",
      fetchImpl: mock.fetch,
    });

    const vec = await provider.embed({
      text: "hello",
      model: "text-embedding-004",
    });
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(mock.calls[0]!.url).toContain("text-embedding-004:embedContent");
  });

  it("throws on missing embedding in response", async () => {
    const mock = createMockFetch([{ body: JSON.stringify({}) }]);
    const provider = new GoogleProvider({
      apiKey: "AIzaTest",
      fetchImpl: mock.fetch,
    });
    await expect(
      provider.embed({ text: "hi", model: "text-embedding-004" }),
    ).rejects.toThrow(LLMProtocolError);
  });
});

describe("GoogleProvider.ping", () => {
  it("returns true on 200", async () => {
    const mock = createMockFetch([{ status: 200, body: "{}" }]);
    const provider = new GoogleProvider({
      apiKey: "AIzaTest",
      fetchImpl: mock.fetch,
    });
    expect(await provider.ping()).toBe(true);
  });

  it("returns false on network error", async () => {
    const mock = createMockFetch([
      { throwError: new Error("network down") },
    ]);
    const provider = new GoogleProvider({
      apiKey: "AIzaTest",
      fetchImpl: mock.fetch,
    });
    expect(await provider.ping()).toBe(false);
  });
});

describe("GoogleProvider.listModels", () => {
  it("returns catalog completion models", async () => {
    const provider = new GoogleProvider({ apiKey: "AIzaTest" });
    const models = await provider.listModels();
    expect(models).not.toBeNull();
    expect(models!.some((m) => m.includes("gemini"))).toBe(true);
    expect(models!.some((m) => m.includes("embedding"))).toBe(false);
  });
});
