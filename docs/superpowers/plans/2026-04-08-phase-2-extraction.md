# LLM Wiki Plugin — Phase 2 Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an "LLM Wiki — Extraction Beta" plugin that walks the vault, extracts structured knowledge from each file by calling Ollama, and merges the results into the shared `knowledge.json`. End state: from inside Obsidian, the user runs `LLM Wiki: Run extraction now` (or the single-file variant), watches a status bar widget count through files with a measured-rate ETA, can cancel mid-run, and ends up with a knowledge base that is byte-equivalent to what the Python CLI would produce. **Phase 2 writes only `wiki/knowledge.json`. It does not write per-entity/concept/source markdown pages — that is Phase 4.**

**Architecture:** Port the proven three-stage pipeline from `~/tools/llm-wiki/extract.py` — prompt build → Ollama NDJSON stream → robust JSON parse → KB merge → checkpoint-save — onto Phase 1's `core/` + `vault/` foundation. Introduce four new module directories: `src/llm/` (`provider.ts` interface + `ollama.ts` implementation, streaming via `fetch` ReadableStream with `AbortSignal`), `src/extract/` (`prompts.ts`, `parser.ts`, `extractor.ts`, `queue.ts`), `src/runtime/` (`progress.ts` — a typed `EventTarget` the queue publishes to), and `src/ui/settings/` + `src/ui/status-bar.ts` (status widget subscribes to the progress emitter; minimal Indexing settings section). Extraction is strictly serial (one file in flight at a time), cancellable at file boundaries via a single `AbortController`, idempotent via Phase 1's `kb.needsExtraction()` mtime check, and saves the KB every 5 files plus once at end-of-batch. Crash recovery is idempotent-replay only: restart = re-run; already-processed files get skipped by mtime. On a `KBStaleError` at checkpoint time the batch aborts cleanly and surfaces an error in the status bar — no merge-on-conflict. No `extraction-state.json` file in Phase 2 (deferred to Phase 5). No on-save watcher, no scheduler, no cloud providers, no page generation, no dream — those are Phase 4/5.

**Tech Stack:**
- **Language:** TypeScript 5.4 strict (existing from Phase 1)
- **Bundler:** esbuild (existing)
- **Test runner:** Vitest 1.5+ (existing)
- **Property tests:** fast-check (existing, for `parser.ts` invariants)
- **HTTP:** Browser `fetch` + `ReadableStream` (Obsidian desktop runs on Electron, so `fetch` is available)
- **Cancellation:** `AbortController` / `AbortSignal` (native)
- **LLM backend:** Ollama at `http://localhost:11434/api/generate` with `stream: true`, NDJSON response body
- **Mocking:** hand-rolled `MockLLMProvider` (no network) + hand-rolled `mockFetch` in `tests/helpers/`
- **Source spec:** `docs/superpowers/specs/2026-04-07-llm-wiki-obsidian-plugin-design.md` sections 5.1, 6, 7.4, 8.10, 9.3, 10 (Phase 2 row)
- **Python reference:** `~/tools/llm-wiki/extract.py`, `~/tools/llm-wiki/prompts.py`, `~/tools/llm-wiki/parser.py`, `~/tools/llm-wiki/llm.py`

---

## Phase 2 Architecture Calls (locked in during brainstorm, 2026-04-07)

These seven decisions are load-bearing for the plan below. If a future reviewer wants to change one, the tasks that depend on it must be rewritten.

1. **Scope — JSON-only.** Phase 2 writes only `wiki/knowledge.json`. No `wiki/entities/*.md`, `wiki/concepts/*.md`, `wiki/sources/*.md`, `wiki/index.md`, `wiki/log.md`. The existing path allowlist already permits all those — we simply do not write to them yet. Phase 4 adds `pages/`.
2. **`LLMProvider` interface — minimal.** Define only `complete(opts: CompletionOptions): AsyncIterable<string>`. `embed()` ships in Phase 3 when `query/embeddings.ts` needs it; `listModels()` ships in Phase 5 with the curated cloud/Ollama model picker.
3. **Crash recovery — idempotent replay only.** No `extraction-state.json`. Restart = re-run the command; `kb.needsExtraction(path, mtime)` (already shipped in Phase 1) skips processed files automatically. Phase 5 revisits this with the scheduler.
4. **Model selection UI — single plain text field.** Settings tab Indexing section has `Ollama model: [qwen2.5:7b]` as a plain text input. Phase 5 replaces it with the curated cards picker. Default matches the Python tool.
5. **ETA — measured-rate only.** `Indexing N/total · ~Xh Ym` computed from `(elapsed / completed) × remaining`. Displays `· estimating…` until at least 3 files have completed. The lookup-table-based instant ETA is Phase 6.
6. **Concurrency — strictly serial.** One file in flight at a time to Ollama. Parallelism would just queue on the same GPU. Matches the Python tool.
7. **mtime-conflict handling — abort the batch cleanly.** If `saveKB` throws `KBStaleError` at a checkpoint, stop processing, flush a `extraction-error` event via the progress emitter, leave any already-saved work in place, and show `🧠 ⚠ KB modified externally — re-run to continue` in the status bar. No merge-on-conflict.

---

## File Structure (locked in for Phase 2)

```
llm-wiki-plugin/
├── src/
│   ├── core/                                   # Phase 1 — unchanged
│   ├── vault/                                  # Phase 1 — unchanged
│   │
│   ├── llm/                                    # NEW — LLM provider abstraction
│   │   ├── provider.ts                         # LLMProvider interface + CompletionOptions + LLMError
│   │   └── ollama.ts                           # OllamaProvider — fetch + ReadableStream NDJSON parser
│   │
│   ├── extract/                                # NEW — extraction pipeline
│   │   ├── prompts.ts                          # EXTRACT_PROMPT template + buildExtractionPrompt()
│   │   ├── parser.ts                           # parseExtraction() — robust to 7B model quirks
│   │   ├── extractor.ts                        # extractFile() — single-file pipeline
│   │   ├── queue.ts                            # runExtraction() — serial batch + checkpoints + cancel
│   │   └── defaults.ts                         # DEFAULT_WALK_OPTIONS + DEFAULT_CHAR_LIMIT constants
│   │
│   ├── runtime/                                # NEW — background work coordination
│   │   └── progress.ts                         # ProgressEmitter (typed EventTarget) + event type union
│   │
│   ├── ui/
│   │   ├── modal/                              # Phase 1 — unchanged
│   │   │   └── vocabulary-modal.ts
│   │   ├── status-bar.ts                       # NEW — status bar widget subscribed to ProgressEmitter
│   │   └── settings/                           # NEW
│   │       ├── settings-tab.ts                 # main settings tab entry — loads sections in order
│   │       └── indexing-section.ts             # the only section for Phase 2
│   │
│   └── plugin.ts                               # MODIFIED — wire provider, emitter, status bar, commands, settings tab
│
└── tests/
    ├── core/                                   # Phase 1 — unchanged
    ├── vault/                                  # Phase 1 — unchanged
    ├── helpers/
    │   ├── mock-app.ts                         # Phase 1 — unchanged
    │   ├── mock-llm-provider.ts                # NEW — canned-response LLMProvider for tests
    │   ├── mock-fetch.ts                       # NEW — in-memory fetch mock w/ ReadableStream support
    │   └── temp-vault.ts                       # Phase 1 — unchanged (if present; else skip)
    ├── fixtures/
    │   ├── sample-kb.json                      # Phase 1 — unchanged
    │   └── raw-llm-responses/                  # NEW
    │       ├── happy.txt                       # clean JSON
    │       ├── markdown-fenced.txt             # ```json ... ``` wrapper
    │       ├── trailing-commas.txt             # JSON with trailing commas
    │       ├── preamble-postamble.txt          # "Sure! Here's the JSON: {...} Let me know if..."
    │       ├── no-braces.txt                   # unparseable garbage
    │       └── empty.txt                       # empty string
    ├── llm/
    │   └── ollama.test.ts                      # NEW
    ├── extract/
    │   ├── prompts.test.ts                     # NEW
    │   ├── parser.test.ts                      # NEW
    │   ├── parser.property.test.ts             # NEW — fast-check invariants
    │   ├── extractor.test.ts                   # NEW
    │   └── queue.test.ts                       # NEW
    ├── runtime/
    │   └── progress.test.ts                    # NEW
    ├── ui/
    │   └── status-bar.test.ts                  # NEW (logic-only, DOM via JSDOM if needed — else pure-function tests)
    └── integration/
        └── phase2-extraction.test.ts           # NEW — full pipeline, crash recovery, mtime-conflict
```

**Why this structure:**

