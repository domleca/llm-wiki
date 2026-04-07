import {
  LLMAbortError,
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
      throw new LLMHttpError(
        `Ollama embeddings fetch failed: ${(err as Error).message}`,
        null,
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
        throw new LLMHttpError(
          `Ollama fetch failed: ${(e as Error).message}`,
          null,
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
