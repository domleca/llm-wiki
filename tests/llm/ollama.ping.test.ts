import { describe, it, expect, vi } from "vitest";
import { OllamaProvider } from "../../src/llm/ollama.js";

function makeProviderWith(
  fetchImpl: typeof globalThis.fetch,
): OllamaProvider {
  return new OllamaProvider({ url: "http://localhost:11434", fetchImpl });
}

describe("OllamaProvider.ping", () => {
  it("returns true on a 200 response from /api/tags", async () => {
    let lastUrl: string | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      lastUrl = typeof input === "string" ? input : input.toString();
      return new Response("{}", { status: 200 });
    });
    const provider = makeProviderWith(fetchImpl as never);
    expect(await provider.ping()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(lastUrl).toContain("/api/tags");
  });

  it("returns false on a non-2xx response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("err", { status: 500 }),
    );
    const provider = makeProviderWith(fetchImpl as never);
    expect(await provider.ping()).toBe(false);
  });

  it("returns false when fetch itself rejects (server unreachable)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const provider = makeProviderWith(fetchImpl as never);
    expect(await provider.ping()).toBe(false);
  });

  it("returns false when the externally-supplied signal is already aborted", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = makeProviderWith(fetchImpl as never);
    const ac = new AbortController();
    ac.abort();
    expect(await provider.ping(ac.signal)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
