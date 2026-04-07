/**
 * The LLMProvider interface is the single seam between the extraction/query
 * pipelines and any concrete LLM backend (Ollama locally, or later, cloud
 * APIs like OpenAI/Anthropic/Google).
 *
 * Phase 2 exposes only `complete()` — the only operation extraction needs.
 * Phase 3 will add `embed()` when query/embeddings.ts lands.
 * Phase 5 will add `listModels()` when the cloud model picker lands.
 */

export interface CompletionOptions {
  /** Fully-rendered prompt text sent to the model. */
  prompt: string;
  /** Model identifier — e.g. "qwen2.5:7b" for Ollama. */
  model: string;
  /** Sampling temperature. Extraction uses 0.1 (ported from Python). */
  temperature?: number;
  /** Context window size in tokens. Extraction uses 8192 (ported from Python). */
  numCtx?: number;
  /** Caller-owned AbortSignal. If it fires, the provider throws LLMAbortError. */
  signal?: AbortSignal;
}

/**
 * `complete()` returns an async iterable of string chunks. Each chunk is
 * whatever the provider's streaming transport delivers — for Ollama, one
 * `response` field per NDJSON line. Callers may either `for await` and
 * concat into a single string (extraction) or render progressively (query,
 * Phase 3).
 */
export interface LLMProvider {
  complete(opts: CompletionOptions): AsyncIterable<string>;
}

/**
 * Base class for all LLM-layer errors. Production code should catch
 * `LLMError` at the top of extraction callers and surface a useful message
 * to the user (status bar, log, etc.).
 */
export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

/** Thrown when the HTTP call fails (connection refused, 5xx, 4xx, etc.). */
export class LLMHttpError extends LLMError {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "LLMHttpError";
    this.status = status;
  }
}

/** Thrown when the caller aborts via AbortSignal. */
export class LLMAbortError extends LLMError {
  constructor() {
    super("LLM request aborted by caller");
    this.name = "LLMAbortError";
  }
}

/** Thrown when the response body cannot be interpreted as expected. */
export class LLMProtocolError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMProtocolError";
  }
}
