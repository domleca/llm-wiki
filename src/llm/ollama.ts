import {
  LLMAbortError,
  LLMConnectError,
  LLMHttpError,
  LLMProtocolError,
  type CompletionOptions,
  type EmbedOptions,
  type LLMProvider,
} from "./provider.js";

export interface OllamaProviderOptions {
  /** Base URL; defaults to http://localhost:11434. */
  url?: string;
  /** Custom fetch; defaults to globalThis.fetch. Injected in tests. */
  fetchImpl?: typeof globalThis.fetch;
}

interface OllamaStreamLine {
  response?: string;
  done?: boolean;
  error?: string;
}

export class OllamaProvider implements LLMProvider {
  private readonly url: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: OllamaProviderOptions = {}) {
    this.url = opts.url ?? "http://localhost:11434";
    this.fetchImpl =
      opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /**
   * Liveness probe. GETs `/api/tags` with a short internal timeout.
   * Returns true on any 2xx response, false on any failure (network,
   * non-2xx, abort). Never throws.
   */
  async ping(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const internalAbort = new AbortController();
    const linkedAbort = (): void => internalAbort.abort();
    if (signal) signal.addEventListener("abort", linkedAbort, { once: true });
    const timer = setTimeout(() => internalAbort.abort(), 2000);
    try {
      const response = await this.fetchImpl(`${this.url}/api/tags`, {
        method: "GET",
        signal: internalAbort.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", linkedAbort);
    }
  }

  /**
   * Returns the list of installed model tags, or null if the server is
   * unreachable. Used for preflight checks.
   */
  async listModels(): Promise<string[] | null> {
    try {
      const response = await this.fetchImpl(`${this.url}/api/tags`, {
        method: "GET",
      });
      if (!response.ok) return null;
      const json = (await response.json()) as {
        models?: Array<{ name?: string }>;
      };
      return (json.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === "string");
    } catch {
      return null;
    }
  }

  async embed(opts: EmbedOptions): Promise<number[]> {
    if (opts.signal?.aborted) throw new LLMAbortError();

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: opts.model, prompt: opts.text }),
        signal: opts.signal,
      });
    } catch (err) {
      if (
        opts.signal?.aborted ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        throw new LLMAbortError();
      }
      throw new LLMConnectError(
        `Ollama embeddings fetch failed: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new LLMHttpError(
        `Ollama embeddings returned ${response.status}`,
        response.status,
      );
    }

    const json = (await response.json()) as { embedding?: unknown };
    if (
      !Array.isArray(json.embedding) ||
      !json.embedding.every((n) => typeof n === "number")
    ) {
      throw new LLMProtocolError(
        "Ollama embeddings response missing numeric embedding array",
      );
    }
    return json.embedding as number[];
  }

  async showModel(model: string): Promise<{ contextLength: number | null }> {
    try {
      const res = await this.fetchImpl(`${this.url}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: model }),
      });
      if (!res.ok) return { contextLength: null };
      const json = (await res.json()) as { model_info?: Record<string, unknown> };
      const info = json.model_info ?? {};
      for (const [k, v] of Object.entries(info)) {
        if (k.endsWith("context_length") && typeof v === "number") {
          return { contextLength: v };
        }
      }
      return { contextLength: null };
    } catch {
      return { contextLength: null };
    }
  }

  complete(opts: CompletionOptions): AsyncIterable<string> {
    const url = `${this.url}/api/generate`;
    const body = JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.1,
        num_ctx: opts.numCtx ?? 8192,
      },
    });
    const fetchImpl = this.fetchImpl;
    const signal = opts.signal;

    return (async function* () {
      if (signal?.aborted) throw new LLMAbortError();

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal,
        });
      } catch (e) {
        if (signal?.aborted) throw new LLMAbortError();
        throw new LLMConnectError(
          `Ollama fetch failed: ${(e as Error).message}`,
        );
      }

      if (!response.ok) {
        throw new LLMHttpError(
          `Ollama returned ${response.status}`,
          response.status,
        );
      }
      if (!response.body) {
        throw new LLMProtocolError("Ollama response had no body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          if (signal?.aborted) throw new LLMAbortError();
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl = buffer.indexOf("\n");
          while (nl !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line.length > 0) {
              const token = parseLine(line);
              if (token !== null) yield token;
            }
            nl = buffer.indexOf("\n");
          }
        }
        const tail = buffer.trim();
        if (tail.length > 0) {
          const token = parseLine(tail);
          if (token !== null) yield token;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    })();
  }
}

function parseLine(line: string): string | null {
  let parsed: OllamaStreamLine;
  try {
    parsed = JSON.parse(line) as OllamaStreamLine;
  } catch {
    throw new LLMProtocolError(
      `Ollama returned non-JSON line: ${line.slice(0, 100)}`,
    );
  }
  if (parsed.error) {
    throw new LLMHttpError(`Ollama error: ${parsed.error}`, null);
  }
  if (parsed.done === true) return null;
  return parsed.response ?? "";
}
