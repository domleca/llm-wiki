/**
 * OpenAI provider — implements `LLMProvider` against the OpenAI
 * `/v1/chat/completions` (streaming SSE) and `/v1/embeddings` endpoints.
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
import { findModel } from "./catalog.js";

export interface OpenAIProviderOptions {
  apiKey?: string;
  /** Override base URL (for proxies / Azure). Defaults to https://api.openai.com. */
  baseUrl?: string;
  /** Models endpoint path or absolute URL. Defaults to /v1/models. */
  modelsEndpoint?: string;
  /** Completions endpoint path or absolute URL. Defaults to /v1/chat/completions. */
  completionsEndpoint?: string;
  /** Embeddings endpoint path or absolute URL. Defaults to /v1/embeddings. */
  embeddingsEndpoint?: string;
  /** Custom fetch; defaults to globalThis.fetch. Injected in tests. */
  fetchImpl?: typeof globalThis.fetch;
}

export class OpenAIProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelsUrl: string;
  private readonly completionsUrl: string;
  private readonly embeddingsUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: OpenAIProviderOptions) {
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = normalizeBaseUrl(opts.baseUrl ?? "https://api.openai.com");
    this.modelsUrl = endpointUrl(this.baseUrl, opts.modelsEndpoint ?? "/v1/models");
    this.completionsUrl = endpointUrl(
      this.baseUrl,
      opts.completionsEndpoint ?? "/v1/chat/completions",
    );
    this.embeddingsUrl = endpointUrl(
      this.baseUrl,
      opts.embeddingsEndpoint ?? "/v1/embeddings",
    );
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
      const res = await this.fetchImpl(this.modelsUrl, {
        method: "GET",
        headers: authHeaders(this.apiKey),
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
    try {
      const response = await this.fetchImpl(this.modelsUrl, {
        method: "GET",
        headers: authHeaders(this.apiKey),
      });
      if (!response.ok) return null;
      const json = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
      };
      if (!Array.isArray(json.data)) return null;
      const ids = json.data
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === "string");
      return ids.length > 0 ? ids.sort((a, b) => a.localeCompare(b)) : null;
    } catch {
      return null;
    }
  }

  async showModel(model: string): Promise<{ contextLength: number | null }> {
    const entry = findModel(model);
    return { contextLength: entry?.contextLength ?? null };
  }

  async embed(opts: EmbedOptions): Promise<number[]> {
    if (opts.signal?.aborted) throw new LLMAbortError();

    let response: Response;
    try {
      response = await this.fetchImpl(this.embeddingsUrl, {
        method: "POST",
        headers: {
          ...authHeaders(this.apiKey),
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
        `OpenAI embeddings fetch failed: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new LLMHttpError(
        `OpenAI embeddings returned ${response.status}`,
        response.status,
      );
    }

    const json = (await response.json()) as {
      data?: Array<{ embedding?: unknown }>;
    };
    const vec = json.data?.[0]?.embedding;
    if (
      !Array.isArray(vec) ||
      !vec.every((n) => typeof n === "number")
    ) {
      throw new LLMProtocolError(
        "OpenAI embeddings response missing numeric embedding array",
      );
    }
    return vec as number[];
  }

  complete(opts: CompletionOptions): AsyncIterable<string> {
    const url = this.completionsUrl;
    const legacyCompletions = isLegacyCompletionsUrl(url);
    const body = JSON.stringify({
      model: opts.model,
      stream: true,
      temperature: opts.temperature ?? 0.1,
      ...(legacyCompletions
        ? { prompt: opts.prompt }
        : { messages: [{ role: "user", content: opts.prompt }] }),
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
            ...authHeaders(apiKey),
            "Content-Type": "application/json",
          },
          body,
          signal,
        });
      } catch (e) {
        if (signal?.aborted) throw new LLMAbortError();
        throw new LLMConnectError(
          `OpenAI fetch failed: ${(e as Error).message}`,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new LLMHttpError(
          `OpenAI returned ${response.status}: ${text.slice(0, 200)}`,
          response.status,
        );
      }
      if (!response.body) {
        throw new LLMProtocolError("OpenAI response had no body");
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
        // Handle any remaining data in buffer
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

function normalizeBaseUrl(raw: string): string {
  const noTrailingSlash = raw.replace(/\/+$/, "");
  // Accept both "https://host" and "https://host/v1" in settings,
  // and recover from mistakenly persisted ".../v1/v1" values.
  return noTrailingSlash.replace(/(?:\/v1)+$/i, "");
}

function endpointUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${baseUrl}/${endpoint.replace(/^\/+/, "")}`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function isLegacyCompletionsUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\/completions$/i.test(pathname) && !/\/chat\/completions$/i.test(pathname);
  } catch {
    return /\/completions$/i.test(url) && !/\/chat\/completions$/i.test(url);
  }
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    text?: string;
    finish_reason?: string | null;
  }>;
}

function parseSSEData(data: string): string | null {
  let parsed: OpenAIStreamChunk;
  try {
    parsed = JSON.parse(data) as OpenAIStreamChunk;
  } catch {
    throw new LLMProtocolError(
      `OpenAI returned non-JSON SSE data: ${data.slice(0, 100)}`,
    );
  }
  const choice = parsed.choices?.[0];
  const content = choice?.delta?.content ?? choice?.text;
  if (content === undefined || content === null) return null;
  return content;
}
