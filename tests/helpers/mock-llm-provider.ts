import type {
  CompletionOptions,
  LLMProvider,
} from "../../src/llm/provider.js";
import { LLMAbortError } from "../../src/llm/provider.js";

/**
 * Test double for LLMProvider. Returns canned responses in FIFO order,
 * recording every call so tests can assert ordering, model, prompt, etc.
 */
export class MockLLMProvider implements LLMProvider {
  readonly calls: CompletionOptions[] = [];
  private queue: string[];
  private errorQueue: (Error | null)[];
  private chunked: boolean;

  constructor(
    responses: string[] = [],
    options: { chunked?: boolean; errors?: (Error | null)[] } = {},
  ) {
    this.queue = [...responses];
    this.chunked = options.chunked ?? false;
    this.errorQueue = options.errors ? [...options.errors] : [];
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
          yield ch;
        }
      } else {
        if (signal?.aborted) throw new LLMAbortError();
        yield response;
      }
    })();
  }
}
