import type {
  CompletionOptions,
  EmbedOptions,
  LLMProvider,
} from "../../src/llm/provider.js";
import { LLMAbortError } from "../../src/llm/provider.js";

export interface MockLLMProviderOptions {
  responses?: string[];
  embeddings?: number[][];
  chunked?: boolean;
  errors?: (Error | null)[];
  chunkDelayMs?: number;
  /** What ping() should return. Defaults to true (reachable). */
  pingResult?: boolean;
}

/**
 * Test double for LLMProvider. Returns canned responses in FIFO order,
 * recording every call so tests can assert ordering, model, prompt, etc.
 *
 * Two constructor forms are supported for backward compatibility:
 *   new MockLLMProvider(["resp1"], { chunked: true })   // legacy positional
 *   new MockLLMProvider({ responses: ["resp1"], embeddings: [[1, 0]] })
 */
export class MockLLMProvider implements LLMProvider {
  readonly calls: CompletionOptions[] = [];
  readonly embedCalls: EmbedOptions[] = [];
  private queue: string[];
  private errorQueue: (Error | null)[];
  private chunked: boolean;
  private chunkDelayMs: number;
  private embeddings: number[][];
  private embedIdx = 0;
  pingResult = true;
  pingCalls = 0;

  constructor(
    responsesOrOptions: string[] | MockLLMProviderOptions = [],
    options: { chunked?: boolean; errors?: (Error | null)[] } = {},
  ) {
    if (Array.isArray(responsesOrOptions)) {
      this.queue = [...responsesOrOptions];
      this.chunked = options.chunked ?? false;
      this.errorQueue = options.errors ? [...options.errors] : [];
      this.embeddings = [];
      this.chunkDelayMs = 0;
    } else {
      const opts = responsesOrOptions;
      this.queue = opts.responses ? [...opts.responses] : [];
      this.chunked = opts.chunked ?? false;
      this.errorQueue = opts.errors ? [...opts.errors] : [];
      this.embeddings = opts.embeddings ? opts.embeddings.map((v) => [...v]) : [];
      this.chunkDelayMs = opts.chunkDelayMs ?? 0;
      if (opts.pingResult !== undefined) this.pingResult = opts.pingResult;
    }
  }

  async ping(): Promise<boolean> {
    this.pingCalls += 1;
    return this.pingResult;
  }

  async showModel(_model: string): Promise<{ contextLength: number | null }> {
    return { contextLength: null };
  }

  async embed(opts: EmbedOptions): Promise<number[]> {
    this.embedCalls.push(opts);
    if (this.embedIdx >= this.embeddings.length) {
      throw new Error("MockLLMProvider: no more embeddings in queue");
    }
    return this.embeddings[this.embedIdx++]!;
  }

  enqueue(response: string): void {
    this.queue.push(response);
  }

  enqueueError(err: Error | null): void {
    this.errorQueue.push(err);
  }

  complete(opts: CompletionOptions): AsyncIterable<string> {
    this.calls.push(opts);
    const response = this.queue.shift();
    const err = this.errorQueue.shift() ?? null;
    const chunked = this.chunked;
    const chunkDelayMs = this.chunkDelayMs;
    const signal = opts.signal;

    return (async function* () {
      if (err) throw err;
      if (response === undefined) {
        throw new Error(
          "MockLLMProvider: no canned response for this call (enqueue more before running the test)",
        );
      }
      if (chunked) {
        for (const ch of response) {
          if (signal?.aborted) throw new LLMAbortError();
          if (chunkDelayMs > 0) {
            await new Promise((r) => setTimeout(r, chunkDelayMs));
          }
          if (signal?.aborted) throw new LLMAbortError();
          yield ch;
        }
      } else {
        if (signal?.aborted) throw new LLMAbortError();
        yield response;
      }
    })();
  }
}
