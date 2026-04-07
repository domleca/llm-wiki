/**
 * A tiny in-memory mock for the global `fetch` function, tailored for
 * streaming NDJSON tests (Ollama). Lets tests assert on the exact request
 * that was made and construct a ReadableStream of response bytes split at
 * chosen boundaries.
 */

export interface RecordedFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  signal: AbortSignal | null;
}

export interface MockFetchResult {
  fetch: typeof globalThis.fetch;
  calls: RecordedFetchCall[];
}

export interface MockFetchResponse {
  status?: number;
  /** If provided, the response body streams these chunks in order. */
  chunks?: string[];
  /** If provided, the body is this static string (non-streaming). */
  body?: string;
  /** Optional throw instead of resolving. */
  throwError?: Error;
}

export function createMockFetch(queue: MockFetchResponse[]): MockFetchResult {
  const remaining = [...queue];
  const calls: RecordedFetchCall[] = [];

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k] = h[k]!;
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal ?? null,
    });

    const next = remaining.shift();
    if (!next) {
      throw new Error(
        "mockFetch: no queued response for call #" + calls.length,
      );
    }
    if (next.throwError) throw next.throwError;

    const signal = init?.signal;
    const chunks = next.chunks ?? (next.body ? [next.body] : []);
    const status = next.status ?? 200;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let i = 0;
        function pump(): void {
          if (signal?.aborted) {
            controller.error(new DOMException("Aborted", "AbortError"));
            return;
          }
          if (i >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(chunks[i]!));
          i++;
          queueMicrotask(pump);
        }
        pump();
      },
    });

    const response: Response = {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      body: stream,
      async text() {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let out = "";
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          out += decoder.decode(value);
        }
        return out;
      },
      async json() {
        return JSON.parse(await (this as Response).text());
      },
    } as unknown as Response;

    return response;
  };

  return { fetch: fetchImpl, calls };
}