- `llm/`, `extract/`, `runtime/` are each new top-level module directories per the spec's §4 layering. They did not exist in Phase 1 because Phase 1 had no LLM calls and no background work. Adding them as siblings of `core/` and `vault/` keeps the spec's `ui/ → runtime/ → extract|query|dream → llm + vault → core` dependency direction intact.
- `extract/defaults.ts` holds the two hard-coded constants (walker options + char limit) that Phase 5 will move into settings. Isolating them now means Phase 5 is a pure refactor.
- `tests/helpers/mock-llm-provider.ts` and `tests/helpers/mock-fetch.ts` exist **only** under `tests/helpers/` — the production code has zero knowledge of test doubles. Extraction code takes an `LLMProvider` parameter, so swapping in the mock is a constructor argument swap.
- `tests/integration/phase2-extraction.test.ts` is the only new integration test file for this phase. It exercises the full wiring — walker → KB → queue → provider → progress → KB save — with the mock provider. E2E tests against real Obsidian and real Ollama are deferred to Phase 6.
- The ESLint rule `no-direct-vault-write` already forbids direct vault writes outside `src/vault/`. All Phase 2 writes go through `saveKB` (for `knowledge.json`) and `safeWritePluginData` (for `.obsidian/plugins/llm-wiki/extraction-log.jsonl`, if we add one — we won't in Phase 2, but the lint rule stays on regardless). Nothing new to configure.

---

## Critical Conventions for All Tasks

- **Conventional Commits.** `feat(llm): add OllamaProvider streaming`, `test(extract): add parser fixtures for 7B quirks`, `fix(queue): handle KBStaleError on checkpoint`, `chore(deps): …`, `docs: …`, `ci: …`. Scope = the module directory name (`llm`, `extract`, `runtime`, `ui`, `plugin`, `vault`, `core`).
- **TDD five-step loop, every code task.** (1) Write the failing test. (2) Run it, confirm the exact failure message. (3) Write the minimum code. (4) Run it, confirm the green. (5) Commit. **Do not skip step 2.** The failing run is what proves the test is real.
- **ESM import syntax with `.js` extensions** — even when importing `.ts` files (`import { x } from "./y.js"`). This is already the Phase 1 convention and matches the `moduleResolution: "Bundler"` config.
- **Strict TypeScript.** No implicit `any`, no unused locals, explicit return types on exported functions, exhaustive switches.
- **Vitest `describe`/`it`/`expect`** exclusively. No Jest globals, no Mocha syntax.
- **Never call `app.vault.create`, `app.vault.modify`, `app.vault.adapter.write`, `app.vault.delete`, or `app.fileManager.processFrontMatter` outside `src/vault/`.** The custom ESLint rule `no-direct-vault-write` fails the build if you do. All Phase 2 writes go through Phase 1's `saveKB` helper.
- **The fixture sample KB** at `tests/fixtures/sample-kb.json` is read-only. If a test needs to modify a KB, construct a new `KnowledgeBase()` or deep-clone the fixture.
- **Run `npm run lint && npm run typecheck && npm test` before every commit.** Per-task steps spell this out.
- **Keep `src/plugin.ts` additions diff-minimal per task.** We touch it in six separate tasks; each should be a small, focused addition, not a rewrite.

---

## Self-Check Before You Start

Before writing any Phase 2 code, run:

```bash
cd /Users/dominiqueleca/tools/llm-wiki-plugin
git status              # expect: clean working tree on master
git log --oneline -5    # expect: Phase 1 merge commit as HEAD
npm test                # expect: all Phase 1 tests green
npm run lint            # expect: zero errors
npm run typecheck       # expect: zero errors
```

If any of these are not clean, **stop and report before proceeding**. Phase 2 assumes Phase 1 is green on master.

Then create a working branch:

```bash
git checkout -b feature/phase-2-extraction
```

All Phase 2 commits go on this branch. It will be merged to master at the end of Task 25.

---

## Task 1: Add `LLMProvider` interface + `CompletionOptions` + `LLMError`

**Files:**
- Create: `src/llm/provider.ts`

**What & why:** This is the abstraction the whole extraction pipeline depends on. Minimal surface — just `complete()` — so Phase 3's embeddings and Phase 5's cloud providers can extend it additively. No tests: it's a type-only file. The test comes in Task 4 when we have a concrete implementation and a mock.

- [ ] **Step 1: Create `src/llm/provider.ts`**

Write this exact content:

```ts
/**
 * The LLMProvider interface is the single seam between the extraction/query
 * pipelines and any concrete LLM backend (Ollama locally, or later, cloud
 * APIs like OpenAI/Anthropic/Google).
 *
 * Phase 2 exposes only `complete()` — the only operation extraction needs.
 * Phase 3 will add `embed()` when query/embeddings.ts lands.
 * Phase 5 will add `listModels()` when the cloud model picker lands.
 *
 * Keeping the interface small means the MockLLMProvider in tests stays tiny
 * and concrete providers only implement what their phase actually uses.
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
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/dominiqueleca/tools/llm-wiki-plugin && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Lint**

Run:
```bash
npm run lint
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/llm/provider.ts
git commit -m "feat(llm): add LLMProvider interface and typed error classes"
```

---

## Task 2: Add `MockLLMProvider` test helper

**Files:**
- Create: `tests/helpers/mock-llm-provider.ts`

**What & why:** A canned-response provider so extraction tests never touch real HTTP. Tiny by design — it takes a list of prompts-and-responses (or just a FIFO response list) and yields them. Supports `AbortSignal` to exercise cancellation paths.

- [ ] **Step 1: Create `tests/helpers/mock-llm-provider.ts`**

Write this exact content:

```ts
import type {
  CompletionOptions,
  LLMProvider,
} from "../../src/llm/provider.js";
import { LLMAbortError } from "../../src/llm/provider.js";

/**
 * Test double for LLMProvider. Returns canned responses in FIFO order,
 * or in a specific order by matching a prompt substring. Records every
 * call so tests can assert ordering, model parameters, etc.
 *
 * Usage:
 *   const mock = new MockLLMProvider([
 *     "{ \"entities\": [], \"concepts\": [], \"connections\": [] }",
 *   ]);
 *   await runExtraction({ provider: mock, ... });
 *   expect(mock.calls).toHaveLength(1);
 */
export class MockLLMProvider implements LLMProvider {
  readonly calls: CompletionOptions[] = [];
  private queue: string[];
  private errorQueue: (Error | null)[];
  /** If true, split each queued response into single-character chunks
   *  (simulates streaming). */
  private chunked: boolean;

  constructor(
    responses: string[] = [],
    options: { chunked?: boolean; errors?: (Error | null)[] } = {},
  ) {
    this.queue = [...responses];
    this.chunked = options.chunked ?? false;
    this.errorQueue = options.errors ? [...options.errors] : [];
  }

  /** Enqueue another canned response for a later call. */
  enqueue(response: string): void {
    this.queue.push(response);
  }

  /** Enqueue an error that the NEXT call will throw (from within the
   *  async iterable, not synchronously). Use null as a placeholder to
   *  skip an index. */
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
          "MockLLMProvider: no canned response for call #" +
            "(enqueue more before running the test)",
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/mock-llm-provider.ts
git commit -m "test(helpers): add MockLLMProvider for extraction tests"
```

---

## Task 3: Add `mockFetch` test helper for Ollama tests

**Files:**
- Create: `tests/helpers/mock-fetch.ts`

**What & why:** Ollama tests need to assert that `fetch` was called with the right URL and body, and need to return a synthetic `ReadableStream` that yields NDJSON chunks. Hand-rolling a tiny mock is simpler than reaching for a library and gives exact control over chunk boundaries.

- [ ] **Step 1: Create `tests/helpers/mock-fetch.ts`**

Write this exact content:

```ts
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
  /** The fetch implementation to assign to `globalThis.fetch` for the test. */
  fetch: typeof globalThis.fetch;
  /** Every call made to the mock, in order. */
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

/**
 * Build a mock fetch that responds to every call with the next queued
 * response. Responses are consumed in FIFO order.
 */
export function createMockFetch(queue: MockFetchResponse[]): MockFetchResult {
  const remaining = [...queue];
  const calls: RecordedFetchCall[] = [];

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
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
          // Push next chunk on the next microtask to simulate streaming.
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
        return JSON.parse(await this.text());
      },
    } as unknown as Response;

    return response;
  };

  return { fetch: fetchImpl, calls };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/mock-fetch.ts
git commit -m "test(helpers): add streaming fetch mock for Ollama tests"
```

---

## Task 4: `OllamaProvider` — happy path (single streamed NDJSON line)

**Files:**
- Create: `src/llm/ollama.ts`
- Create: `tests/llm/ollama.test.ts`

**What & why:** First concrete `LLMProvider`. Ollama's `/api/generate` endpoint with `stream: true` returns newline-delimited JSON where each line has the shape `{"model":"...","response":"token","done":false}` and the final line has `"done":true`. We parse each line, yield its `response` field, and stop on `done: true`. Build this up with three tests — happy path (this task), split-across-chunks (Task 5), abort + errors (Task 6).

- [ ] **Step 1: Write the failing test**

Create `tests/llm/ollama.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OllamaProvider } from "../../src/llm/ollama.js";
import { createMockFetch } from "../helpers/mock-fetch.js";

const origFetch = globalThis.fetch;

