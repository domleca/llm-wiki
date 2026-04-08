import { describe, it, expect } from "vitest";
import { OllamaProvider } from "../../src/llm/ollama.js";

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("OllamaProvider.showModel", () => {
  it("extracts context length from model_info under any *.context_length key", async () => {
    const p = new OllamaProvider({
      fetchImpl: mockFetch({
        model_info: { "qwen2.context_length": 32768 },
      }),
    });
    const r = await p.showModel("qwen2.5:7b");
    expect(r.contextLength).toBe(32768);
  });

  it("returns null when no context_length field is present", async () => {
    const p = new OllamaProvider({ fetchImpl: mockFetch({ model_info: {} }) });
    expect((await p.showModel("x")).contextLength).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const p = new OllamaProvider({ fetchImpl: mockFetch({}, 500) });
    expect((await p.showModel("x")).contextLength).toBeNull();
  });

  it("returns null on fetch failure (never throws)", async () => {
    const p = new OllamaProvider({
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    expect((await p.showModel("x")).contextLength).toBeNull();
  });
});
