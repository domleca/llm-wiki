/**
 * Anthropic provider — implements `LLMProvider` against the Anthropic
 * `/v1/messages` streaming endpoint.
 *
 * Anthropic has no embedding API, so `embed()` delegates to an injected
 * fallback provider (typically Ollama with nomic-embed-text).
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

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Provider used for embeddings (Anthropic has none). Typically Ollama. */
  embedProvider: LLMProvider;
  /** Custom fetch; defaults to globalThis.fetch. Injected in tests. */
  fetchImpl?: typeof globalThis.fetch;
}

export class AnthropicProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly embedProvider: LLMProvider;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: AnthropicProviderOptions) {
    this.apiKey = opts.apiKey;
    this.embedProvider = opts.embedProvider;
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
      // Anthropic has no lightweight "list models" endpoint, so we send
      // a minimal request and treat any non-network response as alive.
      const res = await this.fetchImpl(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 1,
            messages: [{ role: "user", content: "." }],
          }),
          signal: internalAbort.signal,
        },
      );
      // Any HTTP response means the API is reachable (even 4xx).
      return res.status !== 0;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", linkedAbort);
    }
  }

  async listModels(): Promise<string[] | null> {
    return completionModels("anthropic").map((m) => m.id);
  }

  async showModel(model: string): Promise<{ contextLength: number | null }> {
    const entry = findModel(model);
    return { contextLength: entry?.contextLength ?? null };
  }

  /** Delegates to the injected embed provider (Ollama). */
  async embed(opts: EmbedOptions): Promise<number[]> {
    return this.embedProvider.embed(opts);
  }

  complete(opts: CompletionOptions): AsyncIterable<string> {
    const url = "https://api.anthropic.com/v1/messages";
    const body = JSON.stringify({
      model: opts.model,
      max_tokens: opts.numCtx ?? 8192,
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
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body,
          signal,
        });
      } catch (e) {
        if (signal?.aborted) throw new LLMAbortError();
        throw new LLMConnectError(
          `Anthropic fetch failed: ${(e as Error).message}`,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new LLMHttpError(
          `Anthropic returned ${response.status}: ${text.slice(0, 200)}`,
          response.status,
        );
      }
      if (!response.body) {
        throw new LLMProtocolError("Anthropic response had no body");
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

            if (line.startsWith("data: ")) {
              const token = parseSSEData(line.slice(6));
              if (token) yield token;
            }
            nl = buffer.indexOf("\n");
          }
        }
        const tail = buffer.trim();
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

// ── SSE parsing ─────────────────────────────────────────────────────────

/**
 * Anthropic streaming events we care about:
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
 *
 *   event: message_stop
 *   data: {"type":"message_stop"}
 */
interface AnthropicSSEData {
  type?: string;
  delta?: { type?: string; text?: string };
}

function parseSSEData(data: string): string | null {
  let parsed: AnthropicSSEData;
  try {
    parsed = JSON.parse(data) as AnthropicSSEData;
  } catch {
    // Some SSE lines are event markers or pings — not JSON
    return null;
  }
  if (parsed.type === "content_block_delta" && parsed.delta?.text) {
    return parsed.delta.text;
  }
  return null;
}