describe("OllamaProvider.complete", () => {
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("streams tokens from a single-chunk NDJSON response", async () => {
    const ndjson =
      JSON.stringify({ response: "Hello", done: false }) +
      "\n" +
      JSON.stringify({ response: " world", done: false }) +
      "\n" +
      JSON.stringify({ response: "", done: true }) +
      "\n";
    const mock = createMockFetch([{ chunks: [ndjson] }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({ url: "http://localhost:11434" });
    const tokens: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "hi",
      model: "qwen2.5:7b",
    })) {
      tokens.push(chunk);
    }

    expect(tokens.join("")).toBe("Hello world");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toBe("http://localhost:11434/api/generate");
    expect(mock.calls[0]!.method).toBe("POST");
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.prompt).toBe("hi");
    expect(body.stream).toBe(true);
    expect(body.options.temperature).toBe(0.1);
    expect(body.options.num_ctx).toBe(8192);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- tests/llm/ollama.test.ts
```
Expected: FAIL with `Cannot find module '../../src/llm/ollama.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/llm/ollama.ts`:

```ts
import {
  LLMAbortError,
  LLMHttpError,
  LLMProtocolError,
  type CompletionOptions,
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
    this.fetchImpl = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
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
        // Flush any trailing partial line (should not normally occur).
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
    throw new LLMProtocolError(`Ollama returned non-JSON line: ${line.slice(0, 100)}`);
  }
  if (parsed.error) {
    throw new LLMHttpError(`Ollama error: ${parsed.error}`, null);
  }
  if (parsed.done === true) return null;
  return parsed.response ?? "";
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- tests/llm/ollama.test.ts
```
Expected: 1 passing.

- [ ] **Step 5: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/llm/ollama.ts tests/llm/ollama.test.ts
git commit -m "feat(llm): add OllamaProvider with NDJSON streaming"
```

---

## Task 5: `OllamaProvider` — NDJSON split across multiple chunks

**Files:**
- Modify: `tests/llm/ollama.test.ts` (append one test)

**What & why:** Real `ReadableStream` chunks don't arrive on line boundaries. The parser must buffer bytes, split on `\n`, and yield each complete line. This test verifies that behavior by splitting a single NDJSON line across two chunks.

- [ ] **Step 1: Add the failing test**

Append to `tests/llm/ollama.test.ts` inside the existing `describe`:

```ts
  it("handles NDJSON lines split across chunks", async () => {
    const full =
      JSON.stringify({ response: "foo", done: false }) +
      "\n" +
      JSON.stringify({ response: "bar", done: false }) +
      "\n" +
      JSON.stringify({ response: "", done: true }) +
      "\n";
    // Split the bytes at position 8 (mid-JSON) and again in the middle of
    // the second line, to exercise buffer join logic.
    const mid = Math.floor(full.length / 2);
    const chunks = [full.slice(0, 8), full.slice(8, mid), full.slice(mid)];
    const mock = createMockFetch([{ chunks }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({ url: "http://localhost:11434" });
    const out: string[] = [];
    for await (const chunk of provider.complete({
      prompt: "x",
      model: "qwen2.5:7b",
    })) {
      out.push(chunk);
    }
    expect(out.join("")).toBe("foobar");
  });
```

- [ ] **Step 2: Run the test**

```bash
npm test -- tests/llm/ollama.test.ts
```
Expected: PASS (the Task 4 implementation already buffers on newlines; this test locks in that behavior).

If it fails, the fix is almost certainly a bug in the buffer logic — review the `while (nl !== -1)` loop.

- [ ] **Step 3: Commit**

```bash
git add tests/llm/ollama.test.ts
git commit -m "test(llm): lock in NDJSON split-across-chunks behavior"
```

---

## Task 6: `OllamaProvider` — AbortSignal + HTTP errors

**Files:**
- Modify: `tests/llm/ollama.test.ts` (append two tests)

**What & why:** Extraction depends on `AbortController` for cancellation. A 500 from Ollama must surface as `LLMHttpError`, not a silent empty stream.

- [ ] **Step 1: Add failing tests**

Append to `tests/llm/ollama.test.ts` inside the existing `describe`:

```ts
  it("throws LLMAbortError if signal is already aborted", async () => {
    const mock = createMockFetch([{ chunks: ["{}"] }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({});
    const controller = new AbortController();
    controller.abort();

    await expect(async () => {
      for await (const _ of provider.complete({
        prompt: "x",
        model: "qwen2.5:7b",
        signal: controller.signal,
      })) {
        void _;
      }
    }).rejects.toMatchObject({ name: "LLMAbortError" });
  });

  it("throws LLMHttpError on non-2xx response", async () => {
    const mock = createMockFetch([{ status: 500, body: "boom" }]);
    globalThis.fetch = mock.fetch;

    const provider = new OllamaProvider({});
    await expect(async () => {
      for await (const _ of provider.complete({
        prompt: "x",
        model: "qwen2.5:7b",
      })) {
        void _;
      }
    }).rejects.toMatchObject({ name: "LLMHttpError", status: 500 });
  });
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- tests/llm/ollama.test.ts
```
Expected: PASS (the Task 4 implementation already handles both cases — these tests just pin the behavior).

- [ ] **Step 3: Commit**

```bash
git add tests/llm/ollama.test.ts
git commit -m "test(llm): cover AbortSignal and HTTP error paths"
```

---

## Task 7: Extraction prompt template

**Files:**
- Create: `src/extract/prompts.ts`
- Create: `tests/extract/prompts.test.ts`

**What & why:** Port the `EXTRACT_PROMPT` from `~/tools/llm-wiki/extract.py`. Phase 2 must emit the exact same prompt text as the Python tool so the resulting `knowledge.json` is byte-compatible on re-extraction. Test verifies all three template variables are substituted.

- [ ] **Step 1: Write the failing test**

Create `tests/extract/prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "../../src/extract/prompts.js";

describe("buildExtractionPrompt", () => {
  it("substitutes vocabulary, source path, and content", () => {
    const out = buildExtractionPrompt({
      vocabulary: "=== KNOWN ENTITIES ===\n- [person] Alan Watts",
      sourcePath: "Books/watts.md",
      content: "Alan Watts wrote The Wisdom of Insecurity.",
    });
    expect(out).toContain("=== KNOWN ENTITIES ===");
    expect(out).toContain("- [person] Alan Watts");
    expect(out).toContain("DOCUMENT (Books/watts.md):");
    expect(out).toContain("Alan Watts wrote The Wisdom of Insecurity.");
    expect(out).toContain("RULES:");
    expect(out).toContain("JSON object, no markdown fences");
    expect(out).toContain("source_summary");
    expect(out).toContain("entities");
    expect(out).toContain("concepts");
    expect(out).toContain("connections");
  });

  it("does not leave unsubstituted placeholders", () => {
    const out = buildExtractionPrompt({
      vocabulary: "(empty)",
      sourcePath: "x.md",
      content: "body",
    });
    expect(out).not.toMatch(/\{vocabulary\}|\{source_path\}|\{content\}/);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npm test -- tests/extract/prompts.test.ts
```
Expected: FAIL with `Cannot find module '../../src/extract/prompts.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/extract/prompts.ts`:

```ts
/**
 * Extraction prompt template. Ported byte-for-byte from
 * ~/tools/llm-wiki/extract.py (EXTRACT_PROMPT) so that both the Python CLI
 * and the plugin produce identical extraction requests for the same model +
 * same vault content.
 */

export interface BuildExtractionPromptArgs {
  vocabulary: string;
  sourcePath: string;
  content: string;
}

const TEMPLATE = `You are a knowledge extraction system. Given a document and a vocabulary of already-known entities and concepts, extract structured knowledge.

RULES:
1. If an entity or concept already exists in the vocabulary, USE ITS EXACT NAME. Do not create duplicates or variants.
2. Only create a NEW entity/concept if it is clearly absent from the vocabulary.
3. Be conservative — extract only what the document actually says, not inferences.
4. All output must be in English regardless of the source language.
5. Every entity needs a type: person, org, tool, project, book, article, place, event, other.
6. Connections have a type: influences, uses, critiques, extends, part-of, created-by, related-to, applies-to, contrasts-with.

CURRENT VOCABULARY:
{vocabulary}

DOCUMENT ({source_path}):
---
{content}
---

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "source_summary": "1-2 sentence summary of what this document is about",
  "entities": [
    {
      "name": "Exact Name",
      "type": "person|org|tool|project|book|article|place|event|other",
      "aliases": ["optional", "other names"],
      "facts": ["factual statement from this document"]
    }
  ],
  "concepts": [
    {
      "name": "Concept Name",
      "definition": "Brief definition based on document content",
      "related": ["names of related concepts or entities"]
    }
  ],
  "connections": [
    {
      "from": "Entity or Concept Name",
      "to": "Entity or Concept Name",
      "type": "influences|uses|critiques|extends|part-of|created-by|related-to|applies-to|contrasts-with",
      "description": "Brief description of the relationship"
    }
  ]
}
`;

export function buildExtractionPrompt(args: BuildExtractionPromptArgs): string {
  return TEMPLATE.replace("{vocabulary}", args.vocabulary)
    .replace("{source_path}", args.sourcePath)
    .replace("{content}", args.content);
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
npm test -- tests/extract/prompts.test.ts
```
Expected: 2 passing.

- [ ] **Step 5: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/extract/prompts.ts tests/extract/prompts.test.ts
git commit -m "feat(extract): port extraction prompt template from Python"
```

---

## Task 8: Extraction parser — fixtures + happy path

**Files:**
- Create: `tests/fixtures/raw-llm-responses/happy.txt`
- Create: `tests/fixtures/raw-llm-responses/markdown-fenced.txt`
- Create: `tests/fixtures/raw-llm-responses/trailing-commas.txt`
- Create: `tests/fixtures/raw-llm-responses/preamble-postamble.txt`
- Create: `tests/fixtures/raw-llm-responses/no-braces.txt`
- Create: `tests/fixtures/raw-llm-responses/empty.txt`
- Create: `src/extract/parser.ts`
- Create: `tests/extract/parser.test.ts`

**What & why:** Port `parse_extraction()` from `~/tools/llm-wiki/extract.py` and its helpers from `~/tools/llm-wiki/parser.py`. The parser must handle six shapes of raw LLM output: clean, markdown-fenced, trailing-commas, preamble/postamble, garbage, and empty. Start with the happy case; Task 9 adds quirks; Task 10 adds property-based invariants.

- [ ] **Step 1: Create fixture files**

Create `tests/fixtures/raw-llm-responses/happy.txt`:

```
{
  "source_summary": "Short note about Alan Watts and zen.",
  "entities": [
    {"name": "Alan Watts", "type": "person", "aliases": ["A.W."], "facts": ["wrote The Wisdom of Insecurity"]}
  ],
  "concepts": [
    {"name": "Zen", "definition": "A school of Mahayana Buddhism.", "related": ["Alan Watts"]}
  ],
  "connections": [
    {"from": "Alan Watts", "to": "Zen", "type": "influences", "description": "Popularized zen in the West"}
  ]
}
```

Create `tests/fixtures/raw-llm-responses/markdown-fenced.txt`:

````
```json
{
  "source_summary": "Fenced.",
  "entities": [{"name": "X", "type": "other", "aliases": [], "facts": ["f"]}],
  "concepts": [],
  "connections": []
}
```
````

Create `tests/fixtures/raw-llm-responses/trailing-commas.txt`:

```
{
  "source_summary": "Trailing comma example.",
  "entities": [
    {"name": "Foo", "type": "other", "aliases": [], "facts": ["a",]},
  ],
  "concepts": [],
  "connections": [],
}
```

Create `tests/fixtures/raw-llm-responses/preamble-postamble.txt`:

```
Sure! Here is the extraction you asked for:

{
  "source_summary": "Preamble test.",
  "entities": [{"name": "Bar", "type": "tool", "aliases": [], "facts": ["does things"]}],
  "concepts": [],
  "connections": []
}

Let me know if you need anything else!
```

Create `tests/fixtures/raw-llm-responses/no-braces.txt`:

```
I'm sorry, I can't do that.
```

Create `tests/fixtures/raw-llm-responses/empty.txt` (zero-byte file — just touch it):

```bash
touch tests/fixtures/raw-llm-responses/empty.txt
```

- [ ] **Step 2: Write the failing test**

Create `tests/extract/parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseExtraction } from "../../src/extract/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = join(here, "..", "fixtures", "raw-llm-responses");
const fx = (name: string): string => readFileSync(join(fixDir, name), "utf8");

describe("parseExtraction — happy path", () => {
  it("parses clean JSON into the expected shape", () => {
    const parsed = parseExtraction(fx("happy.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.source_summary).toMatch(/Alan Watts/);
    expect(parsed!.entities).toHaveLength(1);
    expect(parsed!.entities[0]!.name).toBe("Alan Watts");
    expect(parsed!.entities[0]!.type).toBe("person");
    expect(parsed!.concepts).toHaveLength(1);
    expect(parsed!.concepts[0]!.name).toBe("Zen");
    expect(parsed!.connections).toHaveLength(1);
  });

  it("returns default empty arrays if the model omits a field", () => {
    const parsed = parseExtraction('{"source_summary": "only a summary"}');
    expect(parsed).not.toBeNull();
    expect(parsed!.entities).toEqual([]);
    expect(parsed!.concepts).toEqual([]);
    expect(parsed!.connections).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test — confirm it fails**

```bash
npm test -- tests/extract/parser.test.ts
```
Expected: FAIL with `Cannot find module '../../src/extract/parser.js'`.

- [ ] **Step 4: Write the minimal parser**

Create `src/extract/parser.ts`:

```ts
/**
 * Robust parser for LLM extraction responses. Handles the quirks we have
 * seen in practice from small (7B) models: markdown fences, trailing
 * commas, preamble/postamble text. Ported from
 * ~/tools/llm-wiki/extract.py (parse_extraction) and
 * ~/tools/llm-wiki/parser.py.
 *
 * Returns null if the response cannot be coerced into the expected shape.
 * Never throws. The extraction pipeline treats `null` as a skipped file.
 */

export interface RawEntity {
  name?: string;
  type?: string;
  aliases?: string[];
  facts?: string[];
}

export interface RawConcept {
  name?: string;
  definition?: string;
  related?: string[];
}

export interface RawConnection {
  from?: string;
  to?: string;
  type?: string;
  description?: string;
}

export interface ParsedExtraction {
  source_summary: string;
  entities: RawEntity[];
  concepts: RawConcept[];
  connections: RawConnection[];
}

export function parseExtraction(raw: string): ParsedExtraction | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  // Strip leading ```json or ``` fences and trailing ``` fences.
  text = text.replace(/^```(?:json)?\s*\n?/i, "");
  text = text.replace(/\n?```\s*$/i, "");
  text = text.trim();

  // Find the outermost { ... } — allows models that add preamble/postamble.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  text = text.slice(start, end + 1);

  // Fix trailing commas (JSON does not allow them; 7B models produce them).
  text = text.replace(/,(\s*[}\]])/g, "$1");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;

  const d = data as Record<string, unknown>;
  const result: ParsedExtraction = {
    source_summary: typeof d.source_summary === "string" ? d.source_summary : "",
    entities: Array.isArray(d.entities) ? (d.entities as RawEntity[]) : [],
    concepts: Array.isArray(d.concepts) ? (d.concepts as RawConcept[]) : [],
    connections: Array.isArray(d.connections)
      ? (d.connections as RawConnection[])
      : [],
  };
  return result;
}
```

- [ ] **Step 5: Run the test — confirm it passes**

```bash
npm test -- tests/extract/parser.test.ts
```
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add src/extract/parser.ts tests/extract/parser.test.ts tests/fixtures/raw-llm-responses/
git commit -m "feat(extract): port robust JSON extraction parser"
```

---

## Task 9: Parser — cover all 7B quirks and failure modes

**Files:**
- Modify: `tests/extract/parser.test.ts` (append cases)

**What & why:** The fixtures created in Task 8 cover five more cases: markdown fences, trailing commas, preamble/postamble, unparseable, empty. Lock each with its own test.

- [ ] **Step 1: Append tests**

Append inside `tests/extract/parser.test.ts` after the `describe("parseExtraction — happy path", ...)` block:

```ts
describe("parseExtraction — 7B model quirks", () => {
  it("strips markdown ```json fences", () => {
    const parsed = parseExtraction(fx("markdown-fenced.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.entities[0]!.name).toBe("X");
  });

  it("forgives trailing commas inside arrays and objects", () => {
    const parsed = parseExtraction(fx("trailing-commas.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.entities).toHaveLength(1);
    expect(parsed!.entities[0]!.name).toBe("Foo");
  });

  it("extracts the outermost object from preamble/postamble noise", () => {
    const parsed = parseExtraction(fx("preamble-postamble.txt"));
    expect(parsed).not.toBeNull();
    expect(parsed!.entities[0]!.name).toBe("Bar");
  });
});

describe("parseExtraction — failure modes", () => {
  it("returns null on empty input", () => {
    expect(parseExtraction("")).toBeNull();
    expect(parseExtraction("   \n  ")).toBeNull();
  });

  it("returns null when no JSON object is present", () => {
    expect(parseExtraction(fx("no-braces.txt"))).toBeNull();
  });

  it("returns null on unparseable JSON even after cleanup", () => {
    expect(parseExtraction("{ this: is not: json }")).toBeNull();
  });

  it("returns null when the top-level value is not an object", () => {
    expect(parseExtraction("[1,2,3]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- tests/extract/parser.test.ts
```
Expected: 9 passing (2 happy + 3 quirks + 4 failures). If any fail, fix `src/extract/parser.ts` and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/extract/parser.test.ts
git commit -m "test(extract): cover 7B quirks and parser failure modes"
```

---

## Task 10: Parser — property-based invariants

**Files:**
- Create: `tests/extract/parser.property.test.ts`

**What & why:** fast-check fuzz: for any string input, `parseExtraction` must return either `null` or a fully-shaped object. It must never throw. This catches regressions where a quirk regex accidentally explodes on an edge-case input.

- [ ] **Step 1: Write the failing test**

Create `tests/extract/parser.property.test.ts`:

```ts
import { describe, it } from "vitest";
import fc from "fast-check";
import { parseExtraction } from "../../src/extract/parser.js";

describe("parseExtraction — property invariants", () => {
  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseExtraction(s);
      }),
      { numRuns: 500 },
    );
  });

  it("returns null or a fully-shaped object — never a partial", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseExtraction(s);
        if (r === null) return;
        // Every field must be present and the right type.
        if (typeof r.source_summary !== "string") throw new Error("source_summary not string");
        if (!Array.isArray(r.entities)) throw new Error("entities not array");
        if (!Array.isArray(r.concepts)) throw new Error("concepts not array");
        if (!Array.isArray(r.connections)) throw new Error("connections not array");
      }),
      { numRuns: 500 },
    );
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm test -- tests/extract/parser.property.test.ts
```
Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/extract/parser.property.test.ts
git commit -m "test(extract): add property-based invariants for parser"
```

---

## Task 11: `extractFile()` — single-file extraction

**Files:**
- Create: `src/extract/defaults.ts`
- Create: `src/extract/extractor.ts`
- Create: `tests/extract/extractor.test.ts`

**What & why:** `extractFile()` is the per-file unit of work: build prompt → call provider → parse → merge into KB → mark source. Port from `extract_file()` in `~/tools/llm-wiki/extract.py`. Takes an `LLMProvider` (so tests use `MockLLMProvider`). Truncates content at `DEFAULT_CHAR_LIMIT` (12000, from Python). Does **not** save the KB (that's the queue's job, so saves are batched).

- [ ] **Step 1: Create `src/extract/defaults.ts`**

Write:

```ts
/**
 * Hard-coded defaults for Phase 2. Phase 5 will surface these in the
 * settings UI; isolating them here now means that refactor is a pure
 * move-to-settings operation.
 */

export const DEFAULT_CHAR_LIMIT = 12_000;

/** Minimum file size (in characters) before a file is considered
 *  worth extracting. Below this, the file is skipped. */
export const DEFAULT_MIN_FILE_SIZE = 100;

export const DEFAULT_SKIP_DIRS: string[] = [
  "wiki",
  ".obsidian",
  ".trash",
  "Template",
  "Templates",
  "Assets",
];

/** Default cutoff for dailies: one year ago (ISO date). Dailies older than
 *  this are skipped from extraction. Computed lazily so tests can mock Date. */
export function defaultDailiesFromIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/extract/extractor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { extractFile } from "../../src/extract/extractor.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

const HAPPY_JSON = `{
  "source_summary": "About Alan Watts.",
  "entities": [
    {"name": "Alan Watts", "type": "person", "aliases": ["A.W."], "facts": ["wrote The Wisdom of Insecurity"]}
  ],
  "concepts": [
    {"name": "Zen", "definition": "School of Mahayana.", "related": ["Alan Watts"]}
  ],
  "connections": [
    {"from": "Alan Watts", "to": "Zen", "type": "influences", "description": "popularized zen"}
  ]
}`;

describe("extractFile", () => {
  it("calls the provider and merges the parsed result into the KB", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON]);

    const result = await extractFile({
      provider,
      kb,
      file: {
        path: "Books/watts.md",
        content: "Alan Watts wrote about Zen.",
        mtime: 1000,
        origin: "user-note",
      },
      model: "qwen2.5:7b",
    });

    expect(result).not.toBeNull();
    expect(kb.stats().entities).toBe(1);
    expect(kb.data.entities["alan-watts"]?.name).toBe("Alan Watts");
    expect(kb.data.entities["alan-watts"]?.aliases).toContain("A.W.");
    expect(kb.data.concepts["zen"]?.definition).toBe("School of Mahayana.");
    expect(kb.data.connections).toHaveLength(1);
    expect(kb.data.sources["Books/watts.md"]?.mtime).toBe(1000);
    expect(kb.data.sources["Books/watts.md"]?.origin).toBe("user-note");

    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0]!;
    expect(call.model).toBe("qwen2.5:7b");
    expect(call.prompt).toContain("DOCUMENT (Books/watts.md):");
    expect(call.prompt).toContain("Alan Watts wrote about Zen.");
  });

  it("returns null when the provider yields no JSON", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider(["I'm sorry, I can't do that."]);
    const result = await extractFile({
      provider,
      kb,
      file: {
        path: "x.md",
        content: "body",
        mtime: 1,
        origin: "user-note",
      },
      model: "qwen2.5:7b",
    });
    expect(result).toBeNull();
    expect(kb.stats().entities).toBe(0);
    expect(kb.isProcessed("x.md")).toBe(false);
  });

  it("truncates content longer than DEFAULT_CHAR_LIMIT before prompting", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON]);
    const huge = "x".repeat(20_000);
    await extractFile({
      provider,
      kb,
      file: {
        path: "big.md",
        content: huge,
        mtime: 1,
        origin: "user-note",
      },
      model: "qwen2.5:7b",
    });
    const prompt = provider.calls[0]!.prompt;
    expect(prompt).toContain("[... truncated ...]");
    // The prompt should NOT contain the full 20k x's.
    expect(prompt.length).toBeLessThan(20_000);
  });

  it("propagates AbortError from the provider", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractFile({
        provider,
        kb,
        file: { path: "y.md", content: "body", mtime: 1, origin: "user-note" },
        model: "qwen2.5:7b",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "LLMAbortError" });
  });
});
```

- [ ] **Step 3: Run the test — confirm failure**

```bash
npm test -- tests/extract/extractor.test.ts
```
Expected: FAIL with `Cannot find module '../../src/extract/extractor.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/extract/extractor.ts`:

```ts
import type { KnowledgeBase } from "../core/kb.js";
import type { SourceOrigin, EntityType, ConnectionType } from "../core/types.js";
import { exportVocabulary } from "../core/vocabulary.js";
import type { LLMProvider } from "../llm/provider.js";
import { DEFAULT_CHAR_LIMIT } from "./defaults.js";
import { buildExtractionPrompt } from "./prompts.js";
import {
  parseExtraction,
  type ParsedExtraction,
} from "./parser.js";

export interface ExtractFileInput {
  path: string;
  content: string;
  mtime: number;
  origin: SourceOrigin;
}

export interface ExtractFileArgs {
  provider: LLMProvider;
  kb: KnowledgeBase;
  file: ExtractFileInput;
  model: string;
  signal?: AbortSignal;
  charLimit?: number;
}

const ENTITY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  "person",
  "org",
  "tool",
  "project",
  "book",
  "article",
  "place",
  "event",
  "other",
]);

const CONNECTION_TYPES: ReadonlySet<ConnectionType> = new Set<ConnectionType>([
  "influences",
  "uses",
  "critiques",
  "extends",
  "part-of",
  "created-by",
  "related-to",
  "applies-to",
  "contrasts-with",
]);

/**
 * Extract structured knowledge from a single file and merge into the KB.
 * Returns the parsed extraction on success, or null if the LLM response
 * could not be parsed (in which case the KB is untouched and the source is
 * NOT marked as processed — a later retry will re-attempt the file).
 */
export async function extractFile(
  args: ExtractFileArgs,
): Promise<ParsedExtraction | null> {
  const limit = args.charLimit ?? DEFAULT_CHAR_LIMIT;
  const content =
    args.file.content.length > limit
      ? args.file.content.slice(0, limit) + "\n\n[... truncated ...]"
      : args.file.content;

  const prompt = buildExtractionPrompt({
    vocabulary: exportVocabulary(args.kb),
    sourcePath: args.file.path,
    content,
  });

  let raw = "";
  for await (const chunk of args.provider.complete({
    prompt,
    model: args.model,
    signal: args.signal,
  })) {
    raw += chunk;
  }

  const parsed = parseExtraction(raw);
  if (!parsed) return null;

  for (const ent of parsed.entities) {
    const name = (ent.name ?? "").trim();
    if (!name) continue;
    const type: EntityType = ENTITY_TYPES.has(ent.type as EntityType)
      ? (ent.type as EntityType)
      : "other";
    args.kb.addEntity({
      name,
      type,
      aliases: ent.aliases ?? [],
      facts: ent.facts ?? [],
      source: args.file.path,
    });
  }

  for (const con of parsed.concepts) {
    const name = (con.name ?? "").trim();
    if (!name) continue;
    args.kb.addConcept({
      name,
      definition: con.definition ?? "",
      related: con.related ?? [],
      source: args.file.path,
    });
  }

  for (const conn of parsed.connections) {
    const from = (conn.from ?? "").trim();
    const to = (conn.to ?? "").trim();
    if (!from || !to) continue;
    const type: ConnectionType = CONNECTION_TYPES.has(
      conn.type as ConnectionType,
    )
      ? (conn.type as ConnectionType)
      : "related-to";
    args.kb.addConnection({
      from,
      to,
      type,
      description: conn.description ?? "",
      source: args.file.path,
    });
  }

  args.kb.markSource({
    path: args.file.path,
    summary: parsed.source_summary,
    mtime: args.file.mtime,
    origin: args.file.origin,
  });

  return parsed;
}
```

- [ ] **Step 5: Run the tests — confirm all pass**

```bash
npm test -- tests/extract/extractor.test.ts
```
Expected: 4 passing.

- [ ] **Step 6: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/extract/defaults.ts src/extract/extractor.ts tests/extract/extractor.test.ts
git commit -m "feat(extract): add extractFile single-file pipeline"
```

---

## Task 12: `ProgressEmitter` — typed events for extraction progress

**Files:**
- Create: `src/runtime/progress.ts`
- Create: `tests/runtime/progress.test.ts`

**What & why:** The queue (Task 13) needs to publish progress events, and the status bar (Task 17) needs to subscribe. A typed `EventTarget` wrapper is ~40 lines and keeps the queue → UI decoupled. Events: `batch-started`, `file-started`, `file-completed`, `file-failed`, `checkpoint`, `batch-completed`, `batch-cancelled`, `batch-errored`.

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/progress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ProgressEmitter } from "../../src/runtime/progress.js";

describe("ProgressEmitter", () => {
  it("delivers batch-started and file-completed events in order", () => {
    const e = new ProgressEmitter();
    const events: string[] = [];
    e.on("batch-started", (d) => events.push(`start:${d.total}`));
    e.on("file-completed", (d) => events.push(`done:${d.path}`));

    e.emit("batch-started", { total: 2 });
    e.emit("file-completed", { path: "a.md", index: 1, total: 2, entitiesAdded: 1, conceptsAdded: 0 });
    e.emit("file-completed", { path: "b.md", index: 2, total: 2, entitiesAdded: 0, conceptsAdded: 1 });

    expect(events).toEqual(["start:2", "done:a.md", "done:b.md"]);
  });

  it("off() removes a specific handler", () => {
    const e = new ProgressEmitter();
    const log: number[] = [];
    const handler = (): void => {
      log.push(1);
    };
    e.on("batch-started", handler);
    e.emit("batch-started", { total: 0 });
    e.off("batch-started", handler);
    e.emit("batch-started", { total: 0 });
    expect(log).toEqual([1]);
  });

  it("emits batch-errored with a message", () => {
    const e = new ProgressEmitter();
    let captured = "";
    e.on("batch-errored", (d) => {
      captured = d.message;
    });
    e.emit("batch-errored", { message: "KB stale" });
    expect(captured).toBe("KB stale");
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

```bash
npm test -- tests/runtime/progress.test.ts
```
Expected: FAIL with `Cannot find module '../../src/runtime/progress.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/runtime/progress.ts`:

```ts
/**
 * Typed event emitter for extraction progress. The queue publishes
 * events; the status-bar UI and the settings panel subscribe. Lives
 * here (runtime/) rather than in ui/ or extract/ because it is the
 * handoff point between them.
 */

export interface ProgressEventMap {
  "batch-started": { total: number };
  "file-started": { path: string; index: number; total: number };
  "file-completed": {
    path: string;
    index: number;
    total: number;
    entitiesAdded: number;
    conceptsAdded: number;
  };
  "file-failed": {
    path: string;
    index: number;
    total: number;
    reason: string;
  };
  "file-skipped": { path: string; index: number; total: number };
  "checkpoint": { processed: number; total: number };
  "batch-completed": {
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    total: number;
    elapsedMs: number;
  };
  "batch-cancelled": { processed: number; total: number };
  "batch-errored": { message: string };
}

export type ProgressEventName = keyof ProgressEventMap;
export type ProgressEventHandler<K extends ProgressEventName> = (
  data: ProgressEventMap[K],
) => void;

export class ProgressEmitter {
  private readonly target = new EventTarget();
  /** Wrapped handler cache so off() can remove listeners by original ref. */
  private readonly wrapped = new WeakMap<
    ProgressEventHandler<ProgressEventName>,
    EventListener
  >();

  on<K extends ProgressEventName>(
    event: K,
    handler: ProgressEventHandler<K>,
  ): void {
    const wrapped = (ev: Event): void => {
      const detail = (ev as CustomEvent<ProgressEventMap[K]>).detail;
      handler(detail);
    };
    this.wrapped.set(
      handler as ProgressEventHandler<ProgressEventName>,
      wrapped,
    );
    this.target.addEventListener(event, wrapped);
  }

  off<K extends ProgressEventName>(
    event: K,
    handler: ProgressEventHandler<K>,
  ): void {
    const wrapped = this.wrapped.get(
      handler as ProgressEventHandler<ProgressEventName>,
    );
    if (wrapped) this.target.removeEventListener(event, wrapped);
  }

  emit<K extends ProgressEventName>(
    event: K,
    data: ProgressEventMap[K],
  ): void {
    this.target.dispatchEvent(new CustomEvent(event, { detail: data }));
  }
}
```

- [ ] **Step 4: Run the test — confirm all pass**

```bash
npm test -- tests/runtime/progress.test.ts
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/progress.ts tests/runtime/progress.test.ts
git commit -m "feat(runtime): add typed ProgressEmitter for extraction events"
```

---

## Task 13: `ExtractionQueue` — serial processing, checkpointing, cancellation

**Files:**
- Create: `src/extract/queue.ts`
- Create: `tests/extract/queue.test.ts`

**What & why:** The batch runner. Ports `extract_batch()` from `~/tools/llm-wiki/extract.py` with the additions Phase 2 needs: `ProgressEmitter` publication, `AbortSignal` cancellation, and `KBStaleError` handling on checkpoint. Strictly serial (one file at a time). Saves the KB every 5 files and once at end. Idempotent: files whose mtime is unchanged since the last extraction are skipped without a provider call.

This task has the most tests of Phase 2. Do them in one TDD cycle — write all tests, run, make them pass together — because the implementation is a single function and splitting it into micro-tasks would force you to re-visit the same file repeatedly.

- [ ] **Step 1: Write the failing test file**

Create `tests/extract/queue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { runExtraction } from "../../src/extract/queue.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";
import { ProgressEmitter } from "../../src/runtime/progress.js";
import { KBStaleError } from "../../src/vault/kb-store.js";

const EMPTY_JSON =
  '{"source_summary":"","entities":[],"concepts":[],"connections":[]}';

function fakeFile(i: number, mtime = 1): {
  path: string;
  content: string;
  mtime: number;
  origin: "user-note";
} {
  return {
    path: `notes/${i}.md`,
    content: `file ${i} body`,
    mtime,
    origin: "user-note",
  };
}

function makeCannedProvider(n: number): MockLLMProvider {
  return new MockLLMProvider(new Array(n).fill(EMPTY_JSON));
}

describe("runExtraction", () => {
  it("processes all files serially and saves the KB at the end", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(3);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {
      /* noop */
    });
    const files = [fakeFile(1), fakeFile(2), fakeFile(3)];
    const events: string[] = [];
    emitter.on("batch-started", (d) => events.push(`start:${d.total}`));
    emitter.on("file-completed", (d) => events.push(`done:${d.index}`));
    emitter.on("batch-completed", (d) => events.push(`end:${d.succeeded}`));

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.succeeded).toBe(3);
    expect(stats.failed).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(stats.total).toBe(3);
    expect(provider.calls).toHaveLength(3);
    expect(saveKB).toHaveBeenCalledTimes(1); // end-of-batch only
    expect(events).toEqual(["start:3", "done:1", "done:2", "done:3", "end:3"]);
  });

  it("checkpoints the KB every N files during a long run", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(11);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {
      /* noop */
    });
    const files = Array.from({ length: 11 }, (_, i) => fakeFile(i + 1));

    await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    // Saves at files 5, 10, and final end-of-batch save => 3 saves total.
    expect(saveKB).toHaveBeenCalledTimes(3);
  });

  it("skips files already processed at the same mtime (idempotent replay)", async () => {
    const kb = new KnowledgeBase();
    // Pre-mark notes/1.md and notes/2.md at mtime 1 — simulating prior run.
    kb.markSource({
      path: "notes/1.md",
      mtime: 1,
      origin: "user-note",
    });
    kb.markSource({
      path: "notes/2.md",
      mtime: 1,
      origin: "user-note",
    });
    const provider = makeCannedProvider(3); // 3 in queue, but only 3 files total
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {});
    const files = [fakeFile(1), fakeFile(2), fakeFile(3), fakeFile(4), fakeFile(5)];
    const skips: string[] = [];
    emitter.on("file-skipped", (d) => skips.push(d.path));

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.skipped).toBe(2);
    expect(stats.succeeded).toBe(3);
    expect(provider.calls).toHaveLength(3);
    expect(skips).toEqual(["notes/1.md", "notes/2.md"]);
  });

  it("stops cleanly at a file boundary when signal is aborted", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(5);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {});
    const files = Array.from({ length: 5 }, (_, i) => fakeFile(i + 1));
    const controller = new AbortController();

    // Abort after the 2nd file completes, before the 3rd begins.
    emitter.on("file-completed", (d) => {
      if (d.index === 2) controller.abort();
    });
    const cancelled = vi.fn();
    emitter.on("batch-cancelled", cancelled);

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
      signal: controller.signal,
    });

    expect(stats.succeeded).toBe(2);
    expect(provider.calls.length).toBe(2);
    expect(saveKB).toHaveBeenCalled(); // final save on cancel
    expect(cancelled).toHaveBeenCalled();
  });

  it("surfaces KBStaleError via batch-errored and stops processing", async () => {
    const kb = new KnowledgeBase();
    const provider = makeCannedProvider(5);
    const emitter = new ProgressEmitter();
    let call = 0;
    const saveKB = vi.fn(async () => {
      call++;
      if (call === 1) throw new KBStaleError(1, 2);
    });
    const files = Array.from({ length: 6 }, (_, i) => fakeFile(i + 1));
    const errored = vi.fn();
    emitter.on("batch-errored", errored);

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    // saveKB fired at file 5 (checkpoint) and threw — queue must stop there.
    expect(errored).toHaveBeenCalledTimes(1);
    expect(errored.mock.calls[0][0].message).toMatch(/KB .* changed/);
    // Processed 5 files before the failing checkpoint.
    expect(stats.succeeded).toBe(5);
    // 6th file must not have been processed.
    expect(provider.calls.length).toBe(5);
  });

  it("counts file-level failures without aborting the batch", async () => {
    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([
      EMPTY_JSON,
      "I can't do that.", // un-parseable => file-failed
      EMPTY_JSON,
    ]);
    const emitter = new ProgressEmitter();
    const saveKB = vi.fn(async () => {});
    const files = [fakeFile(1), fakeFile(2), fakeFile(3)];
    const failed = vi.fn();
    emitter.on("file-failed", failed);

    const stats = await runExtraction({
      provider,
      kb,
      files,
      model: "qwen2.5:7b",
      saveKB,
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.succeeded).toBe(2);
    expect(stats.failed).toBe(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests — confirm failure**

```bash
npm test -- tests/extract/queue.test.ts
```
Expected: FAIL with `Cannot find module '../../src/extract/queue.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/extract/queue.ts`:

```ts
import type { KnowledgeBase } from "../core/kb.js";
import type { SourceOrigin } from "../core/types.js";
import type { LLMProvider } from "../llm/provider.js";
import { LLMAbortError } from "../llm/provider.js";
import type { ProgressEmitter } from "../runtime/progress.js";
import { KBStaleError } from "../vault/kb-store.js";
import { extractFile, type ExtractFileInput } from "./extractor.js";

export interface QueueFile extends ExtractFileInput {}

export interface RunExtractionArgs {
  provider: LLMProvider;
  kb: KnowledgeBase;
  files: QueueFile[];
  model: string;
  /** Persists the KB to disk. Implementation supplies this — typically a
   *  closure around `saveKB(app, kb, mtime)` that updates its captured
   *  mtime on success. Returning the new mtime is optional. */
  saveKB: () => Promise<void>;
  emitter: ProgressEmitter;
  /** Checkpoint every N successful files. Defaults to 5. */
  checkpointEvery?: number;
  /** Truncate file content at this many characters before prompting. */
  charLimit?: number;
  /** Cancellation signal. If it fires, the queue exits cleanly at the next
   *  file boundary. */
  signal?: AbortSignal;
}

export interface RunExtractionStats {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  elapsedMs: number;
}

/** Compile-time friendly reminder that QueueFile.origin is SourceOrigin. */
type _Assert = QueueFile["origin"] extends SourceOrigin ? true : never;
const _assertOrigin: _Assert = true as const;
void _assertOrigin;

export async function runExtraction(
  args: RunExtractionArgs,
): Promise<RunExtractionStats> {
  const {
    provider,
    kb,
    files,
    model,
    saveKB,
    emitter,
    charLimit,
  } = args;
  const checkpointEvery = args.checkpointEvery ?? 5;
  const total = files.length;
  const t0 = Date.now();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let processedSinceCheckpoint = 0;

  emitter.emit("batch-started", { total });

  const isAborted = (): boolean => args.signal?.aborted === true;

  outer: for (let i = 0; i < total; i++) {
    if (isAborted()) break;

    const file = files[i]!;
    const index = i + 1;

    if (!kb.needsExtraction(file.path, file.mtime)) {
      skipped++;
      emitter.emit("file-skipped", { path: file.path, index, total });
      continue;
    }

    emitter.emit("file-started", { path: file.path, index, total });

    let preEntities = kb.stats().entities;
    let preConcepts = kb.stats().concepts;

    try {
      const result = await extractFile({
        provider,
        kb,
        file,
        model,
        signal: args.signal,
        charLimit,
      });
      if (result) {
        const stats = kb.stats();
        succeeded++;
        processedSinceCheckpoint++;
        emitter.emit("file-completed", {
          path: file.path,
          index,
          total,
          entitiesAdded: stats.entities - preEntities,
          conceptsAdded: stats.concepts - preConcepts,
        });
      } else {
        failed++;
        emitter.emit("file-failed", {
          path: file.path,
          index,
          total,
          reason: "LLM response could not be parsed",
        });
      }
    } catch (e) {
      if (e instanceof LLMAbortError || isAborted()) {
        // Treat as cooperative cancellation.
        break outer;
      }
      failed++;
      const reason = (e as Error).message ?? "Unknown error";
      emitter.emit("file-failed", { path: file.path, index, total, reason });
    }

    // Periodic checkpoint save — every N successful files.
    if (processedSinceCheckpoint >= checkpointEvery) {
      try {
        await saveKB();
        emitter.emit("checkpoint", { processed: index, total });
        processedSinceCheckpoint = 0;
      } catch (e) {
        const message =
          e instanceof KBStaleError
            ? `KB changed externally during extraction (expected mtime ${e.expectedMtime}, actual ${e.actualMtime}). Re-run the command to continue.`
            : (e as Error).message;
        emitter.emit("batch-errored", { message });
        // Do NOT run final save — the on-disk KB is ahead of us.
        return {
          total,
          succeeded,
          failed,
          skipped,
          elapsedMs: Date.now() - t0,
        };
      }
    }
  }

  // Final save (end of batch OR cancellation).
  try {
    await saveKB();
  } catch (e) {
    const message =
      e instanceof KBStaleError
        ? `KB changed externally during extraction (expected mtime ${e.expectedMtime}, actual ${e.actualMtime}). Re-run the command to continue.`
        : (e as Error).message;
    emitter.emit("batch-errored", { message });
    return {
      total,
      succeeded,
      failed,
      skipped,
      elapsedMs: Date.now() - t0,
    };
  }

  const elapsedMs = Date.now() - t0;

  if (isAborted()) {
    emitter.emit("batch-cancelled", { processed: succeeded + failed, total });
  } else {
    emitter.emit("batch-completed", {
      processed: succeeded + failed + skipped,
      succeeded,
      failed,
      skipped,
      total,
      elapsedMs,
    });
  }

  return { total, succeeded, failed, skipped, elapsedMs };
}
```

Note: the `_Assert` dance is just a type-level guard to catch drift if `ExtractFileInput.origin` ever diverges from `SourceOrigin`. It has no runtime effect.

- [ ] **Step 4: Run the tests**

```bash
npm test -- tests/extract/queue.test.ts
```
Expected: 6 passing. If any fail, re-read the failing test and correct the implementation.

- [ ] **Step 5: Run all Phase 2 tests so far**

```bash
npm test -- tests/llm tests/extract tests/runtime
```
Expected: all green. Roughly 20+ tests.

- [ ] **Step 6: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/extract/queue.ts tests/extract/queue.test.ts
git commit -m "feat(extract): add runExtraction serial batch runner with checkpoints"
```

---

## Task 14: Status bar — ETA formatter (pure function, unit-tested)

**Files:**
- Create: `src/ui/status-bar-format.ts`
- Create: `tests/ui/status-bar-format.test.ts`

**What & why:** Before the DOM-bound widget in Task 15, isolate the ETA math into a pure function. This is the only Phase 2 status-bar logic that has to be unit-tested exhaustively. `formatEta(elapsedMs, completed, total, now?)` returns `"estimating…"` until ≥3 files are done; then returns `"~Xh Ym"` / `"~Ym"` / `"~Ys"`.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/status-bar-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatEta, formatIndexingLabel } from "../../src/ui/status-bar-format.js";

describe("formatEta", () => {
  it("returns 'estimating…' until 3 files have completed", () => {
    expect(formatEta(1_000, 0, 10)).toBe("estimating…");
    expect(formatEta(1_000, 1, 10)).toBe("estimating…");
    expect(formatEta(1_000, 2, 10)).toBe("estimating…");
  });

  it("returns a seconds estimate when the total remaining is under a minute", () => {
    // 3 files in 3s = 1s each; 7 left => ~7s.
    expect(formatEta(3_000, 3, 10)).toBe("~7s");
  });

  it("returns a minutes estimate when remaining is under an hour", () => {
    // 3 files in 180_000 ms (1 minute each); 10 left => 10 minutes.
    expect(formatEta(180_000, 3, 13)).toBe("~10m");
  });

  it("returns an h+m estimate for longer runs", () => {
    // 3 files in 360_000ms (2 min each); 100 left => 200 minutes = 3h 20m.
    expect(formatEta(360_000, 3, 103)).toBe("~3h 20m");
  });

  it("returns 'done' when nothing remains", () => {
    expect(formatEta(10_000, 10, 10)).toBe("done");
  });
});

describe("formatIndexingLabel", () => {
  it("composes the idle-state label", () => {
    expect(formatIndexingLabel({ state: "idle" })).toBe("🧠 LLM Wiki");
  });

  it("composes the indexing-state label with ETA", () => {
    expect(
      formatIndexingLabel({
        state: "indexing",
        processed: 3,
        total: 10,
        elapsedMs: 3_000,
      }),
    ).toBe("🧠 Indexing 3/10 · ~7s");
  });

  it("composes the indexing-state label while estimating", () => {
    expect(
      formatIndexingLabel({
        state: "indexing",
        processed: 1,
        total: 10,
        elapsedMs: 1_000,
      }),
    ).toBe("🧠 Indexing 1/10 · estimating…");
  });

  it("composes the error-state label", () => {
    expect(
      formatIndexingLabel({ state: "error", message: "Ollama unreachable" }),
    ).toBe("🧠 ⚠ Ollama unreachable");
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

```bash
npm test -- tests/ui/status-bar-format.test.ts
```
Expected: FAIL with `Cannot find module '../../src/ui/status-bar-format.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/status-bar-format.ts`:

```ts
/**
 * Pure formatting helpers for the status bar. No DOM, no Obsidian API.
 * Separated from the widget itself so the ETA math is unit-tested in
 * isolation.
 */

export function formatEta(
  elapsedMs: number,
  completed: number,
  total: number,
): string {
  if (completed >= total) return "done";
  if (completed < 3) return "estimating…";
  const remaining = total - completed;
  const avgMs = elapsedMs / completed;
  const etaSec = Math.round((remaining * avgMs) / 1000);
  if (etaSec < 60) return `~${etaSec}s`;
  const etaMin = Math.round(etaSec / 60);
  if (etaMin < 60) return `~${etaMin}m`;
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return `~${h}h ${m}m`;
}

export type StatusBarState =
  | { state: "idle" }
  | {
      state: "indexing";
      processed: number;
      total: number;
      elapsedMs: number;
    }
  | { state: "error"; message: string };

export function formatIndexingLabel(state: StatusBarState): string {
  switch (state.state) {
    case "idle":
      return "🧠 LLM Wiki";
    case "indexing": {
      const eta = formatEta(state.elapsedMs, state.processed, state.total);
      return `🧠 Indexing ${state.processed}/${state.total} · ${eta}`;
    }
    case "error":
      return `🧠 ⚠ ${state.message}`;
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- tests/ui/status-bar-format.test.ts
```
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/status-bar-format.ts tests/ui/status-bar-format.test.ts
git commit -m "feat(ui): add pure status-bar label formatter with ETA"
```

---

## Task 15: `StatusBarWidget` — wires `ProgressEmitter` events to formatter + DOM

**Files:**
- Create: `src/ui/status-bar.ts`
- Create: `tests/ui/status-bar.test.ts`

**What & why:** The thin wrapper that turns a stream of `ProgressEmitter` events into `setText()` calls on an Obsidian status-bar `HTMLElement`. Tested with a fake element that records every `setText` call.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/status-bar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { StatusBarWidget } from "../../src/ui/status-bar.js";
import { ProgressEmitter } from "../../src/runtime/progress.js";

function fakeEl(): { setText: (t: string) => void; texts: string[] } {
  const texts: string[] = [];
  return {
    setText: (t: string) => texts.push(t),
    texts,
  };
}

describe("StatusBarWidget", () => {
  it("starts in the idle state", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el as unknown as HTMLElement, emitter);
    expect(el.texts.at(-1)).toBe("🧠 LLM Wiki");
  });

  it("updates to indexing label on batch-started + file-completed events", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el as unknown as HTMLElement, emitter);
    emitter.emit("batch-started", { total: 10 });
    expect(el.texts.at(-1)).toMatch(/Indexing 0\/10/);
    emitter.emit("file-completed", {
      path: "a.md",
      index: 1,
      total: 10,
      entitiesAdded: 0,
      conceptsAdded: 0,
    });
    expect(el.texts.at(-1)).toMatch(/Indexing 1\/10/);
  });

  it("returns to idle after batch-completed", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el as unknown as HTMLElement, emitter);
    emitter.emit("batch-started", { total: 1 });
    emitter.emit("file-completed", {
      path: "a.md",
      index: 1,
      total: 1,
      entitiesAdded: 0,
      conceptsAdded: 0,
    });
    emitter.emit("batch-completed", {
      processed: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      total: 1,
      elapsedMs: 100,
    });
    expect(el.texts.at(-1)).toBe("🧠 LLM Wiki");
  });

  it("shows the error state on batch-errored and does not revert", () => {
    const el = fakeEl();
    const emitter = new ProgressEmitter();
    new StatusBarWidget(el as unknown as HTMLElement, emitter);
    emitter.emit("batch-errored", { message: "KB changed externally" });
    expect(el.texts.at(-1)).toBe("🧠 ⚠ KB changed externally");
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

```bash
npm test -- tests/ui/status-bar.test.ts
```
Expected: FAIL with `Cannot find module '../../src/ui/status-bar.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/status-bar.ts`:

```ts
import type { ProgressEmitter } from "../runtime/progress.js";
import {
  formatIndexingLabel,
  type StatusBarState,
} from "./status-bar-format.js";

/**
 * Subscribes to a ProgressEmitter and updates a single HTMLElement
 * (Obsidian's status-bar item) with the formatted label.
 */
export class StatusBarWidget {
  private batchStart = 0;
  private processed = 0;
  private total = 0;

  constructor(
    private readonly el: Pick<HTMLElement, "setText"> & HTMLElement,
    emitter: ProgressEmitter,
  ) {
    this.render({ state: "idle" });

    emitter.on("batch-started", (d) => {
      this.batchStart = Date.now();
      this.processed = 0;
      this.total = d.total;
      this.render({
        state: "indexing",
        processed: 0,
        total: this.total,
        elapsedMs: 0,
      });
    });

    emitter.on("file-completed", (d) => {
      this.processed = d.index;
      this.render({
        state: "indexing",
        processed: this.processed,
        total: this.total,
        elapsedMs: Date.now() - this.batchStart,
      });
    });

    emitter.on("file-failed", (d) => {
      this.processed = d.index;
      this.render({
        state: "indexing",
        processed: this.processed,
        total: this.total,
        elapsedMs: Date.now() - this.batchStart,
      });
    });

    emitter.on("file-skipped", (d) => {
      this.processed = d.index;
      this.render({
        state: "indexing",
        processed: this.processed,
        total: this.total,
        elapsedMs: Date.now() - this.batchStart,
      });
    });

    emitter.on("batch-completed", () => {
      this.render({ state: "idle" });
    });

    emitter.on("batch-cancelled", () => {
      this.render({ state: "idle" });
    });

    emitter.on("batch-errored", (d) => {
      this.render({ state: "error", message: d.message });
    });
  }

  private render(state: StatusBarState): void {
    this.el.setText(formatIndexingLabel(state));
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- tests/ui/status-bar.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/status-bar.ts tests/ui/status-bar.test.ts
git commit -m "feat(ui): add status-bar widget wired to ProgressEmitter"
```

---

## Task 16: Extend plugin settings schema

**Files:**
- Modify: `src/plugin.ts` — extend `LlmWikiSettings` + `DEFAULT_SETTINGS`

**What & why:** Phase 2 adds four settings: `ollamaUrl`, `ollamaModel`, `extractionCharLimit`, `lastExtractionRunIso`. Keep the shape open to additions in Phases 3-6. Migration is a no-op — `loadSettings()` already merges with `DEFAULT_SETTINGS`, so older `data.json` files pick up the new fields automatically.

- [ ] **Step 1: Edit `src/plugin.ts`**

Replace the existing `interface LlmWikiSettings` and `DEFAULT_SETTINGS` with:

```ts
interface LlmWikiSettings {
  version: number;
  ollamaUrl: string;
  ollamaModel: string;
  extractionCharLimit: number;
  lastExtractionRunIso: string | null;
}

const DEFAULT_SETTINGS: LlmWikiSettings = {
  version: 1,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  extractionCharLimit: 12_000,
  lastExtractionRunIso: null,
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors. (No tests yet — the settings are inert until Task 18 uses them.)

- [ ] **Step 3: Commit**

```bash
git add src/plugin.ts
git commit -m "feat(plugin): extend settings schema for Phase 2 extraction"
```

---

## Task 17: Indexing settings section

**Files:**
- Create: `src/ui/settings/indexing-section.ts`
- Create: `src/ui/settings/settings-tab.ts`

**What & why:** A minimal Obsidian `PluginSettingTab` that renders the Indexing section: Ollama URL, Ollama model, "Index now" button, "Cancel running extraction" button, "Last run" timestamp. Phases 3-6 will add Query, Filters, Advanced sections alongside this one.

Obsidian's `Setting` fluent API is DOM-heavy and not worth mocking in a unit test. We verify correctness at the integration layer (Task 22) and via manual smoke (Task 25). This task ships without a unit test.

- [ ] **Step 1: Create `src/ui/settings/indexing-section.ts`**

Write:

```ts
import { Setting } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";

export interface IndexingSectionHandlers {
  onIndexAll: () => void;
  onIndexCancel: () => void;
  isRunning: () => boolean;
}

export function renderIndexingSection(
  containerEl: HTMLElement,
  plugin: LlmWikiPlugin,
  handlers: IndexingSectionHandlers,
): void {
  containerEl.createEl("h2", { text: "Indexing" });

  new Setting(containerEl)
    .setName("Ollama URL")
    .setDesc("Base URL of your local Ollama server.")
    .addText((text) =>
      text
        .setPlaceholder("http://localhost:11434")
        .setValue(plugin.settings.ollamaUrl)
        .onChange(async (value) => {
          plugin.settings.ollamaUrl = value.trim() || "http://localhost:11434";
          await plugin.saveSettings();
          plugin.rebuildProvider();
        }),
    );

  new Setting(containerEl)
    .setName("Ollama model")
    .setDesc(
      "Tag of the Ollama model to use for extraction (e.g. qwen2.5:7b). Phase 5 adds a curated picker.",
    )
    .addText((text) =>
      text
        .setPlaceholder("qwen2.5:7b")
        .setValue(plugin.settings.ollamaModel)
        .onChange(async (value) => {
          plugin.settings.ollamaModel = value.trim() || "qwen2.5:7b";
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Last run")
    .setDesc(
      plugin.settings.lastExtractionRunIso
        ? new Date(plugin.settings.lastExtractionRunIso).toLocaleString()
        : "never",
    );

  new Setting(containerEl)
    .setName("Index now")
    .setDesc("Walks the vault and extracts new or modified files.")
    .addButton((btn) =>
      btn
        .setButtonText("Run extraction")
        .setCta()
        .setDisabled(handlers.isRunning())
        .onClick(() => {
          handlers.onIndexAll();
        }),
    );

  new Setting(containerEl)
    .setName("Cancel running extraction")
    .setDesc("Stops the extraction at the next file boundary.")
    .addButton((btn) =>
      btn
        .setButtonText("Cancel")
        .setWarning()
        .setDisabled(!handlers.isRunning())
        .onClick(() => {
          handlers.onIndexCancel();
        }),
    );
}
```

- [ ] **Step 2: Create `src/ui/settings/settings-tab.ts`**

Write:

```ts
import { App, PluginSettingTab } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";
import { renderIndexingSection } from "./indexing-section.js";

export class LlmWikiSettingsTab extends PluginSettingTab {
  private readonly plugin: LlmWikiPlugin;

  constructor(app: App, plugin: LlmWikiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h1", { text: "LLM Wiki" });
    containerEl.createEl("p", {
      text: "Phase 2 — Extraction. Query, filters, and cloud providers arrive in later phases.",
    });

    renderIndexingSection(containerEl, this.plugin, {
      onIndexAll: () => this.plugin.runExtractAll(),
      onIndexCancel: () => this.plugin.cancelExtraction(),
      isRunning: () => this.plugin.isExtractionRunning(),
    });
  }
}
```

- [ ] **Step 3: Typecheck** (will fail because `plugin.runExtractAll`, etc. don't exist yet — fix in Task 18)

```bash
npm run typecheck
```
Expected: FAIL — `Property 'runExtractAll' does not exist on type 'LlmWikiPlugin'`. **This is intentional.** Task 18 adds those methods.

- [ ] **Step 4: Commit** (do not lint/typecheck-gate this commit — the next task closes the loop)

```bash
git add src/ui/settings/indexing-section.ts src/ui/settings/settings-tab.ts
git commit -m "feat(ui): add Indexing settings section and settings tab shell"
```

---

## Task 18: Plugin wiring — provider, emitter, status bar, settings tab, commands

**Files:**
- Modify: `src/plugin.ts`

**What & why:** The final wiring step. Adds the provider, progress emitter, status bar, settings tab, and three commands (`extract-all`, `extract-current`, `extract-cancel`). Also adds three public methods (`runExtractAll`, `cancelExtraction`, `isExtractionRunning`) that the settings section calls. Turns the Task 17 TS error green.

- [ ] **Step 1: Rewrite `src/plugin.ts`**

Replace the file with this exact content:

```ts
import { Notice, Plugin, TFile } from "obsidian";
import { KnowledgeBase } from "./core/kb.js";
import { loadKB, saveKB } from "./vault/kb-store.js";
import { walkVaultFiles, type WalkOptions } from "./vault/walker.js";
import { openVocabularyModal } from "./ui/modal/vocabulary-modal.js";
import { OllamaProvider } from "./llm/ollama.js";
import type { LLMProvider } from "./llm/provider.js";
import { runExtraction, type QueueFile } from "./extract/queue.js";
import { extractFile } from "./extract/extractor.js";
import {
  DEFAULT_MIN_FILE_SIZE,
  DEFAULT_SKIP_DIRS,
  defaultDailiesFromIso,
} from "./extract/defaults.js";
import { ProgressEmitter } from "./runtime/progress.js";
import { StatusBarWidget } from "./ui/status-bar.js";
import { LlmWikiSettingsTab } from "./ui/settings/settings-tab.js";
import type { SourceOrigin } from "./core/types.js";

interface LlmWikiSettings {
  version: number;
  ollamaUrl: string;
  ollamaModel: string;
  extractionCharLimit: number;
  lastExtractionRunIso: string | null;
}

const DEFAULT_SETTINGS: LlmWikiSettings = {
  version: 1,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  extractionCharLimit: 12_000,
  lastExtractionRunIso: null,
};

export default class LlmWikiPlugin extends Plugin {
  settings: LlmWikiSettings = DEFAULT_SETTINGS;
  kb: KnowledgeBase = new KnowledgeBase();
  kbMtime = 0;

  progress = new ProgressEmitter();
  private provider: LLMProvider = new OllamaProvider({ url: this.settings.ollamaUrl });
  private abortController: AbortController | null = null;
  private running = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.rebuildProvider();
    await this.reloadKB();

    // Status bar
    const statusEl = this.addStatusBarItem();
    new StatusBarWidget(statusEl, this.progress);

    // Settings tab
    this.addSettingTab(new LlmWikiSettingsTab(this.app, this));

    // Commands
    this.addCommand({
      id: "show-vocabulary",
      name: "LLM Wiki: Show vocabulary",
      callback: () => openVocabularyModal(this.app, this.kb),
    });

    this.addCommand({
      id: "reload-kb",
      name: "LLM Wiki: Reload knowledge base from disk",
      callback: () => {
        void this.reloadKB();
      },
    });

    this.addCommand({
      id: "extract-all",
      name: "LLM Wiki: Run extraction now",
      callback: () => {
        void this.runExtractAll();
      },
    });

    this.addCommand({
      id: "extract-current",
      name: "LLM Wiki: Extract current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (checking) return true;
        void this.runExtractCurrent(file);
        return true;
      },
    });

    this.addCommand({
      id: "extract-cancel",
      name: "LLM Wiki: Cancel running extraction",
      checkCallback: (checking) => {
        if (checking) return this.running;
        this.cancelExtraction();
        return true;
      },
    });
  }

  onunload(): void {
    this.cancelExtraction();
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<LlmWikiSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async reloadKB(): Promise<void> {
    const { kb, mtime } = await loadKB(this.app as never);
    this.kb = kb;
    this.kbMtime = mtime;
  }

  /** Called by the settings UI when the Ollama URL changes. */
  rebuildProvider(): void {
    this.provider = new OllamaProvider({ url: this.settings.ollamaUrl });
  }

  isExtractionRunning(): boolean {
    return this.running;
  }

  cancelExtraction(): void {
    if (this.abortController) this.abortController.abort();
  }

  async runExtractAll(): Promise<void> {
    if (this.running) {
      new Notice("LLM Wiki: extraction already running.");
      return;
    }
    this.running = true;
    this.abortController = new AbortController();

    try {
      await this.reloadKB();
      const walkOpts: WalkOptions = {
        skipDirs: DEFAULT_SKIP_DIRS,
        minFileSize: DEFAULT_MIN_FILE_SIZE,
        dailiesFromIso: defaultDailiesFromIso(),
      };
      const walked = await walkVaultFiles(this.app as never, walkOpts);
      const files: QueueFile[] = [];
      for (const w of walked) {
        const tfile = this.app.vault.getAbstractFileByPath(w.path);
        if (!(tfile instanceof TFile)) continue;
        const content = await this.app.vault.cachedRead(tfile);
        files.push({
          path: w.path,
          content,
          mtime: w.mtime,
          origin: w.origin as SourceOrigin,
        });
      }

      const saveCallback = async (): Promise<void> => {
        await saveKB(this.app as never, this.kb, this.kbMtime);
        // Re-stat: after a successful save, the on-disk mtime has advanced.
        const reloaded = await loadKB(this.app as never);
        this.kbMtime = reloaded.mtime;
      };

      const stats = await runExtraction({
        provider: this.provider,
        kb: this.kb,
        files,
        model: this.settings.ollamaModel,
        saveKB: saveCallback,
        emitter: this.progress,
        checkpointEvery: 5,
        charLimit: this.settings.extractionCharLimit,
        signal: this.abortController.signal,
      });

      this.settings.lastExtractionRunIso = new Date().toISOString();
      await this.saveSettings();
      new Notice(
        `LLM Wiki: ${stats.succeeded} extracted, ${stats.failed} failed, ${stats.skipped} skipped (${Math.round(stats.elapsedMs / 1000)}s).`,
      );
    } catch (e) {
      this.progress.emit("batch-errored", {
        message: (e as Error).message ?? "Unknown error",
      });
      new Notice(`LLM Wiki: extraction failed — ${(e as Error).message}`);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  async runExtractCurrent(file: TFile): Promise<void> {
    if (this.running) {
      new Notice("LLM Wiki: wait for the current extraction to finish.");
      return;
    }
    this.running = true;
    this.abortController = new AbortController();
    try {
      await this.reloadKB();
      const content = await this.app.vault.cachedRead(file);
      await extractFile({
        provider: this.provider,
        kb: this.kb,
        file: {
          path: file.path,
          content,
          mtime: file.stat.mtime,
          origin: "user-note",
        },
        model: this.settings.ollamaModel,
        signal: this.abortController.signal,
        charLimit: this.settings.extractionCharLimit,
      });
      await saveKB(this.app as never, this.kb, this.kbMtime);
      const reloaded = await loadKB(this.app as never);
      this.kbMtime = reloaded.mtime;
      new Notice(`LLM Wiki: extracted ${file.path}.`);
    } catch (e) {
      new Notice(`LLM Wiki: extract failed — ${(e as Error).message}`);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors. (The Task 17 error is now closed.)

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: zero errors. If the `no-direct-vault-write` rule flags anything in `src/plugin.ts`, you have a bug — the only vault calls in `plugin.ts` should be `vault.getAbstractFileByPath`, `vault.cachedRead`, and `workspace.getActiveFile`, none of which are write methods.

- [ ] **Step 4: Run all tests**

```bash
npm test
```
Expected: all Phase 1 + Phase 2 unit tests green. Integration tests (Task 19+) not yet written.

- [ ] **Step 5: Commit**

```bash
git add src/plugin.ts
git commit -m "feat(plugin): wire extraction provider, queue, status bar, commands, settings tab"
```

---

## Task 19: Integration test — full extraction pipeline

**Files:**
- Create: `tests/integration/phase2-extraction.test.ts`

**What & why:** End-to-end (mock-vault + mock-provider) test of the whole pipeline: walker → KB → queue → provider → save → progress events. This is the one integration test in Phase 2 that exercises everything wired together.

Note: we do **not** drive this through `LlmWikiPlugin.runExtractAll()` because doing so requires mocking `Notice`, `PluginSettingTab`, `StatusBarItem`, `addCommand`, and more. Instead, we call `runExtraction` directly with the mocked app's `saveKB` closure — that's the integration boundary that actually matters.

- [ ] **Step 1: Write the test**

Create `tests/integration/phase2-extraction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { runExtraction } from "../../src/extract/queue.js";
import { MockLLMProvider } from "../helpers/mock-llm-provider.js";
import { ProgressEmitter } from "../../src/runtime/progress.js";
import { createMockApp } from "../helpers/mock-app.js";
import { saveKB, loadKB } from "../../src/vault/kb-store.js";
import { walkVaultFiles } from "../../src/vault/walker.js";
import {
  DEFAULT_MIN_FILE_SIZE,
  DEFAULT_SKIP_DIRS,
  defaultDailiesFromIso,
} from "../../src/extract/defaults.js";

const HAPPY_JSON = `{
  "source_summary": "About Alan Watts.",
  "entities": [{"name":"Alan Watts","type":"person","aliases":[],"facts":["wrote about zen"]}],
  "concepts": [],
  "connections": []
}`;

function longBody(): string {
  return "This is a note about Alan Watts. ".repeat(10);
}

describe("Phase 2 integration", () => {
  it("walks the vault, extracts each file, and saves a shared knowledge.json", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();
    // Seed three markdown files — one skipped by size, two extracted.
    files.set("notes/a.md", {
      path: "notes/a.md",
      content: longBody(),
      mtime: now,
      ctime: now,
    });
    files.set("notes/b.md", {
      path: "notes/b.md",
      content: longBody(),
      mtime: now,
      ctime: now,
    });
    files.set("notes/tiny.md", {
      path: "notes/tiny.md",
      content: "hi",
      mtime: now,
      ctime: now,
    });

    const walked = await walkVaultFiles(app as never, {
      skipDirs: DEFAULT_SKIP_DIRS,
      minFileSize: DEFAULT_MIN_FILE_SIZE,
      dailiesFromIso: defaultDailiesFromIso(),
    });
    expect(walked.map((w) => w.path).sort()).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);

    const queueFiles = walked.map((w) => ({
      path: w.path,
      content: files.get(w.path)!.content,
      mtime: w.mtime,
      origin: w.origin,
    }));

    const kb = new KnowledgeBase();
    const provider = new MockLLMProvider([HAPPY_JSON, HAPPY_JSON]);
    const emitter = new ProgressEmitter();
    let kbMtime = 0;

    const stats = await runExtraction({
      provider,
      kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, kb, kbMtime);
        const r = await loadKB(app as never);
        kbMtime = r.mtime;
      },
      emitter,
      checkpointEvery: 5,
    });

    expect(stats.succeeded).toBe(2);
    expect(stats.failed).toBe(0);
    expect(stats.skipped).toBe(0);

    // knowledge.json was written to the mock vault.
    const stored = files.get("wiki/knowledge.json");
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!.content);
    expect(parsed.entities["alan-watts"]?.name).toBe("Alan Watts");
    expect(parsed.sources["notes/a.md"]).toBeDefined();
    expect(parsed.sources["notes/b.md"]).toBeDefined();
  });

  it("is idempotent on re-run (no LLM calls for unchanged files)", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();
    files.set("notes/a.md", {
      path: "notes/a.md",
      content: longBody(),
      mtime: now,
      ctime: now,
    });

    const kb = new KnowledgeBase();
    let kbMtime = 0;
    const emitter = new ProgressEmitter();

    const walked = await walkVaultFiles(app as never, {
      skipDirs: DEFAULT_SKIP_DIRS,
      minFileSize: DEFAULT_MIN_FILE_SIZE,
      dailiesFromIso: defaultDailiesFromIso(),
    });
    const queueFiles = walked.map((w) => ({
      path: w.path,
      content: files.get(w.path)!.content,
      mtime: w.mtime,
      origin: w.origin,
    }));

    // First run — one LLM call.
    const provider = new MockLLMProvider([HAPPY_JSON]);
    await runExtraction({
      provider,
      kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, kb, kbMtime);
        kbMtime = (await loadKB(app as never)).mtime;
      },
      emitter,
    });
    expect(provider.calls).toHaveLength(1);

    // Second run with the same file contents — zero LLM calls.
    const reloaded = await loadKB(app as never);
    const stats = await runExtraction({
      provider,
      kb: reloaded.kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: async () => {
        await saveKB(app as never, reloaded.kb, reloaded.mtime);
      },
      emitter,
    });
    expect(provider.calls).toHaveLength(1); // unchanged
    expect(stats.skipped).toBe(1);
    expect(stats.succeeded).toBe(0);
  });

  it("surfaces batch-errored on external KB modification during checkpoint", async () => {
    const { app, files } = createMockApp();
    const now = Date.now();
    for (let i = 1; i <= 6; i++) {
      files.set(`notes/${i}.md`, {
        path: `notes/${i}.md`,
        content: longBody(),
        mtime: now,
        ctime: now,
      });
    }
    const kb = new KnowledgeBase();
    let kbMtime = 0;
    const emitter = new ProgressEmitter();
    const walked = await walkVaultFiles(app as never, {
      skipDirs: DEFAULT_SKIP_DIRS,
      minFileSize: DEFAULT_MIN_FILE_SIZE,
      dailiesFromIso: defaultDailiesFromIso(),
    });
    const queueFiles = walked.map((w) => ({
      path: w.path,
      content: files.get(w.path)!.content,
      mtime: w.mtime,
      origin: w.origin,
    }));
    const provider = new MockLLMProvider(
      new Array(6).fill(
        '{"source_summary":"","entities":[],"concepts":[],"connections":[]}',
      ),
    );

    const errorMsgs: string[] = [];
    emitter.on("batch-errored", (d) => errorMsgs.push(d.message));

    // Simulate an external write right before the checkpoint at file 5.
    const saveKbWrapper = async (): Promise<void> => {
      await saveKB(app as never, kb, kbMtime);
      const r = await loadKB(app as never);
      kbMtime = r.mtime;
    };
    // Inject: after the 4th file, bump the mtime of wiki/knowledge.json on the mock.
    let processedCount = 0;
    emitter.on("file-completed", () => {
      processedCount++;
      if (processedCount === 4) {
        const kbFile = files.get("wiki/knowledge.json");
        if (kbFile) kbFile.mtime = now + 999_999;
      }
    });

    await runExtraction({
      provider,
      kb,
      files: queueFiles,
      model: "qwen2.5:7b",
      saveKB: saveKbWrapper,
      emitter,
      checkpointEvery: 5,
    });

    expect(errorMsgs.length).toBeGreaterThanOrEqual(1);
    expect(errorMsgs[0]).toMatch(/KB changed externally/);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm test -- tests/integration/phase2-extraction.test.ts
```
Expected: 3 passing. If the KB-stale test is flaky (the mtime bump may need to happen slightly earlier/later depending on how mock-app assigns mtimes), adjust the trigger condition until it is deterministic.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/phase2-extraction.test.ts
git commit -m "test(integration): cover full Phase 2 extraction pipeline"
```

---

## Task 20: Full test + lint + typecheck + build gate

**Files:** none (verification only)

**What & why:** Before touching docs or merging, the entire Phase 2 work must pass everything in one shot.

- [ ] **Step 1: Run the full suite**

```bash
cd /Users/dominiqueleca/tools/llm-wiki-plugin
npm test
```
Expected: all tests green. Count should be roughly: Phase 1 (from pre-existing run, ~60) + Phase 2 (~35) = ~95+.

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Expected: zero errors, zero warnings. If `no-direct-vault-write` fires anywhere outside `src/vault/`, the build has regressed and must be fixed before proceeding.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 4: Production build**

```bash
npm run build
```
Expected: emits `main.js` at the project root with no errors.

- [ ] **Step 5: Inspect bundle size (sanity check)**

```bash
ls -la main.js
```
Expected: under 400 KB (per spec §6.5).

- [ ] **Step 6: No commit needed** (verification only).

---

## Task 21: README update

**Files:**
- Modify: `README.md` (update Phase status, add Phase 2 section)

**What & why:** Document what Phase 2 ships. Keep the style consistent with the Phase 1 README update (one commit per phase).

- [ ] **Step 1: Read the current README**

```bash
cat README.md
```

- [ ] **Step 2: Update the README**

Edit `README.md`:
- Change the status line from "Phase 1 — Foundation (shipped)" to "Phase 2 — Extraction Beta (shipped)".
- Add a Phase 2 section immediately below the Phase 1 section. It should state:
  - What Phase 2 ships (quote the spec §10 Phase 2 row).
  - The three new commands (`extract-all`, `extract-current`, `extract-cancel`).
  - The one new settings section (Indexing — URL, model, Index now).
  - The status bar widget.
  - What Phase 2 deliberately does NOT do: no per-entity markdown pages, no cloud providers, no scheduler, no on-save, no dream.
  - How to use it: start Ollama locally, pull `qwen2.5:7b` with `ollama pull qwen2.5:7b`, install the plugin, open Obsidian settings → LLM Wiki → Indexing → Run extraction.
- Keep the "safety guarantees" section unchanged — it still applies.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Phase 2 Extraction Beta section to README"
```

---

## Task 22: Manual smoke test against the test vault

**Files:** none (manual verification)

**What & why:** Integration tests prove the wiring is correct against mocks. The smoke test proves the wiring is correct against the real Obsidian Electron runtime and a real Ollama server. Phase 1 has a similar "manual smoke test passed" commit — Phase 2 follows the same pattern.

- [ ] **Step 1: Start a local Ollama server**

```bash
ollama serve &
ollama pull qwen2.5:7b
```

Verify it responds:
```bash
curl -s http://localhost:11434/api/tags | head
```
Expected: JSON listing `qwen2.5:7b`.

- [ ] **Step 2: Build the plugin**

```bash
cd /Users/dominiqueleca/tools/llm-wiki-plugin
npm run build
```

- [ ] **Step 3: Install into the test vault**

Copy `main.js`, `manifest.json`, and (if present) `styles.css` into `/Users/dominiqueleca/tools/llm-wiki-test-vault/.obsidian/plugins/llm-wiki/`.

- [ ] **Step 4: Launch Obsidian pointed at the test vault and enable the plugin**

- [ ] **Step 5: Smoke checklist**

Work through each item, noting which pass/fail:

- [ ] Plugin loads without console errors
- [ ] Ribbon / Command Palette shows `LLM Wiki: Run extraction now`, `LLM Wiki: Extract current file`, `LLM Wiki: Cancel running extraction`, `LLM Wiki: Show vocabulary`, `LLM Wiki: Reload knowledge base from disk`
- [ ] Settings → LLM Wiki → Indexing section shows URL, model, "Run extraction", "Cancel", and last-run label
- [ ] Changing Ollama URL persists across a restart
- [ ] Changing Ollama model persists across a restart
- [ ] Running `LLM Wiki: Run extraction now` kicks off a batch
- [ ] Status bar transitions: Idle → Indexing 0/N · estimating… → Indexing K/N · ~Xs → Idle
- [ ] After completion, `wiki/knowledge.json` exists and is a non-trivial valid JSON with the expected shape
- [ ] `LLM Wiki: Show vocabulary` displays the just-extracted entities/concepts
- [ ] Running `LLM Wiki: Run extraction now` a second time results in 0 LLM calls (measured against Ollama logs or status bar)
- [ ] Modifying one note and re-running extracts exactly that one note
- [ ] Running `LLM Wiki: Cancel running extraction` mid-batch stops cleanly
- [ ] Force-editing `wiki/knowledge.json` externally during a run surfaces the "KB changed externally" status-bar error
- [ ] The plugin never writes outside `wiki/` or `.obsidian/plugins/llm-wiki/` (verify by diffing the vault after a run)

- [ ] **Step 6: Commit the smoke-test marker**

```bash
git commit --allow-empty -m "test: phase 2 manual smoke test passed against test vault"
```

If any item fails, **do not commit**. Fix the underlying issue and retry.

---

## Task 23: Merge to master

**Files:** none (git operations)

**What & why:** Phase 2 ends with a merge commit on master matching the Phase 1 merge pattern (`Merge branch 'feature/phase-1-foundation'`).

- [ ] **Step 1: Verify green on the branch**

```bash
git status                  # clean
npm test                    # all green
npm run lint                # clean
npm run typecheck           # clean
npm run build               # clean
```

- [ ] **Step 2: Merge**

```bash
git checkout master
git merge --no-ff feature/phase-2-extraction -m "Merge branch 'feature/phase-2-extraction'"
```

- [ ] **Step 3: Confirm the merge commit**

```bash
git log --oneline -10
```
Expected: top commit is the merge; below it, the Phase 2 commits in the order they were made.

- [ ] **Step 4: Optional — delete the branch**

```bash
git branch -d feature/phase-2-extraction
```

**Phase 2 done.** Phase 3 (Query + Cmd+K modal) begins in a fresh session.

---

## Spec Coverage Check

Each spec §10 Phase 2 deliverable → task that implements it:

| Spec deliverable | Task |
|---|---|
| `llm/provider.ts` interface | Task 1 |
| `llm/ollama.ts` with streaming + AbortController | Tasks 4, 5, 6 |
| `extract/` module with checkpointing + crash recovery | Tasks 7–11, 13 |
| `runtime/progress.ts` | Task 12 |
| `ui/status-bar.ts` | Tasks 14, 15 |
| Extraction commands (extract-all, extract-current, extract-cancel) | Task 18 |
| Minimal settings tab with Indexing section (Index now button) | Tasks 16, 17, 18 |
| Integration tests with mocked Ollama | Tasks 19 |
| Releasable as "LLM Wiki — Extraction Beta" | Tasks 20–23 |

Spec §5.1 extraction flow step-by-step → coverage:
- Trigger → Task 18 (commands)
- `vault/walker.ts` walk → Task 18 (already shipped in Phase 1; wired now)
- Dedupe by mtime → Task 13 (queue respects `kb.needsExtraction`)
- Build prompt from vocab → Tasks 7, 11
- `llm/provider.complete()` → Tasks 1, 4
- `extract/parser.ts` → Tasks 8, 9, 10
- KB merge (`addEntity`, `addConcept`, `addConnection`, `markSource`) → Task 11 (uses Phase 1 methods)
- `vault/kb-store.save()` mtime-checked → Task 13, 18 (uses Phase 1 `saveKB`)
- **Page generation** → intentionally not covered (Phase 4)
- Status bar → Tasks 14, 15, 18

Spec §8.10 streaming interface — `complete()` with `CompletionOptions.signal`: Task 1 + 4. `embed()` and `listModels()` intentionally deferred (see Architecture Call #2).

Spec §8.11 network calls — Phase 2 only hits `localhost:11434`. No other origins. Verified implicitly because `OllamaProvider` is the only thing that calls `fetch` and its URL is configured from settings (default `localhost:11434`).

Spec §9.3 integration scenarios covered by Phase 2:
- Full extraction pipeline → Task 19 case 1
- Incremental extraction (no LLM call on re-run) → Task 19 case 2
- Concurrent KB write detection → Task 19 case 3 + Task 13
- Path allowlist enforcement → already covered in Phase 1 tests; Phase 2 writes exclusively through `saveKB`, which was tested then
- Streaming + cancellation → Tasks 5, 6, 13 (the queue's cancel path)

**Gaps — intentionally deferred:**
- First-run hardware detection, vault event handlers, concurrent-write retry (merge-on-conflict), Ollama catalog, API key validation, dream, page filters, folder-scoped query — all Phase 3+ per spec §10.
- E2E tests in real Obsidian — Phase 6 per spec §9.4.
- Performance regression tests — Phase 6 per spec §9.6.
- `extraction-state.json` for mid-queue resume — deferred to Phase 5 per Architecture Call #3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-08-phase-2-extraction.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
