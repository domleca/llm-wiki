import { describe, it, expect, vi } from "vitest";
import { OllamaProvider } from "../../src/llm/ollama.js";
import {
  LLMHttpError,
  LLMAbortError,
  LLMProtocolError,
} from "../../src/llm/provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OllamaProvider.embed", () => {
  it("POSTs to /api/embeddings and returns the embedding vector", async () => {
    const fetchImpl: typeof globalThis.fetch = vi.fn(async () =>
      jsonResponse({ embedding: [0.1, 0.2, 0.3] }),
    );
    const provider = new OllamaProvider({ url: "http://x", fetchImpl });

    const vec = await provider.embed({
      text: "hello",
      model: "nomic-embed-text",
    });

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit | undefined;
    expect(url).toBe("http://x/api/embeddings");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ model: "nomic-embed-text", prompt: "hello" });
  });

  it("throws LLMHttpError on non-2xx", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 500 }),
    );
    const provider = new OllamaProvider({ url: "http://x", fetchImpl });

    await expect(
      provider.embed({ text: "hi", model: "nomic-embed-text" }),
    ).rejects.toBeInstanceOf(LLMHttpError);
  });

  it("throws LLMProtocolError when response lacks embedding array", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ wrong: true }));
    const provider = new OllamaProvider({ url: "http://x", fetchImpl });

    await expect(
      provider.embed({ text: "hi", model: "nomic-embed-text" }),
    ).rejects.toBeInstanceOf(LLMProtocolError);
  });

  it("throws LLMAbortError when signal is already aborted", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      if ((init as RequestInit)?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return jsonResponse({ embedding: [1] });
    });
    const provider = new OllamaProvider({ url: "http://x", fetchImpl });
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      provider.embed({
        text: "hi",
        model: "nomic-embed-text",
        signal: ctrl.signal,
      }),
    ).rejects.toBeInstanceOf(LLMAbortError);
  });
});
