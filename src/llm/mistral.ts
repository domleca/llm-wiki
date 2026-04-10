/**
 * Mistral provider — implements `LLMProvider` against the Mistral
 * `/v1/chat/completions`, `/v1/embeddings`, and `/v1/models` endpoints.
 */

import {
  LLMAbortError,
  LLMConnectError,
  LLMHttpError,
  LLMProtocolError,
  type CompletionOptions,
  type EmbedOptions,
  type LLMProvider,
} from "./provider.js";
import { completionModels, findModel } from "./catalog.js";

export interface MistralProviderOptions {
  apiKey: string;
  /** Override base URL (for proxies). Defaults to https://api.mistral.ai. */
  baseUrl?: string;
  /** Custom fetch; defaults to globalThis.fetch. Injected in tests. */
  fetchImpl?: typeof globalThis.fetch;
}

export class MistralProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: MistralProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.mistral.ai").replace(/\/$/, "");
    this.fetchImpl =
      opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  async ping(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const internalAbort = new AbortController();
    const linkedAbort = (): void => internalAbort.abort();
    if (signal) signal.addEventListener("abort", linkedAbort, { once: true });
    const timer = setTimeout(() => internalAbort.abort(), 5000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: internalAbort.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", linkedAbort);
    }
  }

  async listModels(): Promise<string[] | null> {
    return completionModels("mistral").map((m) => m.id);
  }

  async showModel(model: string): Promise<{ contextLength: number | null }> {
    const entry = findModel(model);
    return { contextLength: entry?.contextLength ?? null };
  }

  async embed(opts: EmbedOptions): Promise<number[]> {
    if (opts.signal?.aborted) throw new LLMAbortError();

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          input: opts.text,
        }),
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
        `Mistral embeddings fetch failed: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new LLMHttpError(
        `Mistral embeddings returned ${response.status}`,
        response.status,
      );
    }

    const json = (await response.json()) as {
      data?: Array<{ embedding?: unknown }>;
    };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || !vec.every((n) => typeof n === "number")) {
      throw new LLMProtocolError(
        "Mistral embeddings response missing numeric embedding array",
      );
    }
    return vec as number[];
  }

  complete(opts: CompletionOptions): AsyncIterable<string> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = JSON.stringify({
      model: opts.model,
      stream: true,
      temperature: opts.temperature ?? 0.1,
      messages: [{ role: "user", content: opts.prompt }],
    });
    const apiKey = this.apiKey;
    const fetchImpl = this.fetchImpl;
    const signal = opts.signal;

    return (async function* () {
      if (signal?.aborted) throw new LLMAbortError();

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal,
        });
      } catch (e) {
        if (signal?.aborted) throw new LLMAbortError();
        throw new LLMConnectError(
          `Mistral fetch failed: ${(e as Error).message}`,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new LLMHttpError(
          `Mistral returned ${response.status}: ${text.slice(0, 200)}`,
          response.status,
        );
      }
      if (!response.body) {
        throw new LLMProtocolError("Mistral response had no body");
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

            if (line === "data: [DONE]") return;
            if (line.startsWith("data: ")) {
              const token = parseSSEData(line.slice(6));
              if (token) yield token;
            }
            nl = buffer.indexOf("\n");
          }
        }
        const tail = buffer.trim();
        if (tail === "data: [DONE]") return;
        if (tail.startsWith("data: ")) {
          const token = parseSSEData(tail.slice(6));
          if (token) yield token;
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

interface MistralStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
}

function parseSSEData(data: string): string | null {
  let parsed: MistralStreamChunk;
  try {
    parsed = JSON.parse(data) as MistralStreamChunk;
  } catch {
    throw new LLMProtocolError(
      `Mistral returned non-JSON SSE data: ${data.slice(0, 100)}`,
    );
  }
  const content = parsed.choices?.[0]?.delta?.content;
  if (content === undefined || content === null) return null;
  return content;
}
