import { describe, it, expect, afterEach } from "vitest";
import { OllamaProvider } from "../../src/llm/ollama.js";
import { createMockFetch } from "../helpers/mock-fetch.js";

const origFetch = globalThis.fetch;

describe("OllamaProvider.complete", () => {
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("streams tokens from a single-chunk NDJSON response", async () => {
    const ndjson =
      JSON.stringify({ response: "Hello", done: false }) +
      "\n" +
      JSON.stringify({ response: " world", done: false }) +
      "\n" +
      JSON.stringify({ response: "", done: true }) +
      "\n";
    const mock = createMockFetch([{ chunks: [ndjson] }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({ url: "http://localhost:11434" });
    const tokens: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "hi",
      model: "qwen2.5:7b",
    })) {
      tokens.push(chunk);
    }

    expect(tokens.join("")).toBe("Hello world");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toBe("http://localhost:11434/api/generate");
    expect(mock.calls[0]!.method).toBe("POST");
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.prompt).toBe("hi");
    expect(body.stream).toBe(true);
    expect(body.options.temperature).toBe(0.1);
    expect(body.options.num_ctx).toBe(8192);
  });

  it("handles NDJSON lines split across chunks", async () => {
    const full =
      JSON.stringify({ response: "foo", done: false }) +
      "\n" +
      JSON.stringify({ response: "bar", done: false }) +
      "\n" +
      JSON.stringify({ response: "", done: true }) +
      "\n";
    const mid = Math.floor(full.length / 2);
    const chunks = [full.slice(0, 8), full.slice(8, mid), full.slice(mid)];
    const mock = createMockFetch([{ chunks }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({ url: "http://localhost:11434" });
    const out: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "x",
      model: "qwen2.5:7b",
    })) {
      out.push(chunk);
    }
    expect(out.join("")).toBe("foobar");
  });

  it("throws LLMAbortError if signal is already aborted", async () => {
    const mock = createMockFetch([{ chunks: ["{}"] }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({});
    const controller = new AbortController();
    controller.abort();

    await expect(async () => {
      for await (const _ of provider.complete({
        prompt: "x",
        model: "qwen2.5:7b",
        signal: controller.signal,
      })) {
        void _;
      }
    }).rejects.toMatchObject({ name: "LLMAbortError" });
  });

  it("throws LLMHttpError on non-2xx response", async () => {
    const mock = createMockFetch([{ status: 500, body: "boom" }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({});
    await expect(async () => {
      for await (const _ of provider.complete({
        prompt: "x",
        model: "qwen2.5:7b",
      })) {
        void _;
      }
    }).rejects.toMatchObject({ name: "LLMHttpError", status: 500 });
  });
});
