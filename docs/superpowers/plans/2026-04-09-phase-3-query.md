# Phase 3: Query

> **REQUIRED SUB-SKILL:** Read `superpowers:test-driven-development` and `superpowers:writing-plans` before starting any task. Every task in this plan follows the strict TDD five-step loop: write failing test → run failure → minimal impl → run pass → commit.

## Goal

Port the `query/` pipeline from `~/tools/llm-wiki/query.py` to the Obsidian plugin and ship a Cmd+Shift+K query modal that streams an LLM answer grounded in the Phase 2 KB. After Phase 3, the user can ask a question, see a streaming answer, expand the source list, and have the interaction logged to disk — all without leaving Obsidian.

## Architecture

```
User press Cmd+Shift+K
        │
        ▼
ui/modal/query-modal.ts  (thin Obsidian Modal shell)
        │  owns DOM, mounts controller + renderer
        ▼
ui/modal/query-controller.ts  (pure state machine, owns AbortController)
        │  idle → loading → streaming → done | error | cancelled
        ▼
query/ask.ts  (orchestrator)
        │
        ├─► query/terms.ts     (extractQueryTerms — stop words, dedupe)
        ├─► query/classify.ts  (entity_lookup | list_category | relational | conceptual)
        ├─► query/retrieve.ts  (3 rankers + RRF + quality multipliers + folder scope)
        │       │
        │       ├─► query/keyword-ranker.ts      (BM25-ish with bigram boost)
        │       ├─► query/embedding-ranker.ts    (cosine sim against query vector)
        │       │       └─► query/embeddings.ts  (cache + buildEmbeddingIndex)
        │       │               └─► query/embedding-text.ts  (contextual text)
        │       │                       └─► llm/provider.embed()
        │       ├─► query/path-ranker.ts         (source path hits)
        │       ├─► query/rrf.ts                 (weighted reciprocal rank fusion)
        │       ├─► query/quality.ts             (blacklist + multipliers + type hint)
        │       └─► query/folder-scope.ts        (filter by source prefix)
        │
        ├─► query/format-context.ts  (markdown bundle)
        ├─► query/prompts.ts         (ASK_PROMPT)
        └─► llm/provider.complete()  (streaming chunks)
                │
                ▼
ui/modal/answer-renderer.ts  (debounced markdown render via injected target)
        │
        ▼
vault/interaction-log.ts  (append JSONL line)
vault/recent-questions.ts (push to ring buffer)
```

## Tech Stack

- **TypeScript**, ESM, `.js` import extensions
- **Vitest** with `environment: "node"` (no jsdom — modal logic must split into pure helpers)
- **Obsidian API**: `Modal`, `MarkdownRenderer.render`, `addRibbonIcon`, `addCommand`, `Hotkey`
- **Ollama embeddings**: POST `/api/embeddings` with `nomic-embed-text` (default model)
- **No new runtime deps**

## Phase 3 Architecture Calls (locked in — do not relitigate)

1. **`core/filters.ts` is NOT touched.** It is the strict page-generation filter for Phase 4 (≥2 facts AND ≥2 sources). Phase 3 needs a *loose* retrieval-time blacklist + multiplier system. That lives in a new `query/quality.ts`.

2. **DOM-free logic split.** Vitest is `environment: "node"`. Modal logic splits into:
   - `query-controller.ts` — pure state machine + AbortController owner (fully tested)
   - `answer-renderer.ts` — debounced render via injected `RenderTarget` interface (tested with `fakeEl()` shim like status-bar)
   - `query-modal.ts` — thin Obsidian `Modal` subclass that wires the two above (smoke-tested only — no DOM assertions)

3. **Embedding cache invalidation by content hash.** Cache entry stores `{ sourceText, vector }`. When re-embedding, compare current contextual text to cached `sourceText` — if different, re-embed. This is a free improvement over the Python tool which keys by ID alone.

4. **Contextual embeddings (Improvement #4 from Python).** Embed `"Entity [type]: name. Also known as: ... <facts>"` not the bare name. Same for concepts. Pure functions in `query/embedding-text.ts`.

5. **Dream-boost forward compat.** `retrieve()` accepts an optional `dreamScores?: ReadonlyMap<string, number>` argument but does not consume it in Phase 3. Phase 5 (knowledge graph) fills it in. No breaking signature change later.

6. **Interaction log path.** `.obsidian/plugins/llm-wiki/interactions/YYYY-MM-DD.jsonl`. Already covered by the existing `safe-write.ts` allowlist via the `.obsidian/plugins/llm-wiki/` prefix. **A new `safeAppendPluginData()` helper** must be added to `safe-write.ts` (the existing `safeWritePluginData` is overwrite-only).

7. **Recent questions storage.** Plain JSON file at `.obsidian/plugins/llm-wiki/recent-questions.json`. Ring buffer of last N (default 5). Loaded on plugin startup, persisted on each successful query.

8. **Settings shape extension.** Add `embeddingModel: string` (default `nomic-embed-text`), `defaultQueryFolder: string` (default `""` = whole vault), `recentQuestionCount: number` (default 5), `showSourceLinks: boolean` (default true). No migration needed — defaults fill in for users upgrading from Phase 2.

9. **Quality regression test = real Phase 2 KB fixture.** Reuse `tests/fixtures/sample-kb.json` from Phase 2. Quality test asserts that "what books did Alan Watts write" returns Alan Watts ranked above unrelated entities, and that the blacklisted "exact name" entity never appears in results.

## File Structure

```
src/
├── llm/
│   ├── provider.ts           ★ MODIFIED — add EmbedOptions + embed()
│   └── ollama.ts             ★ MODIFIED — implement embed() via POST /api/embeddings
│
├── query/                    ★ NEW directory
│   ├── types.ts              RetrievedBundle, QueryType, RankedItem
│   ├── terms.ts              extractQueryTerms(text) — stop words, dedupe
│   ├── classify.ts           classifyQuery(text) → 4-type union
│   ├── keyword-ranker.ts     rankByKeyword(kb, terms) → RankedItem[]
│   ├── path-ranker.ts        rankByPath(kb, terms) → RankedItem[]
│   ├── embedding-text.ts     contextualTextForEntity / contextualTextForConcept
│   ├── embeddings.ts         buildEmbeddingIndex, cosineSim
│   ├── embedding-ranker.ts   rankByEmbedding(index, queryVec) → RankedItem[]
│   ├── rrf.ts                rrfFuse(rankedLists, weights, k=60)
│   ├── quality.ts            retrieval blacklists + qualityMultiplier + detectTypeHint
│   ├── folder-scope.ts       filterBundleByFolder(bundle, folder)
│   ├── retrieve.ts           orchestrator: terms→classify→rank→fuse→quality→focus
│   ├── format-context.ts     formatContextMarkdown(bundle) → string
│   ├── prompts.ts            ASK_PROMPT (8 numbered rules)
│   └── ask.ts                ask({question, kb, provider, ...}): AsyncIterable<AnswerEvent>
│
├── vault/
│   ├── safe-write.ts         ★ MODIFIED — add safeAppendPluginData
│   ├── plugin-data.ts        ★ MODIFIED — add load/save recent questions
│   ├── interaction-log.ts    ★ NEW — appendInteractionLog(app, entry)
│   └── recent-questions.ts   ★ NEW — load/push/save ring buffer
│
├── ui/
│   ├── modal/                ★ NEW directory
│   │   ├── query-controller.ts   pure state machine + AbortController
│   │   ├── answer-renderer.ts    debounced render via RenderTarget interface
│   │   └── query-modal.ts        Obsidian Modal subclass (thin wiring)
│   ├── settings/
│   │   ├── settings-tab.ts       ★ MODIFIED — add Query section
│   │   └── query-section.ts      ★ NEW — query settings UI
│   └── status-bar.ts             (unchanged)
│
└── plugin.ts                 ★ MODIFIED — settings, ribbon icon, hotkey command,
                                            recent-questions persistence

tests/
├── llm/ollama.embed.test.ts              ★ NEW
├── query/
│   ├── terms.test.ts                     ★ NEW
│   ├── classify.test.ts                  ★ NEW
│   ├── keyword-ranker.test.ts            ★ NEW
│   ├── path-ranker.test.ts               ★ NEW
│   ├── embedding-text.test.ts            ★ NEW
│   ├── embeddings.test.ts                ★ NEW
│   ├── embedding-ranker.test.ts          ★ NEW
│   ├── rrf.test.ts                       ★ NEW
│   ├── quality.test.ts                   ★ NEW
│   ├── folder-scope.test.ts              ★ NEW
│   ├── retrieve.test.ts                  ★ NEW
│   ├── format-context.test.ts            ★ NEW
│   └── ask.test.ts                       ★ NEW
├── vault/
│   ├── safe-write.append.test.ts         ★ NEW
│   ├── interaction-log.test.ts           ★ NEW
│   └── recent-questions.test.ts          ★ NEW
├── ui/modal/
│   ├── query-controller.test.ts          ★ NEW
│   └── answer-renderer.test.ts           ★ NEW
├── helpers/
│   └── mock-llm-provider.ts              ★ MODIFIED — add embed() with canned vectors
└── integration/
    └── phase3-query.test.ts              ★ NEW — end-to-end against sample-kb.json
```

## Critical Conventions for All Tasks

- **TDD five-step loop**: failing test → run & see fail → minimal impl → run & see pass → commit
- **ESM imports** must include `.js` extension even when importing `.ts`
- **Conventional commits**: `feat(query): ...`, `feat(llm): ...`, `feat(ui): ...`, `feat(vault): ...`, `test(query): ...`, `chore(plugin): ...`
- **No DOM in tests**. Use `fakeEl()` shims for any element-like target
- **Vault writes only via `safe-write.ts`** — ESLint rule `no-direct-vault-write` will fail otherwise
- **Inject everything for testability**: `fetch`, `Date.now`, AbortSignal, RenderTarget — never reach for globals inside core logic
- **No backwards-compat shims**. Settings get new fields with defaults; old data loads cleanly
- **One commit per task**. If a task says "commit", commit before starting the next task

## Self-Check Before You Start

```bash
cd /Users/dominiqueleca/tools/llm-wiki-plugin
git status                                 # working tree must be clean
git checkout master && git pull            # ensure on latest
git checkout -b feature/phase-3-query      # create the phase branch
npm test                                   # all Phase 1+2 tests must pass
npm run typecheck                          # zero type errors
npm run lint                               # zero lint errors
ls tests/fixtures/sample-kb.json           # Phase 2 fixture must exist
```

If any of the above fails, STOP and fix before starting Task 1.

---

## Group A — LLMProvider embed() extension

### Task 1 — Extend LLMProvider interface with embed()

**Files**
- Modify: `src/llm/provider.ts`
- Test: `tests/llm/provider.embed-types.test.ts` (NEW — type-only smoke test)

**What & why**
The Phase 2 `LLMProvider` interface only has `complete()`. Phase 3 needs `embed()` to vectorize entity/concept contextual text and query strings. Add the type without implementation; Task 2 implements it for Ollama.

**TDD**

1. **Write failing test** at `tests/llm/provider.embed-types.test.ts`:
   ```ts
   import { describe, it, expectTypeOf } from "vitest";
   import type { LLMProvider, EmbedOptions } from "../../src/llm/provider.js";

   describe("LLMProvider type surface", () => {
     it("declares embed(opts: EmbedOptions): Promise<number[]>", () => {
       expectTypeOf<LLMProvider>().toHaveProperty("embed");
       expectTypeOf<LLMProvider["embed"]>()
         .parameter(0)
         .toMatchTypeOf<EmbedOptions>();
       expectTypeOf<LLMProvider["embed"]>()
         .returns.toMatchTypeOf<Promise<number[]>>();
     });
   });
   ```

2. **Run** `npx vitest run tests/llm/provider.embed-types.test.ts` — fails: `EmbedOptions` is not exported, `embed` is missing.

3. **Minimal impl** in `src/llm/provider.ts`:
   ```ts
   export interface EmbedOptions {
     text: string;
     model: string;
     signal?: AbortSignal;
   }

   export interface LLMProvider {
     complete(opts: CompletionOptions): AsyncIterable<string>;
     embed(opts: EmbedOptions): Promise<number[]>;
   }
   ```
   Remove the `// Phase 3 will add embed()` comment.

4. **Run** `npx vitest run tests/llm/provider.embed-types.test.ts && npm run typecheck`
   - Test passes; typecheck will FAIL because `OllamaProvider` and `MockLLMProvider` don't implement `embed` yet. That's expected — Task 2 and Task 3 fix it. **Do not proceed to commit until Tasks 2 and 3 are done.**

5. **(Defer commit until Tasks 2 + 3 complete — single commit covers all three.)**

---

### Task 2 — Implement OllamaProvider.embed()

**Files**
- Modify: `src/llm/ollama.ts`
- Test: `tests/llm/ollama.embed.test.ts` (NEW)

**What & why**
Call Ollama's `POST /api/embeddings` with `{ model, prompt: text }` and return the `embedding` array. Mirror the `complete()` pattern: inject `fetchImpl`, support `AbortSignal`, throw `LLMHttpError`/`LLMAbortError`/`LLMProtocolError`.

**TDD**

1. **Write failing test** at `tests/llm/ollama.embed.test.ts`:
   ```ts
   import { describe, it, expect, vi } from "vitest";
   import { OllamaProvider } from "../../src/llm/ollama.js";
   import { LLMHttpError, LLMAbortError, LLMProtocolError } from "../../src/llm/provider.js";

   function jsonResponse(body: unknown, status = 200): Response {
     return new Response(JSON.stringify(body), {
       status,
       headers: { "content-type": "application/json" },
     });
   }

   describe("OllamaProvider.embed", () => {
     it("POSTs to /api/embeddings and returns the embedding vector", async () => {
       const fetchImpl = vi.fn(async () =>
         jsonResponse({ embedding: [0.1, 0.2, 0.3] }),
       );
       const provider = new OllamaProvider({ url: "http://x", fetchImpl });

       const vec = await provider.embed({ text: "hello", model: "nomic-embed-text" });

       expect(vec).toEqual([0.1, 0.2, 0.3]);
       expect(fetchImpl).toHaveBeenCalledOnce();
       const [url, init] = fetchImpl.mock.calls[0]!;
       expect(url).toBe("http://x/api/embeddings");
       expect(init?.method).toBe("POST");
       const body = JSON.parse(init?.body as string);
       expect(body).toEqual({ model: "nomic-embed-text", prompt: "hello" });
     });

     it("throws LLMHttpError on non-2xx", async () => {
       const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
       const provider = new OllamaProvider({ url: "http://x", fetchImpl });

       await expect(
         provider.embed({ text: "hi", model: "nomic-embed-text" }),
       ).rejects.toBeInstanceOf(LLMHttpError);
     });

     it("throws LLMProtocolError when response lacks embedding array", async () => {
       const fetchImpl = vi.fn(async () => jsonResponse({ wrong: true }));
       const provider = new OllamaProvider({ url: "http://x", fetchImpl });

       await expect(
         provider.embed({ text: "hi", model: "nomic-embed-text" }),
       ).rejects.toBeInstanceOf(LLMProtocolError);
     });

     it("throws LLMAbortError when signal is already aborted", async () => {
       const fetchImpl = vi.fn(async (_url, init) => {
         if ((init as RequestInit)?.signal?.aborted) {
           throw new DOMException("aborted", "AbortError");
         }
         return jsonResponse({ embedding: [1] });
       });
       const provider = new OllamaProvider({ url: "http://x", fetchImpl });
       const ctrl = new AbortController();
       ctrl.abort();

       await expect(
         provider.embed({ text: "hi", model: "nomic-embed-text", signal: ctrl.signal }),
       ).rejects.toBeInstanceOf(LLMAbortError);
     });
   });
   ```

2. **Run** `npx vitest run tests/llm/ollama.embed.test.ts` — fails: no `embed` method.

3. **Minimal impl** — add to `OllamaProvider` class in `src/llm/ollama.ts`:
   ```ts
   async embed(opts: EmbedOptions): Promise<number[]> {
     let response: Response;
     try {
       response = await this.fetchImpl(`${this.url}/api/embeddings`, {
         method: "POST",
         headers: { "content-type": "application/json" },
         body: JSON.stringify({ model: opts.model, prompt: opts.text }),
         signal: opts.signal,
       });
     } catch (err) {
       if (err instanceof DOMException && err.name === "AbortError") {
         throw new LLMAbortError("Embedding request aborted");
       }
       throw err;
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
   ```
   Add `EmbedOptions` to the import from `./provider.js`.

4. **Run** `npx vitest run tests/llm/ollama.embed.test.ts` — all 4 pass.

5. **(Still no commit — Task 3 next.)**

---

### Task 3 — Add embed() to MockLLMProvider

**Files**
- Modify: `tests/helpers/mock-llm-provider.ts`
- Test: existing `tests/helpers/mock-llm-provider.test.ts` if present, otherwise `tests/helpers/mock-llm-provider.embed.test.ts` (NEW)

**What & why**
Test fixtures need to inject canned embedding vectors so retrieval tests can run hermetically without Ollama. Add a `embeddings: number[][]` queue and an `embed()` method that returns them in order.

**TDD**

1. **Write failing test** at `tests/helpers/mock-llm-provider.embed.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import { MockLLMProvider } from "./mock-llm-provider.js";

   describe("MockLLMProvider.embed", () => {
     it("returns canned vectors in order", async () => {
       const m = new MockLLMProvider({
         responses: [],
         embeddings: [[1, 0, 0], [0, 1, 0]],
       });
       expect(await m.embed({ text: "a", model: "x" })).toEqual([1, 0, 0]);
       expect(await m.embed({ text: "b", model: "x" })).toEqual([0, 1, 0]);
     });

     it("throws when embeddings queue is exhausted", async () => {
       const m = new MockLLMProvider({ responses: [], embeddings: [[1]] });
       await m.embed({ text: "a", model: "x" });
       await expect(m.embed({ text: "b", model: "x" })).rejects.toThrow(
         /no more embeddings/i,
       );
     });
   });
   ```

2. **Run** — fails: `embed` is not on `MockLLMProvider`, no `embeddings` ctor option.

3. **Minimal impl** — add to `MockLLMProvider`:
   ```ts
   private readonly embeddings: number[][];
   private embedIdx = 0;

   constructor(opts: { responses: string[]; embeddings?: number[][]; /* existing */ }) {
     // ... existing
     this.embeddings = opts.embeddings ?? [];
   }

   async embed(_opts: EmbedOptions): Promise<number[]> {
     if (this.embedIdx >= this.embeddings.length) {
       throw new Error("MockLLMProvider: no more embeddings in queue");
     }
     return this.embeddings[this.embedIdx++]!;
   }
   ```

4. **Run** `npx vitest run tests/helpers/mock-llm-provider.embed.test.ts && npm run typecheck && npm test` — all pass, typecheck clean.

5. **Commit (covers Tasks 1+2+3):**
   ```bash
   git add src/llm/provider.ts src/llm/ollama.ts tests/llm/ollama.embed.test.ts \
           tests/llm/provider.embed-types.test.ts \
           tests/helpers/mock-llm-provider.ts tests/helpers/mock-llm-provider.embed.test.ts
   git commit -m "feat(llm): add embed() to LLMProvider with Ollama implementation"
   ```

---

## Group B — Pure query primitives

### Task 4 — query/types.ts

**Files**
- Create: `src/query/types.ts`
- Test: none (pure type declarations — covered by downstream tests)

**What & why**
Single source of truth for query-side types. Imported by every other `query/` module.

**Impl** — write directly:
```ts
import type { Concept, Connection, Entity, SourceRecord } from "../core/types.js";

export type QueryType =
  | "entity_lookup"
  | "list_category"
  | "relational"
  | "conceptual";

export interface RankedItem {
  /** Stable ID — entity name slug or concept name slug. */
  id: string;
  /** Raw ranker score (interpretation depends on the ranker). */
  score: number;
}

export interface RetrievedBundle {
  question: string;
  queryType: QueryType;
  entities: Entity[];
  concepts: Concept[];
  connections: Connection[];
  sources: SourceRecord[];
}

export interface AnswerEvent {
  kind: "context" | "chunk" | "done" | "error";
  bundle?: RetrievedBundle;
  text?: string;
  error?: string;
}
```

**Run** `npm run typecheck` — clean.

**Commit:**
```bash
git add src/query/types.ts
git commit -m "feat(query): add query type definitions"
```

---

### Task 5 — query/terms.ts (extractQueryTerms)

**Files**
- Create: `src/query/terms.ts`
- Test: `tests/query/terms.test.ts`

**What & why**
Tokenize a question into search terms. Lowercase, strip punctuation, drop English stop words, dedupe in order. Pure function — no KB needed.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { extractQueryTerms } from "../../src/query/terms.js";

   describe("extractQueryTerms", () => {
     it("lowercases and tokenizes a question", () => {
       expect(extractQueryTerms("Who is Alan Watts?")).toEqual(["alan", "watts"]);
     });

     it("drops common English stop words", () => {
       expect(extractQueryTerms("what is the meaning of zen")).toEqual([
         "meaning",
         "zen",
       ]);
     });

     it("dedupes while preserving order", () => {
       expect(extractQueryTerms("zen and zen and more zen")).toEqual([
         "zen",
         "more",
       ]);
     });

     it("strips punctuation", () => {
       expect(extractQueryTerms("Karpathy's videos, please!")).toEqual([
         "karpathy",
         "videos",
         "please",
       ]);
     });

     it("returns empty for empty input", () => {
       expect(extractQueryTerms("")).toEqual([]);
       expect(extractQueryTerms("   ")).toEqual([]);
     });
   });
   ```

2. **Run** — fails (module missing).

3. **Minimal impl** in `src/query/terms.ts`:
   ```ts
   const STOP_WORDS = new Set([
     "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
     "of", "to", "in", "on", "at", "for", "with", "by", "from", "about",
     "as", "into", "through", "during", "and", "or", "but", "if", "then",
     "what", "who", "which", "where", "when", "why", "how",
     "this", "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
     "do", "does", "did", "have", "has", "had", "can", "could", "should", "would",
     "will", "shall", "may", "might", "must", "me", "my", "your", "his", "her",
     "its", "our", "their",
   ]);

   export function extractQueryTerms(text: string): string[] {
     const tokens = text
       .toLowerCase()
       .replace(/[^\p{L}\p{N}\s]/gu, " ")
       .split(/\s+/)
       .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
     const seen = new Set<string>();
     const out: string[] = [];
     for (const t of tokens) {
       if (!seen.has(t)) {
         seen.add(t);
         out.push(t);
       }
     }
     return out;
   }
   ```

4. **Run** — all 5 pass.

5. **Commit:**
   ```bash
   git add src/query/terms.ts tests/query/terms.test.ts
   git commit -m "feat(query): extract search terms with stop-word filter"
   ```

---

### Task 6 — query/classify.ts

**Files**
- Create: `src/query/classify.ts`
- Test: `tests/query/classify.test.ts`

**What & why**
Classify a question into one of four types. Drives the per-type weight tuple in RRF and quality multipliers.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { classifyQuery } from "../../src/query/classify.js";

   describe("classifyQuery", () => {
     it("detects list_category questions", () => {
       expect(classifyQuery("what books did Alan Watts write")).toBe("list_category");
       expect(classifyQuery("list all the people in the kb")).toBe("list_category");
       expect(classifyQuery("how many tools are mentioned")).toBe("list_category");
     });

     it("detects entity_lookup questions", () => {
       expect(classifyQuery("who is Alan Watts")).toBe("entity_lookup");
       expect(classifyQuery("tell me about Karpathy")).toBe("entity_lookup");
       expect(classifyQuery("what is zen")).toBe("entity_lookup");
     });

     it("detects relational questions", () => {
       expect(classifyQuery("how does Alan Watts relate to zen")).toBe("relational");
       expect(classifyQuery("what is the connection between A and B")).toBe(
         "relational",
       );
     });

     it("falls back to conceptual for everything else", () => {
       expect(classifyQuery("explain the law of reversed effort")).toBe("conceptual");
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { QueryType } from "./types.js";

   const LIST_PATTERNS = [
     /\bwhat\s+(books|articles|tools|people|places|events|projects)\b/i,
     /\blist\s+(all|the)\b/i,
     /\bhow\s+many\b/i,
     /\bwhich\s+(books|articles|tools|people)\b/i,
     /\ball\s+the\b/i,
   ];

   const ENTITY_PATTERNS = [
     /^who\s+is\b/i,
     /^what\s+is\b/i,
     /^tell\s+me\s+about\b/i,
     /^who\s+was\b/i,
     /^what\s+was\b/i,
   ];

   const RELATIONAL_PATTERNS = [
     /\brelate(s|d)?\s+to\b/i,
     /\bconnection\s+between\b/i,
     /\binfluence(s|d)?\b/i,
     /\bhow\s+does\b.*\b(relate|connect|influence)\b/i,
   ];

   export function classifyQuery(text: string): QueryType {
     for (const p of LIST_PATTERNS) if (p.test(text)) return "list_category";
     for (const p of RELATIONAL_PATTERNS) if (p.test(text)) return "relational";
     for (const p of ENTITY_PATTERNS) if (p.test(text)) return "entity_lookup";
     return "conceptual";
   }
   ```

4. **Run** — all pass.

5. **Commit:**
   ```bash
   git add src/query/classify.ts tests/query/classify.test.ts
   git commit -m "feat(query): classify questions into 4 query types"
   ```

---

### Task 7 — query/keyword-ranker.ts

**Files**
- Create: `src/query/keyword-ranker.ts`
- Test: `tests/query/keyword-ranker.test.ts`

**What & why**
Score entities and concepts by keyword overlap with query terms. Name/alias hit = 3 points; fact substring hit = 1 point; bigram (two consecutive query terms) match in name = 6 points. Sort by score desc, break ties by richness (fact + source count).

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { rankByKeyword } from "../../src/query/keyword-ranker.js";
   import { KnowledgeBase } from "../../src/core/kb.js";

   function buildKB() {
     const kb = new KnowledgeBase();
     kb.addEntity({
       name: "Alan Watts",
       type: "person",
       aliases: ["Watts"],
       facts: [
         "British philosopher who wrote about zen",
         "Author of The Way of Zen",
       ],
       source: "Books/Watts.md",
     });
     kb.addEntity({
       name: "Andrej Karpathy",
       type: "person",
       aliases: [],
       facts: ["AI researcher"],
       source: "Learn/Karpathy.md",
     });
     kb.addEntity({
       name: "Lonely",
       type: "other",
       aliases: [],
       facts: ["unrelated"],
       source: "x.md",
     });
     return kb;
   }

   describe("rankByKeyword", () => {
     it("ranks the entity whose name matches first", () => {
       const kb = buildKB();
       const ranked = rankByKeyword(kb, ["alan", "watts"]);
       expect(ranked[0]?.id).toBe("alan-watts");
       expect(ranked[0]?.score).toBeGreaterThan(0);
     });

     it("gives bigram boost when consecutive terms appear in name", () => {
       const kb = buildKB();
       const noBigram = rankByKeyword(kb, ["alan", "karpathy"]);
       const withBigram = rankByKeyword(kb, ["alan", "watts"]);
       const wattsScoreNoBi = noBigram.find((r) => r.id === "alan-watts")!.score;
       const wattsScoreBi = withBigram.find((r) => r.id === "alan-watts")!.score;
       expect(wattsScoreBi).toBeGreaterThan(wattsScoreNoBi);
     });

     it("matches fact substrings for 1 point each", () => {
       const kb = buildKB();
       const ranked = rankByKeyword(kb, ["philosopher"]);
       const hit = ranked.find((r) => r.id === "alan-watts");
       expect(hit?.score).toBe(1);
     });

     it("returns empty for empty terms", () => {
       expect(rankByKeyword(buildKB(), [])).toEqual([]);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { KnowledgeBase } from "../core/kb.js";
   import type { RankedItem } from "./types.js";

   const NAME_HIT = 3;
   const FACT_HIT = 1;
   const BIGRAM_BOOST = 6;

   function slug(s: string): string {
     return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
   }

   export function rankByKeyword(
     kb: KnowledgeBase,
     terms: readonly string[],
   ): RankedItem[] {
     if (terms.length === 0) return [];
     const items: Array<{ id: string; score: number; richness: number }> = [];

     for (const e of kb.allEntities()) {
       let score = 0;
       const nameLower = e.name.toLowerCase();
       const aliasesLower = e.aliases.map((a) => a.toLowerCase());
       for (const t of terms) {
         if (nameLower.includes(t)) score += NAME_HIT;
         else if (aliasesLower.some((a) => a.includes(t))) score += NAME_HIT;
         for (const f of e.facts) {
           if (f.toLowerCase().includes(t)) score += FACT_HIT;
         }
       }
       for (let i = 0; i < terms.length - 1; i++) {
         const bigram = `${terms[i]} ${terms[i + 1]}`;
         if (nameLower.includes(bigram)) score += BIGRAM_BOOST;
       }
       if (score > 0) {
         items.push({
           id: slug(e.name),
           score,
           richness: e.facts.length + e.sources.length,
         });
       }
     }

     for (const c of kb.allConcepts()) {
       let score = 0;
       const nameLower = c.name.toLowerCase();
       const defLower = (c.definition ?? "").toLowerCase();
       for (const t of terms) {
         if (nameLower.includes(t)) score += NAME_HIT;
         if (defLower.includes(t)) score += FACT_HIT;
       }
       if (score > 0) {
         items.push({
           id: `concept:${slug(c.name)}`,
           score,
           richness: (c.related?.length ?? 0) + c.sources.length,
         });
       }
     }

     items.sort((a, b) => b.score - a.score || b.richness - a.richness);
     return items.map(({ id, score }) => ({ id, score }));
   }
   ```
   This requires `kb.allEntities()` and `kb.allConcepts()` getters. **Verify they exist** in `src/core/kb.ts` before relying on them. If missing, add minimal getters in this same task and add a test for them in `tests/core/kb.test.ts`.

4. **Run** — all pass.

5. **Commit:**
   ```bash
   git add src/query/keyword-ranker.ts tests/query/keyword-ranker.test.ts \
           src/core/kb.ts tests/core/kb.test.ts
   git commit -m "feat(query): rank entities and concepts by keyword overlap"
   ```

---

### Task 8 — query/path-ranker.ts

**Files**
- Create: `src/query/path-ranker.ts`
- Test: `tests/query/path-ranker.test.ts`

**What & why**
For each entity/concept, count how many query terms appear in any of its source paths. A term-in-path hit is a 1-point signal — useful for "what was that thing in my Books folder" type queries.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { rankByPath } from "../../src/query/path-ranker.js";
   import { KnowledgeBase } from "../../src/core/kb.js";

   describe("rankByPath", () => {
     it("scores entities by source-path term hits", () => {
       const kb = new KnowledgeBase();
       kb.addEntity({
         name: "Alan Watts",
         type: "person",
         aliases: [],
         facts: ["x"],
         source: "Books/Watts.md",
       });
       kb.addEntity({
         name: "Karpathy",
         type: "person",
         aliases: [],
         facts: ["y"],
         source: "Learn/Karpathy.md",
       });
       const ranked = rankByPath(kb, ["books"]);
       expect(ranked[0]?.id).toBe("alan-watts");
     });

     it("returns empty when no term matches any path", () => {
       const kb = new KnowledgeBase();
       kb.addEntity({
         name: "X",
         type: "other",
         aliases: [],
         facts: ["y"],
         source: "Other/X.md",
       });
       expect(rankByPath(kb, ["books"])).toEqual([]);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { KnowledgeBase } from "../core/kb.js";
   import type { RankedItem } from "./types.js";

   function slug(s: string): string {
     return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
   }

   export function rankByPath(
     kb: KnowledgeBase,
     terms: readonly string[],
   ): RankedItem[] {
     if (terms.length === 0) return [];
     const items: RankedItem[] = [];

     for (const e of kb.allEntities()) {
       let score = 0;
       for (const src of e.sources) {
         const lower = src.toLowerCase();
         for (const t of terms) if (lower.includes(t)) score += 1;
       }
       if (score > 0) items.push({ id: slug(e.name), score });
     }

     for (const c of kb.allConcepts()) {
       let score = 0;
       for (const src of c.sources) {
         const lower = src.toLowerCase();
         for (const t of terms) if (lower.includes(t)) score += 1;
       }
       if (score > 0) items.push({ id: `concept:${slug(c.name)}`, score });
     }

     items.sort((a, b) => b.score - a.score);
     return items;
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/path-ranker.ts tests/query/path-ranker.test.ts
   git commit -m "feat(query): rank entities by source-path term hits"
   ```

---

## Group C — Embeddings

### Task 9 — query/embedding-text.ts

**Files**
- Create: `src/query/embedding-text.ts`
- Test: `tests/query/embedding-text.test.ts`

**What & why**
Build the *contextual* string we feed to the embedder. Bare names embed poorly (`"watts"` collides with the unit). Wrapping in `"Entity [type]: name. Also known as: ... Facts: ..."` produces much better cosine similarity. Pure functions, no I/O.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     contextualTextForEntity,
     contextualTextForConcept,
   } from "../../src/query/embedding-text.js";
   import type { Entity, Concept } from "../../src/core/types.js";

   describe("contextualTextForEntity", () => {
     it("includes type, name, aliases, and facts", () => {
       const e: Entity = {
         name: "Alan Watts",
         type: "person",
         aliases: ["Watts"],
         facts: ["British philosopher", "Wrote The Way of Zen"],
         sources: ["x.md"],
       };
       const text = contextualTextForEntity(e);
       expect(text).toContain("Entity [person]");
       expect(text).toContain("Alan Watts");
       expect(text).toContain("Watts");
       expect(text).toContain("British philosopher");
     });

     it("caps facts at 5", () => {
       const e: Entity = {
         name: "X",
         type: "other",
         aliases: [],
         facts: ["a", "b", "c", "d", "e", "f", "g"],
         sources: [],
       };
       const text = contextualTextForEntity(e);
       expect(text).toContain("a");
       expect(text).toContain("e");
       expect(text).not.toContain("f");
     });

     it("omits aliases line when none", () => {
       const e: Entity = {
         name: "X",
         type: "other",
         aliases: [],
         facts: ["fact"],
         sources: [],
       };
       expect(contextualTextForEntity(e)).not.toContain("Also known as");
     });
   });

   describe("contextualTextForConcept", () => {
     it("includes name, definition, and related", () => {
       const c: Concept = {
         name: "Zen",
         definition: "A school of Mahayana Buddhism".repeat(20),
         related: ["meditation", "koan"],
         sources: ["x.md"],
       };
       const text = contextualTextForConcept(c);
       expect(text).toContain("Concept: Zen");
       expect(text).toContain("Mahayana");
       expect(text).toContain("meditation");
     });

     it("truncates definition at 200 chars", () => {
       const c: Concept = {
         name: "X",
         definition: "a".repeat(500),
         related: [],
         sources: [],
       };
       const text = contextualTextForConcept(c);
       const defChars = text.match(/a+/g)?.[0]?.length ?? 0;
       expect(defChars).toBeLessThanOrEqual(200);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { Concept, Entity } from "../core/types.js";

   const MAX_FACTS = 5;
   const MAX_DEF = 200;

   export function contextualTextForEntity(e: Entity): string {
     const parts: string[] = [`Entity [${e.type}]: ${e.name}.`];
     if (e.aliases.length > 0) {
       parts.push(`Also known as: ${e.aliases.join(", ")}.`);
     }
     if (e.facts.length > 0) {
       parts.push(e.facts.slice(0, MAX_FACTS).join(" "));
     }
     return parts.join(" ");
   }

   export function contextualTextForConcept(c: Concept): string {
     const def = (c.definition ?? "").slice(0, MAX_DEF);
     const parts: string[] = [`Concept: ${c.name}.`];
     if (def.length > 0) parts.push(def);
     if (c.related && c.related.length > 0) {
       parts.push(`Related to: ${c.related.join(", ")}.`);
     }
     return parts.join(" ");
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/embedding-text.ts tests/query/embedding-text.test.ts
   git commit -m "feat(query): build contextual text for entity and concept embeddings"
   ```

---

### Task 10 — query/embeddings.ts (cosine + buildEmbeddingIndex)

**Files**
- Create: `src/query/embeddings.ts`
- Test: `tests/query/embeddings.test.ts`

**What & why**
`cosineSim(a, b)` is a pure math helper. `buildEmbeddingIndex({ kb, provider, model, cache })` walks the KB, computes contextual text, compares against the cache, calls `provider.embed()` only for stale/new entries, and returns a `{ id → vector }` map. Cache is updated in place.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { cosineSim, buildEmbeddingIndex } from "../../src/query/embeddings.js";
   import { KnowledgeBase } from "../../src/core/kb.js";
   import { MockLLMProvider } from "../helpers/mock-llm-provider.js";
   import type { EmbeddingsCache } from "../../src/vault/plugin-data.js";

   describe("cosineSim", () => {
     it("returns 1 for identical vectors", () => {
       expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
     });
     it("returns 0 for orthogonal", () => {
       expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
     });
     it("returns 0 for zero vector", () => {
       expect(cosineSim([0, 0], [1, 1])).toBe(0);
     });
   });

   describe("buildEmbeddingIndex", () => {
     it("embeds new entities and stores in cache", async () => {
       const kb = new KnowledgeBase();
       kb.addEntity({
         name: "Alan Watts",
         type: "person",
         aliases: [],
         facts: ["philosopher"],
         source: "x.md",
       });
       const provider = new MockLLMProvider({
         responses: [],
         embeddings: [[1, 0, 0]],
       });
       const cache: EmbeddingsCache = { vaultId: "v1", entries: {} };
       const index = await buildEmbeddingIndex({
         kb,
         provider,
         model: "nomic-embed-text",
         cache,
       });
       expect(index.get("alan-watts")).toEqual([1, 0, 0]);
       expect(cache.entries["alan-watts"]?.vector).toEqual([1, 0, 0]);
       expect(cache.entries["alan-watts"]?.sourceText).toContain("Alan Watts");
     });

     it("skips re-embedding when cache sourceText matches", async () => {
       const kb = new KnowledgeBase();
       kb.addEntity({
         name: "Alan Watts",
         type: "person",
         aliases: [],
         facts: ["philosopher"],
         source: "x.md",
       });
       const provider = new MockLLMProvider({ responses: [], embeddings: [] });
       // pre-populate the cache with the EXACT current contextual text
       const { contextualTextForEntity } = await import(
         "../../src/query/embedding-text.js"
       );
       const text = contextualTextForEntity(kb.allEntities()[0]!);
       const cache: EmbeddingsCache = {
         vaultId: "v1",
         entries: {
           "alan-watts": { sourceText: text, vector: [9, 9, 9] },
         },
       };
       const index = await buildEmbeddingIndex({
         kb,
         provider,
         model: "nomic-embed-text",
         cache,
       });
       expect(index.get("alan-watts")).toEqual([9, 9, 9]);
     });

     it("re-embeds when cached sourceText is stale", async () => {
       const kb = new KnowledgeBase();
       kb.addEntity({
         name: "Alan Watts",
         type: "person",
         aliases: [],
         facts: ["new fact"],
         source: "x.md",
       });
       const provider = new MockLLMProvider({
         responses: [],
         embeddings: [[1, 1, 1]],
       });
       const cache: EmbeddingsCache = {
         vaultId: "v1",
         entries: {
           "alan-watts": { sourceText: "stale text", vector: [9, 9, 9] },
         },
       };
       const index = await buildEmbeddingIndex({
         kb,
         provider,
         model: "nomic-embed-text",
         cache,
       });
       expect(index.get("alan-watts")).toEqual([1, 1, 1]);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { KnowledgeBase } from "../core/kb.js";
   import type { LLMProvider } from "../llm/provider.js";
   import type { EmbeddingsCache } from "../vault/plugin-data.js";
   import {
     contextualTextForConcept,
     contextualTextForEntity,
   } from "./embedding-text.js";

   export function cosineSim(a: readonly number[], b: readonly number[]): number {
     const len = Math.min(a.length, b.length);
     let dot = 0;
     let na = 0;
     let nb = 0;
     for (let i = 0; i < len; i++) {
       dot += a[i]! * b[i]!;
       na += a[i]! * a[i]!;
       nb += b[i]! * b[i]!;
     }
     if (na === 0 || nb === 0) return 0;
     return dot / (Math.sqrt(na) * Math.sqrt(nb));
   }

   function slug(s: string): string {
     return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
   }

   export interface BuildEmbeddingIndexArgs {
     kb: KnowledgeBase;
     provider: LLMProvider;
     model: string;
     cache: EmbeddingsCache;
     signal?: AbortSignal;
   }

   export async function buildEmbeddingIndex(
     args: BuildEmbeddingIndexArgs,
   ): Promise<Map<string, number[]>> {
     const index = new Map<string, number[]>();

     for (const e of args.kb.allEntities()) {
       const id = slug(e.name);
       const text = contextualTextForEntity(e);
       const cached = args.cache.entries[id];
       if (cached && cached.sourceText === text) {
         index.set(id, cached.vector);
         continue;
       }
       const vec = await args.provider.embed({
         text,
         model: args.model,
         signal: args.signal,
       });
       args.cache.entries[id] = { sourceText: text, vector: vec };
       index.set(id, vec);
     }

     for (const c of args.kb.allConcepts()) {
       const id = `concept:${slug(c.name)}`;
       const text = contextualTextForConcept(c);
       const cached = args.cache.entries[id];
       if (cached && cached.sourceText === text) {
         index.set(id, cached.vector);
         continue;
       }
       const vec = await args.provider.embed({
         text,
         model: args.model,
         signal: args.signal,
       });
       args.cache.entries[id] = { sourceText: text, vector: vec };
       index.set(id, vec);
     }

     return index;
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/embeddings.ts tests/query/embeddings.test.ts
   git commit -m "feat(query): cosine sim + cache-aware embedding index builder"
   ```

---

### Task 11 — query/embedding-ranker.ts

**Files**
- Create: `src/query/embedding-ranker.ts`
- Test: `tests/query/embedding-ranker.test.ts`

**What & why**
Given a precomputed `Map<id, vector>` and a query vector, return the top 50 by cosine similarity.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { rankByEmbedding } from "../../src/query/embedding-ranker.js";

   describe("rankByEmbedding", () => {
     it("ranks items by cosine similarity to the query vector", () => {
       const index = new Map<string, number[]>([
         ["a", [1, 0, 0]],
         ["b", [0, 1, 0]],
         ["c", [0.9, 0.1, 0]],
       ]);
       const ranked = rankByEmbedding(index, [1, 0, 0]);
       expect(ranked[0]?.id).toBe("a");
       expect(ranked[1]?.id).toBe("c");
       expect(ranked[2]?.id).toBe("b");
     });

     it("caps results at 50", () => {
       const index = new Map<string, number[]>();
       for (let i = 0; i < 100; i++) index.set(`e${i}`, [Math.random()]);
       expect(rankByEmbedding(index, [1]).length).toBe(50);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import { cosineSim } from "./embeddings.js";
   import type { RankedItem } from "./types.js";

   const TOP_N = 50;

   export function rankByEmbedding(
     index: ReadonlyMap<string, number[]>,
     queryVec: readonly number[],
   ): RankedItem[] {
     const scored: RankedItem[] = [];
     for (const [id, vec] of index) {
       const score = cosineSim(queryVec, vec);
       if (score > 0) scored.push({ id, score });
     }
     scored.sort((a, b) => b.score - a.score);
     return scored.slice(0, TOP_N);
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/embedding-ranker.ts tests/query/embedding-ranker.test.ts
   git commit -m "feat(query): rank items by cosine similarity to query vector"
   ```

---

## Group D — Fusion, quality, retrieve

### Task 12 — query/rrf.ts

**Files**
- Create: `src/query/rrf.ts`
- Test: `tests/query/rrf.test.ts`

**What & why**
Reciprocal Rank Fusion: `score[id] += weight / (k + rank + 1)` summed across ranked lists. Pure function.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { rrfFuse } from "../../src/query/rrf.js";
   import type { RankedItem } from "../../src/query/types.js";

   describe("rrfFuse", () => {
     it("fuses two ranked lists with weights", () => {
       const list1: RankedItem[] = [
         { id: "a", score: 10 },
         { id: "b", score: 5 },
       ];
       const list2: RankedItem[] = [
         { id: "b", score: 8 },
         { id: "a", score: 4 },
       ];
       const fused = rrfFuse([list1, list2], [1.0, 1.0], 60);
       expect(fused[0]?.id).toBe("a"); // a is rank 0 in list1 + rank 1 in list2
       expect(fused.length).toBe(2);
     });

     it("respects per-list weights", () => {
       const list1: RankedItem[] = [{ id: "a", score: 1 }];
       const list2: RankedItem[] = [{ id: "b", score: 1 }];
       const fused = rrfFuse([list1, list2], [10.0, 0.1], 60);
       expect(fused[0]?.id).toBe("a");
     });

     it("handles empty lists", () => {
       expect(rrfFuse([], [], 60)).toEqual([]);
       expect(rrfFuse([[]], [1.0], 60)).toEqual([]);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { RankedItem } from "./types.js";

   export function rrfFuse(
     ranked: ReadonlyArray<readonly RankedItem[]>,
     weights: readonly number[],
     k: number,
   ): RankedItem[] {
     const acc = new Map<string, number>();
     for (let i = 0; i < ranked.length; i++) {
       const list = ranked[i]!;
       const w = weights[i] ?? 1.0;
       for (let r = 0; r < list.length; r++) {
         const item = list[r]!;
         const contribution = w / (k + r + 1);
         acc.set(item.id, (acc.get(item.id) ?? 0) + contribution);
       }
     }
     return Array.from(acc.entries())
       .map(([id, score]) => ({ id, score }))
       .sort((a, b) => b.score - a.score);
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/rrf.ts tests/query/rrf.test.ts
   git commit -m "feat(query): weighted reciprocal rank fusion"
   ```

---

### Task 13 — query/quality.ts

**Files**
- Create: `src/query/quality.ts`
- Test: `tests/query/quality.test.ts`

**What & why**
Three things bundled because they all operate on the post-RRF list:
- `RETRIEVAL_BLACKLIST` — entities/concepts that should never appear in results regardless of score (e.g. "exact name", "address book")
- `qualityMultiplier(item, kb)` — soft re-ranking: rich entities ×1.3, empty ×0.3, twitter-only sources ×0.3, etc.
- `detectTypeHint(terms)` — returns the entity type implied by terms ("books" → "book"), used by retrieve.ts to apply a ×2.5 boost to matching-type entities

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     RETRIEVAL_ENTITY_BLACKLIST,
     RETRIEVAL_CONCEPT_BLACKLIST,
     qualityMultiplier,
     detectTypeHint,
   } from "../../src/query/quality.js";
   import { KnowledgeBase } from "../../src/core/kb.js";

   describe("blacklists", () => {
     it("includes the known bad names", () => {
       expect(RETRIEVAL_ENTITY_BLACKLIST.has("exact name")).toBe(true);
       expect(RETRIEVAL_CONCEPT_BLACKLIST.has("address book")).toBe(true);
     });
   });

   describe("qualityMultiplier", () => {
     function kbWith(facts: number, sources: string[]): KnowledgeBase {
       const kb = new KnowledgeBase();
       kb.addEntity({
         name: "X",
         type: "person",
         aliases: [],
         facts: Array.from({ length: facts }, (_, i) => `f${i}`),
         source: sources[0] ?? "Other/x.md",
       });
       for (let i = 1; i < sources.length; i++) {
         kb.addEntity({
           name: "X",
           type: "person",
           aliases: [],
           facts: [],
           source: sources[i]!,
         });
       }
       return kb;
     }

     it("boosts entities with ≥3 facts", () => {
       const kb = kbWith(3, ["Books/x.md"]);
       expect(qualityMultiplier("x", kb)).toBeGreaterThan(1.0);
     });

     it("penalises entities with 0 facts", () => {
       const kb = kbWith(0, ["Books/x.md"]);
       expect(qualityMultiplier("x", kb)).toBeLessThan(1.0);
     });

     it("penalises twitter-only sources", () => {
       const kb = kbWith(2, ["Twitter/a.md", "Twitter/b.md"]);
       expect(qualityMultiplier("x", kb)).toBeLessThan(1.0);
     });
   });

   describe("detectTypeHint", () => {
     it("maps plurals and synonyms to entity types", () => {
       expect(detectTypeHint(["books"])).toBe("book");
       expect(detectTypeHint(["people"])).toBe("person");
       expect(detectTypeHint(["companies"])).toBe("org");
     });
     it("returns null when no type hint present", () => {
       expect(detectTypeHint(["random", "words"])).toBeNull();
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { KnowledgeBase } from "../core/kb.js";
   import type { EntityType } from "../core/types.js";

   export const RETRIEVAL_ENTITY_BLACKLIST: ReadonlySet<string> = new Set([
     "exact name",
     "exact-name",
   ]);

   export const RETRIEVAL_CONCEPT_BLACKLIST: ReadonlySet<string> = new Set([
     "address book",
   ]);

   const TYPE_SYNONYMS: ReadonlyMap<string, EntityType> = new Map([
     ["person", "person"],
     ["people", "person"],
     ["who", "person"],
     ["org", "org"],
     ["orgs", "org"],
     ["company", "org"],
     ["companies", "org"],
     ["organization", "org"],
     ["book", "book"],
     ["books", "book"],
     ["read", "book"],
     ["tool", "tool"],
     ["tools", "tool"],
     ["project", "project"],
     ["projects", "project"],
     ["article", "article"],
     ["articles", "article"],
     ["place", "place"],
     ["places", "place"],
     ["event", "event"],
     ["events", "event"],
   ]);

   export function detectTypeHint(terms: readonly string[]): EntityType | null {
     for (const t of terms) {
       const hit = TYPE_SYNONYMS.get(t);
       if (hit) return hit;
     }
     return null;
   }

   function unslug(id: string): string {
     return id.replace(/-/g, " ");
   }

   /**
    * Soft re-ranking multiplier applied AFTER RRF.
    * Walks the KB to look up the entity/concept by id (slug match).
    */
   export function qualityMultiplier(id: string, kb: KnowledgeBase): number {
     // Concept ids are prefixed
     if (id.startsWith("concept:")) {
       const name = unslug(id.slice("concept:".length));
       const concept = kb
         .allConcepts()
         .find((c) => c.name.toLowerCase() === name);
       if (!concept) return 1.0;
       let m = 1.0;
       const hasDef = (concept.definition ?? "").trim().length > 0;
       const hasRelated = (concept.related?.length ?? 0) > 0;
       if (hasDef && hasRelated) m *= 1.2;
       if (!hasDef) m *= 0.5;
       return m;
     }

     const name = unslug(id);
     const entity = kb
       .allEntities()
       .find((e) => e.name.toLowerCase() === name);
     if (!entity) return 1.0;

     let m = 1.0;
     if (entity.facts.length >= 3) m *= 1.3;
     if (entity.facts.length === 0) m *= 0.3;
     if (entity.sources.length >= 3) m *= 1.1;

     const allTwitter =
       entity.sources.length > 0 &&
       entity.sources.every((s) => s.toLowerCase().startsWith("twitter/"));
     if (allTwitter) m *= 0.3;

     return m;
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/quality.ts tests/query/quality.test.ts
   git commit -m "feat(query): retrieval blacklist, quality multipliers, type hints"
   ```

---

### Task 14 — query/folder-scope.ts

**Files**
- Create: `src/query/folder-scope.ts`
- Test: `tests/query/folder-scope.test.ts`

**What & why**
Filter a `RetrievedBundle` to only include items whose sources fall under a folder prefix. Empty string = whole vault (no filter).

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { filterBundleByFolder } from "../../src/query/folder-scope.js";
   import type { RetrievedBundle } from "../../src/query/types.js";

   const bundle: RetrievedBundle = {
     question: "q",
     queryType: "entity_lookup",
     entities: [
       { name: "A", type: "person", aliases: [], facts: ["f"], sources: ["Books/A.md"] },
       { name: "B", type: "person", aliases: [], facts: ["f"], sources: ["Other/B.md"] },
     ],
     concepts: [],
     connections: [],
     sources: [
       { path: "Books/A.md", summary: "", mtime: 0, origin: "user-note" },
       { path: "Other/B.md", summary: "", mtime: 0, origin: "user-note" },
     ],
   };

   describe("filterBundleByFolder", () => {
     it("keeps only items inside the folder", () => {
       const filtered = filterBundleByFolder(bundle, "Books");
       expect(filtered.entities.map((e) => e.name)).toEqual(["A"]);
       expect(filtered.sources.map((s) => s.path)).toEqual(["Books/A.md"]);
     });

     it("returns the bundle unchanged when folder is empty", () => {
       const filtered = filterBundleByFolder(bundle, "");
       expect(filtered.entities.length).toBe(2);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { RetrievedBundle } from "./types.js";

   export function filterBundleByFolder(
     bundle: RetrievedBundle,
     folder: string,
   ): RetrievedBundle {
     if (!folder) return bundle;
     const prefix = folder.endsWith("/") ? folder : folder + "/";
     const inFolder = (path: string): boolean =>
       path === folder || path.startsWith(prefix);

     return {
       ...bundle,
       entities: bundle.entities.filter((e) => e.sources.some(inFolder)),
       concepts: bundle.concepts.filter((c) => c.sources.some(inFolder)),
       sources: bundle.sources.filter((s) => inFolder(s.path)),
       // connections kept as-is — they reference entity names, not paths
     };
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/folder-scope.ts tests/query/folder-scope.test.ts
   git commit -m "feat(query): filter retrieved bundle by folder prefix"
   ```

---

### Task 15 — query/retrieve.ts (orchestrator)

**Files**
- Create: `src/query/retrieve.ts`
- Test: `tests/query/retrieve.test.ts`

**What & why**
The orchestrator. Takes a question and a KB, runs all three rankers, fuses with per-query-type weights, applies quality multipliers + type-hint boost, applies folder scope, and returns a `RetrievedBundle`. Embedding ranker is optional — when no embedding index is provided (or query vec is null), only keyword + path are fused.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { retrieve } from "../../src/query/retrieve.js";
   import { KnowledgeBase } from "../../src/core/kb.js";

   function buildSampleKB() {
     const kb = new KnowledgeBase();
     kb.addEntity({
       name: "Alan Watts",
       type: "person",
       aliases: ["Watts"],
       facts: [
         "British philosopher",
         "Wrote The Way of Zen",
         "Lectured on Eastern philosophy",
       ],
       source: "Books/Watts.md",
     });
     kb.addEntity({
       name: "Andrej Karpathy",
       type: "person",
       aliases: [],
       facts: ["AI researcher", "Stanford alum", "Wrote Software 2.0"],
       source: "Learn/Karpathy.md",
     });
     kb.addEntity({
       name: "exact name",
       type: "other",
       aliases: [],
       facts: ["should be hidden"],
       source: "x.md",
     });
     kb.addConcept({
       name: "Zen",
       definition: "A school of Mahayana Buddhism",
       related: ["meditation"],
       source: "Books/Watts.md",
     });
     return kb;
   }

   describe("retrieve", () => {
     it("returns Alan Watts on top for 'who is alan watts'", () => {
       const kb = buildSampleKB();
       const bundle = retrieve({ question: "who is Alan Watts", kb });
       expect(bundle.entities[0]?.name).toBe("Alan Watts");
       expect(bundle.queryType).toBe("entity_lookup");
     });

     it("never returns blacklisted entities", () => {
       const kb = buildSampleKB();
       const bundle = retrieve({ question: "exact name", kb });
       expect(bundle.entities.find((e) => e.name === "exact name")).toBeUndefined();
     });

     it("respects folder scope", () => {
       const kb = buildSampleKB();
       const bundle = retrieve({
         question: "philosopher",
         kb,
         folder: "Learn",
       });
       expect(bundle.entities.find((e) => e.name === "Alan Watts")).toBeUndefined();
     });

     it("accepts an optional dreamScores arg without consuming it", () => {
       const kb = buildSampleKB();
       const bundle = retrieve({
         question: "who is Watts",
         kb,
         dreamScores: new Map([["alan-watts", 99]]),
       });
       // Phase 3 ignores dreamScores; assertion is just that it didn't throw
       expect(bundle.entities.length).toBeGreaterThan(0);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { KnowledgeBase } from "../core/kb.js";
   import { classifyQuery } from "./classify.js";
   import { rankByKeyword } from "./keyword-ranker.js";
   import { rankByPath } from "./path-ranker.js";
   import { rankByEmbedding } from "./embedding-ranker.js";
   import { rrfFuse } from "./rrf.js";
   import {
     RETRIEVAL_CONCEPT_BLACKLIST,
     RETRIEVAL_ENTITY_BLACKLIST,
     detectTypeHint,
     qualityMultiplier,
   } from "./quality.js";
   import { extractQueryTerms } from "./terms.js";
   import { filterBundleByFolder } from "./folder-scope.js";
   import type { QueryType, RankedItem, RetrievedBundle } from "./types.js";

   const QUERY_WEIGHTS: Record<QueryType, [number, number, number]> = {
     entity_lookup: [2.0, 0.5, 0.3],
     list_category: [0.8, 0.8, 1.5],
     relational: [1.0, 1.2, 0.5],
     conceptual: [0.8, 1.5, 0.5],
   };

   const TYPE_HINT_BOOST = 2.5;
   const RRF_K = 60;
   const MAX_ENTITIES = 12;
   const MAX_CONCEPTS = 8;

   export interface RetrieveArgs {
     question: string;
     kb: KnowledgeBase;
     embeddingIndex?: ReadonlyMap<string, number[]>;
     queryEmbedding?: number[] | null;
     folder?: string;
     dreamScores?: ReadonlyMap<string, number>; // reserved for Phase 5
   }

   export function retrieve(args: RetrieveArgs): RetrievedBundle {
     void args.dreamScores; // forward-compat reserved field

     const terms = extractQueryTerms(args.question);
     const queryType = classifyQuery(args.question);
     const [wKeyword, wEmbed, wPath] = QUERY_WEIGHTS[queryType];

     const kwRanked = rankByKeyword(args.kb, terms);
     const pathRanked = rankByPath(args.kb, terms);
     const embedRanked: RankedItem[] =
       args.embeddingIndex && args.queryEmbedding
         ? rankByEmbedding(args.embeddingIndex, args.queryEmbedding)
         : [];

     const fused = rrfFuse(
       [kwRanked, embedRanked, pathRanked],
       [wKeyword, wEmbed, wPath],
       RRF_K,
     );

     const typeHint = detectTypeHint(terms);

     // Apply quality multipliers and type-hint boost
     const adjusted = fused
       .map((item) => {
         let score = item.score * qualityMultiplier(item.id, args.kb);
         if (typeHint && !item.id.startsWith("concept:")) {
           const name = item.id.replace(/-/g, " ");
           const ent = args.kb
             .allEntities()
             .find((e) => e.name.toLowerCase() === name);
           if (ent && ent.type === typeHint) score *= TYPE_HINT_BOOST;
         }
         return { id: item.id, score };
       })
       .sort((a, b) => b.score - a.score);

     // Resolve to entities and concepts, filtering blacklist
     const entities: RetrievedBundle["entities"] = [];
     const concepts: RetrievedBundle["concepts"] = [];
     for (const item of adjusted) {
       if (item.id.startsWith("concept:")) {
         if (concepts.length >= MAX_CONCEPTS) continue;
         const name = item.id.slice("concept:".length).replace(/-/g, " ");
         if (RETRIEVAL_CONCEPT_BLACKLIST.has(name)) continue;
         const c = args.kb
           .allConcepts()
           .find((cc) => cc.name.toLowerCase() === name);
         if (c) concepts.push(c);
       } else {
         if (entities.length >= MAX_ENTITIES) continue;
         const name = item.id.replace(/-/g, " ");
         if (RETRIEVAL_ENTITY_BLACKLIST.has(name)) continue;
         const e = args.kb
           .allEntities()
           .find((ee) => ee.name.toLowerCase() === name);
         if (e) entities.push(e);
       }
     }

     // Gather connections that touch any of our entities
     const entityNames = new Set(entities.map((e) => e.name));
     const connections = args.kb
       .allConnections()
       .filter((c) => entityNames.has(c.from) || entityNames.has(c.to));

     // Gather source records referenced by surviving entities/concepts
     const sourcePaths = new Set<string>();
     for (const e of entities) for (const s of e.sources) sourcePaths.add(s);
     for (const c of concepts) for (const s of c.sources) sourcePaths.add(s);
     const sources = args.kb
       .allSources()
       .filter((s) => sourcePaths.has(s.path));

     const bundle: RetrievedBundle = {
       question: args.question,
       queryType,
       entities,
       concepts,
       connections,
       sources,
     };

     return filterBundleByFolder(bundle, args.folder ?? "");
   }
   ```
   This depends on `kb.allConnections()` and `kb.allSources()` getters. Add them in `src/core/kb.ts` if missing.

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/retrieve.ts tests/query/retrieve.test.ts src/core/kb.ts
   git commit -m "feat(query): orchestrate retrieval with rankers, fusion, and quality"
   ```

---

### Task 16 — query/format-context.ts

**Files**
- Create: `src/query/format-context.ts`
- Test: `tests/query/format-context.test.ts`

**What & why**
Render a `RetrievedBundle` into the markdown context block fed to the LLM. Sections: `## ENTITIES`, `## CONCEPTS`, `## CONNECTIONS`, `## SOURCE FILES`.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { formatContextMarkdown } from "../../src/query/format-context.js";
   import type { RetrievedBundle } from "../../src/query/types.js";

   const bundle: RetrievedBundle = {
     question: "who is Alan Watts",
     queryType: "entity_lookup",
     entities: [
       {
         name: "Alan Watts",
         type: "person",
         aliases: ["Watts"],
         facts: ["British philosopher", "Wrote The Way of Zen"],
         sources: ["Books/Watts.md"],
       },
     ],
     concepts: [
       { name: "Zen", definition: "Mahayana school", related: [], sources: ["Books/Watts.md"] },
     ],
     connections: [
       {
         from: "Alan Watts",
         to: "Zen",
         type: "influences",
         description: "wrote about it",
         sources: ["Books/Watts.md"],
       },
     ],
     sources: [
       { path: "Books/Watts.md", summary: "Notes on Watts", mtime: 0, origin: "user-note" },
     ],
   };

   describe("formatContextMarkdown", () => {
     it("emits all four sections in order", () => {
       const md = formatContextMarkdown(bundle);
       const order = ["## ENTITIES", "## CONCEPTS", "## CONNECTIONS", "## SOURCE FILES"];
       let lastIdx = -1;
       for (const h of order) {
         const idx = md.indexOf(h);
         expect(idx).toBeGreaterThan(lastIdx);
         lastIdx = idx;
       }
     });

     it("includes facts, aliases, and source paths", () => {
       const md = formatContextMarkdown(bundle);
       expect(md).toContain("Alan Watts");
       expect(md).toContain("Watts");
       expect(md).toContain("British philosopher");
       expect(md).toContain("Books/Watts.md");
       expect(md).toContain("Mahayana school");
     });

     it("omits empty sections", () => {
       const md = formatContextMarkdown({
         ...bundle,
         concepts: [],
         connections: [],
       });
       expect(md).not.toContain("## CONCEPTS");
       expect(md).not.toContain("## CONNECTIONS");
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { RetrievedBundle } from "./types.js";

   export function formatContextMarkdown(bundle: RetrievedBundle): string {
     const lines: string[] = [];

     if (bundle.entities.length > 0) {
       lines.push("## ENTITIES");
       for (const e of bundle.entities) {
         lines.push(`### ${e.name} [${e.type}]`);
         if (e.aliases.length > 0) {
           lines.push(`Aliases: ${e.aliases.join(", ")}`);
         }
         if (e.facts.length > 0) {
           lines.push("Facts:");
           for (const f of e.facts) lines.push(`- ${f}`);
         }
         if (e.sources.length > 0) {
           lines.push(`Sources: ${e.sources.join(", ")}`);
         }
         lines.push("");
       }
     }

     if (bundle.concepts.length > 0) {
       lines.push("## CONCEPTS");
       for (const c of bundle.concepts) {
         lines.push(`### ${c.name}`);
         if (c.definition) lines.push(c.definition);
         if (c.related && c.related.length > 0) {
           lines.push(`Related: ${c.related.join(", ")}`);
         }
         if (c.sources.length > 0) {
           lines.push(`Sources: ${c.sources.join(", ")}`);
         }
         lines.push("");
       }
     }

     if (bundle.connections.length > 0) {
       lines.push("## CONNECTIONS");
       for (const c of bundle.connections) {
         lines.push(`- ${c.from} → ${c.to} (${c.type}): ${c.description}`);
       }
       lines.push("");
     }

     if (bundle.sources.length > 0) {
       lines.push("## SOURCE FILES");
       for (const s of bundle.sources) {
         lines.push(`- ${s.path} — ${s.summary}`);
       }
       lines.push("");
     }

     return lines.join("\n");
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/format-context.ts tests/query/format-context.test.ts
   git commit -m "feat(query): format retrieved bundle as markdown context"
   ```

---

## Group E — Prompts and the ask() pipeline

### Task 17 — query/prompts.ts (ASK_PROMPT)

**Files**
- Create: `src/query/prompts.ts`
- Test: `tests/query/prompts.test.ts`

**What & why**
Port the 8-rule `ASK_PROMPT` from `~/tools/llm-wiki/prompts.py` (or `query.py` — wherever it lives). Pure template function `buildAskPrompt({ question, context })`.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { buildAskPrompt } from "../../src/query/prompts.js";

   describe("buildAskPrompt", () => {
     it("includes the question and context block", () => {
       const p = buildAskPrompt({
         question: "who is alan watts",
         context: "## ENTITIES\n### Alan Watts",
       });
       expect(p).toContain("who is alan watts");
       expect(p).toContain("Alan Watts");
     });

     it("contains the 8 numbered rules", () => {
       const p = buildAskPrompt({ question: "x", context: "y" });
       for (let i = 1; i <= 8; i++) {
         expect(p).toMatch(new RegExp(`(^|\\n)${i}\\.`));
       }
     });

     it("instructs the LLM to use only KB data", () => {
       const p = buildAskPrompt({ question: "x", context: "y" });
       expect(p.toLowerCase()).toContain("only");
       expect(p.toLowerCase()).toContain("knowledge");
     });
   });
   ```

2. **Run** — fails.

3. **Impl** (port from Python verbatim, adjust as needed):
   ```ts
   export interface BuildAskPromptArgs {
     question: string;
     context: string;
   }

   const RULES = [
     "Use ONLY information present in the knowledge base context below. Do not invent facts.",
     "If the context does not contain enough to answer, say so plainly — do not speculate.",
     "When the user asks a list question (\"what books\", \"how many\"), be comprehensive: list every matching item from the context.",
     "Prefer the entity's own facts over connection summaries when both are available.",
     "Do not include raw file paths in your prose answer. Sources are tracked separately.",
     "Quote facts exactly when accuracy matters; paraphrase when synthesizing.",
     "If two facts contradict, surface the contradiction rather than picking one.",
     "Be concise. Aim for the shortest answer that fully addresses the question.",
   ];

   export function buildAskPrompt(args: BuildAskPromptArgs): string {
     const rulesBlock = RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
     return [
       "You answer questions using a personal knowledge base.",
       "",
       "Rules:",
       rulesBlock,
       "",
       "Knowledge base context:",
       args.context,
       "",
       `Question: ${args.question}`,
       "",
       "Answer:",
     ].join("\n");
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/prompts.ts tests/query/prompts.test.ts
   git commit -m "feat(query): port ASK_PROMPT with 8 grounding rules"
   ```

---

### Task 18 — query/ask.ts (full pipeline)

**Files**
- Create: `src/query/ask.ts`
- Test: `tests/query/ask.test.ts`

**What & why**
The end-to-end pipeline. Takes a question, runs `retrieve()`, formats context, builds prompt, streams `provider.complete()` chunks. Yields events: `{ kind: "context", bundle }` first, then `{ kind: "chunk", text }` for each token, then `{ kind: "done" }` (or `{ kind: "error", error }`).

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { ask } from "../../src/query/ask.js";
   import { KnowledgeBase } from "../../src/core/kb.js";
   import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

   function buildKB() {
     const kb = new KnowledgeBase();
     kb.addEntity({
       name: "Alan Watts",
       type: "person",
       aliases: ["Watts"],
       facts: ["British philosopher", "Wrote The Way of Zen"],
       source: "Books/Watts.md",
     });
     return kb;
   }

   describe("ask", () => {
     it("yields a context event then chunks then done", async () => {
       const kb = buildKB();
       const provider = new MockLLMProvider({
         responses: ["Alan Watts was a British philosopher."],
         chunked: true,
       });
       const events: Array<{ kind: string; text?: string }> = [];
       for await (const ev of ask({
         question: "who is Alan Watts",
         kb,
         provider,
         model: "test",
       })) {
         events.push({ kind: ev.kind, text: ev.text });
       }
       expect(events[0]?.kind).toBe("context");
       expect(events.some((e) => e.kind === "chunk")).toBe(true);
       expect(events[events.length - 1]?.kind).toBe("done");
       const fullText = events
         .filter((e) => e.kind === "chunk")
         .map((e) => e.text)
         .join("");
       expect(fullText).toContain("Alan Watts");
     });

     it("yields an error event when the provider throws", async () => {
       const kb = buildKB();
       const provider = new MockLLMProvider({
         responses: [],
         errors: [new Error("network down")],
       });
       const events: Array<{ kind: string }> = [];
       for await (const ev of ask({
         question: "who is Alan Watts",
         kb,
         provider,
         model: "test",
       })) {
         events.push({ kind: ev.kind });
       }
       expect(events[events.length - 1]?.kind).toBe("error");
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { KnowledgeBase } from "../core/kb.js";
   import type { LLMProvider } from "../llm/provider.js";
   import { formatContextMarkdown } from "./format-context.js";
   import { buildAskPrompt } from "./prompts.js";
   import { retrieve, type RetrieveArgs } from "./retrieve.js";
   import type { AnswerEvent } from "./types.js";

   export interface AskArgs {
     question: string;
     kb: KnowledgeBase;
     provider: LLMProvider;
     model: string;
     folder?: string;
     embeddingIndex?: ReadonlyMap<string, number[]>;
     queryEmbedding?: number[] | null;
     signal?: AbortSignal;
   }

   export async function* ask(args: AskArgs): AsyncIterable<AnswerEvent> {
     try {
       const retrieveArgs: RetrieveArgs = {
         question: args.question,
         kb: args.kb,
         folder: args.folder,
         embeddingIndex: args.embeddingIndex,
         queryEmbedding: args.queryEmbedding,
       };
       const bundle = retrieve(retrieveArgs);
       yield { kind: "context", bundle };

       const context = formatContextMarkdown(bundle);
       const prompt = buildAskPrompt({ question: args.question, context });

       for await (const chunk of args.provider.complete({
         prompt,
         model: args.model,
         signal: args.signal,
       })) {
         yield { kind: "chunk", text: chunk };
       }
       yield { kind: "done" };
     } catch (err) {
       yield {
         kind: "error",
         error: err instanceof Error ? err.message : String(err),
       };
     }
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/query/ask.ts tests/query/ask.test.ts
   git commit -m "feat(query): end-to-end ask pipeline with streaming events"
   ```

---

## Group F — Vault helpers

### Task 19 — Add safeAppendPluginData to safe-write.ts

**Files**
- Modify: `src/vault/safe-write.ts`
- Test: `tests/vault/safe-write.append.test.ts`

**What & why**
Existing `safeWritePluginData` is overwrite-only. Interaction logs need append. Add a sibling `safeAppendPluginData(app, filename, line)` that:
- Validates the filename against the same allowlist (or just enforces the `.obsidian/plugins/llm-wiki/` prefix)
- Creates the file if absent
- Appends `line` followed by `\n` if line doesn't already end with one

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { safeAppendPluginData } from "../../src/vault/safe-write.js";
   import { createMockApp } from "../helpers/mock-app.js"; // existing Phase 2 helper

   describe("safeAppendPluginData", () => {
     it("creates the file and writes the first line", async () => {
       const { app, files } = createMockApp();
       await safeAppendPluginData(app, "interactions/2026-04-09.jsonl", "{\"a\":1}");
       const path = ".obsidian/plugins/llm-wiki/interactions/2026-04-09.jsonl";
       expect(files.get(path)).toBe("{\"a\":1}\n");
     });

     it("appends to an existing file", async () => {
       const { app, files } = createMockApp();
       const path = ".obsidian/plugins/llm-wiki/interactions/x.jsonl";
       files.set(path, "first\n");
       await safeAppendPluginData(app, "interactions/x.jsonl", "second");
       expect(files.get(path)).toBe("first\nsecond\n");
     });

     it("rejects paths that escape the plugin dir", async () => {
       const { app } = createMockApp();
       await expect(
         safeAppendPluginData(app, "../../etc/passwd", "x"),
       ).rejects.toThrow();
     });
   });
   ```

2. **Run** — fails.

3. **Impl** — add to `src/vault/safe-write.ts`:
   ```ts
   export async function safeAppendPluginData(
     app: App,
     relPath: string,
     line: string,
   ): Promise<void> {
     if (relPath.includes("..") || relPath.startsWith("/")) {
       throw new Error(`safeAppendPluginData: invalid path ${relPath}`);
     }
     const fullPath = `${PLUGIN_DIR}/${relPath}`;
     const text = line.endsWith("\n") ? line : line + "\n";
     const existing = await app.vault.adapter.exists(fullPath);
     if (existing) {
       const prior = await app.vault.adapter.read(fullPath);
       await app.vault.adapter.write(fullPath, prior + text);
     } else {
       // ensure parent dir exists
       const lastSlash = fullPath.lastIndexOf("/");
       if (lastSlash > 0) {
         const dir = fullPath.slice(0, lastSlash);
         if (!(await app.vault.adapter.exists(dir))) {
           await app.vault.adapter.mkdir(dir);
         }
       }
       await app.vault.adapter.write(fullPath, text);
     }
   }
   ```
   The mock-app helper from Phase 2 may need an `exists` / `mkdir` mock. Update `tests/helpers/mock-app.ts` minimally to support the new methods if missing.

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/vault/safe-write.ts tests/vault/safe-write.append.test.ts \
           tests/helpers/mock-app.ts
   git commit -m "feat(vault): add safeAppendPluginData for JSONL logs"
   ```

---

### Task 20 — vault/interaction-log.ts

**Files**
- Create: `src/vault/interaction-log.ts`
- Test: `tests/vault/interaction-log.test.ts`

**What & why**
High-level wrapper: takes a structured `InteractionLogEntry` and appends it as a JSON line to today's log file. Uses an injectable clock for testability.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { appendInteractionLog } from "../../src/vault/interaction-log.js";
   import { createMockApp } from "../helpers/mock-app.js";

   describe("appendInteractionLog", () => {
     it("appends a JSON line to today's log file", async () => {
       const { app, files } = createMockApp();
       const now = () => new Date("2026-04-09T12:00:00Z");
       await appendInteractionLog(app, {
         question: "q",
         answer: "a",
         model: "m",
         queryType: "entity_lookup",
         entityCount: 1,
         conceptCount: 0,
         elapsedMs: 100,
       }, now);
       const path = ".obsidian/plugins/llm-wiki/interactions/2026-04-09.jsonl";
       const content = files.get(path)!;
       expect(content).toMatch(/\n$/);
       const parsed = JSON.parse(content.trim());
       expect(parsed.question).toBe("q");
       expect(parsed.timestamp).toBe("2026-04-09T12:00:00.000Z");
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { App } from "obsidian";
   import { safeAppendPluginData } from "./safe-write.js";

   export interface InteractionLogEntry {
     question: string;
     answer: string;
     model: string;
     queryType: string;
     entityCount: number;
     conceptCount: number;
     elapsedMs: number;
   }

   export async function appendInteractionLog(
     app: App,
     entry: InteractionLogEntry,
     now: () => Date = () => new Date(),
   ): Promise<void> {
     const ts = now();
     const dateStr = ts.toISOString().slice(0, 10);
     const line = JSON.stringify({ ...entry, timestamp: ts.toISOString() });
     await safeAppendPluginData(app, `interactions/${dateStr}.jsonl`, line);
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/vault/interaction-log.ts tests/vault/interaction-log.test.ts
   git commit -m "feat(vault): append structured interaction log entries as JSONL"
   ```

---

### Task 21 — vault/recent-questions.ts

**Files**
- Create: `src/vault/recent-questions.ts`
- Test: `tests/vault/recent-questions.test.ts`

**What & why**
Ring buffer of last N questions persisted to a plain JSON file. Used by the modal's input history (↑/↓ arrows). Pure functions + a small load/save pair.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     pushRecentQuestion,
     loadRecentQuestions,
     saveRecentQuestions,
   } from "../../src/vault/recent-questions.js";
   import { createMockApp } from "../helpers/mock-app.js";

   describe("recent-questions", () => {
     it("pushes and trims to N", () => {
       const list: string[] = [];
       const next = pushRecentQuestion(list, "first", 3);
       const next2 = pushRecentQuestion(next, "second", 3);
       const next3 = pushRecentQuestion(next2, "third", 3);
       const next4 = pushRecentQuestion(next3, "fourth", 3);
       expect(next4).toEqual(["fourth", "third", "second"]);
     });

     it("dedupes by promoting an existing question to the front", () => {
       const list = ["c", "b", "a"];
       expect(pushRecentQuestion(list, "b", 5)).toEqual(["b", "c", "a"]);
     });

     it("round-trips via load/save", async () => {
       const { app } = createMockApp();
       await saveRecentQuestions(app, ["q1", "q2"]);
       expect(await loadRecentQuestions(app)).toEqual(["q1", "q2"]);
     });

     it("returns empty list when file does not exist", async () => {
       const { app } = createMockApp();
       expect(await loadRecentQuestions(app)).toEqual([]);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { App } from "obsidian";
   import { safeWritePluginData } from "./safe-write.js";

   const FILE = "recent-questions.json";
   const FULL = `.obsidian/plugins/llm-wiki/${FILE}`;

   export function pushRecentQuestion(
     list: readonly string[],
     question: string,
     max: number,
   ): string[] {
     const without = list.filter((q) => q !== question);
     return [question, ...without].slice(0, max);
   }

   export async function loadRecentQuestions(app: App): Promise<string[]> {
     if (!(await app.vault.adapter.exists(FULL))) return [];
     try {
       const raw = await app.vault.adapter.read(FULL);
       const parsed = JSON.parse(raw) as unknown;
       if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
         return parsed as string[];
       }
       return [];
     } catch {
       return [];
     }
   }

   export async function saveRecentQuestions(
     app: App,
     questions: readonly string[],
   ): Promise<void> {
     await safeWritePluginData(app, FILE, JSON.stringify(questions, null, 2));
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/vault/recent-questions.ts tests/vault/recent-questions.test.ts
   git commit -m "feat(vault): persist ring buffer of recent questions"
   ```

---

### Task 22 — Embeddings cache wiring (load on startup, save after build)

**Files**
- Modify: `src/vault/plugin-data.ts` (verify load/save embeddings cache helpers exist; if not, add them)
- Test: `tests/vault/plugin-data.embeddings.test.ts`

**What & why**
Phase 2 stubbed `loadEmbeddingsCache` / `saveEmbeddingsCache`. Phase 3 actually exercises them. Verify the round-trip works and that an empty/missing file produces a fresh `{ vaultId, entries: {} }`.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     loadEmbeddingsCache,
     saveEmbeddingsCache,
   } from "../../src/vault/plugin-data.js";
   import { createMockApp } from "../helpers/mock-app.js";

   describe("embeddings cache", () => {
     it("returns a fresh cache when file is missing", async () => {
       const { app } = createMockApp();
       const c = await loadEmbeddingsCache(app);
       expect(c.entries).toEqual({});
     });

     it("round-trips via save/load", async () => {
       const { app } = createMockApp();
       await saveEmbeddingsCache(app, {
         vaultId: "v1",
         entries: {
           "alan-watts": { sourceText: "x", vector: [1, 2, 3] },
         },
       });
       const c = await loadEmbeddingsCache(app);
       expect(c.entries["alan-watts"]?.vector).toEqual([1, 2, 3]);
     });
   });
   ```

2. **Run** — should already pass if Phase 2 stubs are correct. If they fail, fix the stubs to match the test.

3. **Commit (only if changes made):**
   ```bash
   git add src/vault/plugin-data.ts tests/vault/plugin-data.embeddings.test.ts
   git commit -m "test(vault): cover embeddings cache load/save round trip"
   ```

---

## Group G — UI render helpers (pure)

### Task 23 — ui/modal/answer-renderer.ts

**Files**
- Create: `src/ui/modal/answer-renderer.ts`
- Test: `tests/ui/modal/answer-renderer.test.ts`

**What & why**
Debounced markdown render. Defines a `RenderTarget` interface with a `setMarkdown(md: string)` method. The renderer accumulates streamed chunks and calls `setMarkdown` at most every N milliseconds. Pure logic — no DOM. Mirrors the `status-bar.ts` `Pick<HTMLElement, "setText">` pattern.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect, vi } from "vitest";
   import { AnswerRenderer } from "../../../src/ui/modal/answer-renderer.js";

   function fakeTarget() {
     const calls: string[] = [];
     return {
       target: { setMarkdown: (md: string) => calls.push(md) },
       calls,
     };
   }

   describe("AnswerRenderer", () => {
     it("renders accumulated chunks on flush()", () => {
       const { target, calls } = fakeTarget();
       const r = new AnswerRenderer(target, { debounceMs: 0 });
       r.append("Hello ");
       r.append("world");
       r.flush();
       expect(calls[calls.length - 1]).toBe("Hello world");
     });

     it("debounces rapid appends", () => {
       vi.useFakeTimers();
       const { target, calls } = fakeTarget();
       const r = new AnswerRenderer(target, { debounceMs: 50 });
       r.append("a");
       r.append("b");
       r.append("c");
       expect(calls.length).toBe(0);
       vi.advanceTimersByTime(60);
       expect(calls.length).toBe(1);
       expect(calls[0]).toBe("abc");
       vi.useRealTimers();
     });

     it("reset() clears accumulated text", () => {
       const { target, calls } = fakeTarget();
       const r = new AnswerRenderer(target, { debounceMs: 0 });
       r.append("first");
       r.flush();
       r.reset();
       r.append("second");
       r.flush();
       expect(calls[calls.length - 1]).toBe("second");
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   export interface RenderTarget {
     setMarkdown(md: string): void;
   }

   export interface AnswerRendererOptions {
     debounceMs: number;
   }

   export class AnswerRenderer {
     private buffer = "";
     private timer: ReturnType<typeof setTimeout> | null = null;

     constructor(
       private readonly target: RenderTarget,
       private readonly opts: AnswerRendererOptions,
     ) {}

     append(chunk: string): void {
       this.buffer += chunk;
       if (this.opts.debounceMs <= 0) {
         this.flush();
         return;
       }
       if (this.timer !== null) return;
       this.timer = setTimeout(() => this.flush(), this.opts.debounceMs);
     }

     flush(): void {
       if (this.timer !== null) {
         clearTimeout(this.timer);
         this.timer = null;
       }
       this.target.setMarkdown(this.buffer);
     }

     reset(): void {
       if (this.timer !== null) {
         clearTimeout(this.timer);
         this.timer = null;
       }
       this.buffer = "";
     }
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/ui/modal/answer-renderer.ts tests/ui/modal/answer-renderer.test.ts
   git commit -m "feat(ui): debounced markdown answer renderer"
   ```

---

### Task 24 — ui/modal/query-controller.ts

**Files**
- Create: `src/ui/modal/query-controller.ts`
- Test: `tests/ui/modal/query-controller.test.ts`

**What & why**
Pure state machine that owns the query lifecycle:
- `idle` → `loading` → `streaming` → `done | error | cancelled`
- Owns the AbortController
- Calls injected callbacks: `onState(state)`, `onChunk(text)`, `onContext(bundle)`
- Drives `ask()` from `query/ask.ts`

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect, vi } from "vitest";
   import { QueryController } from "../../../src/ui/modal/query-controller.js";
   import { KnowledgeBase } from "../../../src/core/kb.js";
   import { MockLLMProvider } from "../../helpers/mock-llm-provider.js";
   import type { QueryControllerState } from "../../../src/ui/modal/query-controller.js";

   function buildKB() {
     const kb = new KnowledgeBase();
     kb.addEntity({
       name: "Alan Watts",
       type: "person",
       aliases: [],
       facts: ["philosopher"],
       source: "x.md",
     });
     return kb;
   }

   describe("QueryController", () => {
     it("transitions idle → loading → streaming → done", async () => {
       const kb = buildKB();
       const provider = new MockLLMProvider({
         responses: ["answer text"],
         chunked: true,
       });
       const states: QueryControllerState[] = [];
       const chunks: string[] = [];
       const ctrl = new QueryController({
         kb,
         provider,
         model: "test",
         onState: (s) => states.push(s),
         onChunk: (t) => chunks.push(t),
         onContext: () => {},
       });
       await ctrl.run("who is Alan Watts");
       expect(states).toEqual(["loading", "streaming", "done"]);
       expect(chunks.join("")).toContain("answer");
     });

     it("transitions to error when provider throws", async () => {
       const kb = buildKB();
       const provider = new MockLLMProvider({
         responses: [],
         errors: [new Error("oops")],
       });
       const states: QueryControllerState[] = [];
       const ctrl = new QueryController({
         kb,
         provider,
         model: "test",
         onState: (s) => states.push(s),
         onChunk: () => {},
         onContext: () => {},
       });
       await ctrl.run("q");
       expect(states[states.length - 1]).toBe("error");
     });

     it("cancel() aborts the in-flight request", async () => {
       const kb = buildKB();
       const provider = new MockLLMProvider({
         responses: ["very long answer"],
         chunked: true,
         chunkDelayMs: 50,
       });
       const states: QueryControllerState[] = [];
       const ctrl = new QueryController({
         kb,
         provider,
         model: "test",
         onState: (s) => states.push(s),
         onChunk: () => {},
         onContext: () => {},
       });
       const p = ctrl.run("q");
       await new Promise((r) => setTimeout(r, 10));
       ctrl.cancel();
       await p;
       expect(states).toContain("cancelled");
     });
   });
   ```
   Note: `MockLLMProvider` may need a `chunkDelayMs` option. Add it in this task if missing.

2. **Run** — fails.

3. **Impl:**
   ```ts
   import type { KnowledgeBase } from "../../core/kb.js";
   import { ask } from "../../query/ask.js";
   import type { LLMProvider } from "../../llm/provider.js";
   import type { RetrievedBundle } from "../../query/types.js";

   export type QueryControllerState =
     | "idle"
     | "loading"
     | "streaming"
     | "done"
     | "error"
     | "cancelled";

   export interface QueryControllerOptions {
     kb: KnowledgeBase;
     provider: LLMProvider;
     model: string;
     folder?: string;
     embeddingIndex?: ReadonlyMap<string, number[]>;
     queryEmbedding?: number[] | null;
     onState: (s: QueryControllerState) => void;
     onContext: (bundle: RetrievedBundle) => void;
     onChunk: (text: string) => void;
     onError?: (msg: string) => void;
   }

   export class QueryController {
     private state: QueryControllerState = "idle";
     private abortCtrl: AbortController | null = null;

     constructor(private readonly opts: QueryControllerOptions) {}

     getState(): QueryControllerState {
       return this.state;
     }

     async run(question: string): Promise<void> {
       this.abortCtrl = new AbortController();
       this.transition("loading");

       try {
         for await (const ev of ask({
           question,
           kb: this.opts.kb,
           provider: this.opts.provider,
           model: this.opts.model,
           folder: this.opts.folder,
           embeddingIndex: this.opts.embeddingIndex,
           queryEmbedding: this.opts.queryEmbedding,
           signal: this.abortCtrl.signal,
         })) {
           if (this.state === "cancelled") return;
           if (ev.kind === "context" && ev.bundle) {
             this.opts.onContext(ev.bundle);
             this.transition("streaming");
           } else if (ev.kind === "chunk" && ev.text) {
             this.opts.onChunk(ev.text);
           } else if (ev.kind === "done") {
             this.transition("done");
           } else if (ev.kind === "error") {
             this.opts.onError?.(ev.error ?? "unknown error");
             this.transition("error");
           }
         }
       } catch (err) {
         if (this.state !== "cancelled") {
           this.opts.onError?.(err instanceof Error ? err.message : String(err));
           this.transition("error");
         }
       }
     }

     cancel(): void {
       if (this.abortCtrl) this.abortCtrl.abort();
       this.transition("cancelled");
     }

     private transition(next: QueryControllerState): void {
       this.state = next;
       this.opts.onState(next);
     }
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/ui/modal/query-controller.ts tests/ui/modal/query-controller.test.ts \
           tests/helpers/mock-llm-provider.ts
   git commit -m "feat(ui): query controller state machine with cancellation"
   ```

---

## Group H — UI modal and settings

### Task 25 — ui/modal/query-modal.ts (Obsidian Modal shell)

**Files**
- Create: `src/ui/modal/query-modal.ts`
- Test: none (DOM-bound — verified manually + by integration test in Task 28)

**What & why**
Thin Obsidian `Modal` subclass. Builds the DOM scaffolding per Section 7.1 of the spec:
- Top: text input with placeholder "Ask your knowledge base…"
- Pills row: model selector pill, folder selector pill
- Body: answer area (rendered by `AnswerRenderer`)
- Collapsible: "Sources used (N)" section
- Collapsible (only if Advanced toggle on): "Context (debug)"
- Footer action row: [↻ Re-ask] [⤴ Open as note] [✕ Close]
- Wires `QueryController` + `AnswerRenderer`
- Handles Enter to submit, Esc to cancel/close, Up/Down arrows for recent questions

**Impl** — write directly:
```ts
import {
  App,
  Modal,
  Setting,
  MarkdownRenderer,
  Component,
  Notice,
} from "obsidian";
import type { KnowledgeBase } from "../../core/kb.js";
import type { LLMProvider } from "../../llm/provider.js";
import { QueryController } from "./query-controller.js";
import { AnswerRenderer, type RenderTarget } from "./answer-renderer.js";
import type { RetrievedBundle } from "../../query/types.js";

export interface QueryModalArgs {
  app: App;
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folder: string;
  recentQuestions: readonly string[];
  onAnswered: (entry: {
    question: string;
    answer: string;
    bundle: RetrievedBundle;
    elapsedMs: number;
  }) => void;
  embeddingIndex?: ReadonlyMap<string, number[]>;
  queryEmbedding?: number[] | null;
}

export class QueryModal extends Modal {
  private inputEl!: HTMLInputElement;
  private answerEl!: HTMLDivElement;
  private sourcesEl!: HTMLDetailsElement;
  private statusEl!: HTMLDivElement;
  private renderer!: AnswerRenderer;
  private controller!: QueryController;
  private currentAnswer = "";
  private currentBundle: RetrievedBundle | null = null;
  private startMs = 0;
  private recentIdx = -1;
  private readonly mdComponent = new Component();

  constructor(private readonly args: QueryModalArgs) {
    super(args.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-wiki-query-modal");

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "Ask your knowledge base…",
      cls: "llm-wiki-query-input",
    });
    this.inputEl.focus();

    const pills = contentEl.createDiv({ cls: "llm-wiki-query-pills" });
    pills.createSpan({ text: `model: ${this.args.model}` });
    pills.createSpan({
      text: `folder: ${this.args.folder || "(whole vault)"}`,
    });

    this.answerEl = contentEl.createDiv({ cls: "llm-wiki-query-answer" });

    this.sourcesEl = contentEl.createEl("details", {
      cls: "llm-wiki-query-sources",
    });
    this.sourcesEl.createEl("summary", { text: "Sources used (0)" });

    this.statusEl = contentEl.createDiv({ cls: "llm-wiki-query-status" });

    const actions = contentEl.createDiv({ cls: "llm-wiki-query-actions" });
    actions.createEl("button", { text: "↻ Re-ask" }).onclick = () => {
      if (this.inputEl.value.trim()) this.submit();
    };
    actions.createEl("button", { text: "✕ Close" }).onclick = () => this.close();

    const renderTarget: RenderTarget = {
      setMarkdown: (md) => {
        this.answerEl.empty();
        void MarkdownRenderer.render(
          this.app,
          md,
          this.answerEl,
          "",
          this.mdComponent,
        );
      },
    };
    this.renderer = new AnswerRenderer(renderTarget, { debounceMs: 50 });

    this.controller = new QueryController({
      kb: this.args.kb,
      provider: this.args.provider,
      model: this.args.model,
      folder: this.args.folder,
      embeddingIndex: this.args.embeddingIndex,
      queryEmbedding: this.args.queryEmbedding,
      onState: (s) => {
        this.statusEl.setText(s);
        if (s === "done" && this.currentBundle) {
          this.args.onAnswered({
            question: this.inputEl.value,
            answer: this.currentAnswer,
            bundle: this.currentBundle,
            elapsedMs: Date.now() - this.startMs,
          });
        }
      },
      onContext: (bundle) => {
        this.currentBundle = bundle;
        this.sourcesEl.querySelector("summary")!.setText(
          `Sources used (${bundle.sources.length})`,
        );
        const list = this.sourcesEl.createEl("ul");
        for (const s of bundle.sources) {
          list.createEl("li", { text: s.path });
        }
      },
      onChunk: (t) => {
        this.currentAnswer += t;
        this.renderer.append(t);
      },
      onError: (msg) => {
        new Notice(`Query failed: ${msg}`);
      },
    });

    this.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (this.recentIdx + 1 < this.args.recentQuestions.length) {
          this.recentIdx++;
          this.inputEl.value = this.args.recentQuestions[this.recentIdx]!;
        }
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (this.recentIdx > 0) {
          this.recentIdx--;
          this.inputEl.value = this.args.recentQuestions[this.recentIdx]!;
        }
      }
    });
  }

  private submit(): void {
    const q = this.inputEl.value.trim();
    if (!q) return;
    this.currentAnswer = "";
    this.currentBundle = null;
    this.renderer.reset();
    this.answerEl.empty();
    this.sourcesEl.querySelector("ul")?.remove();
    this.startMs = Date.now();
    void this.controller.run(q);
  }

  onClose(): void {
    this.controller.cancel();
    this.renderer.flush();
    this.mdComponent.unload();
    this.contentEl.empty();
  }
}
```

**Run** `npm run typecheck && npm run lint` — must pass.

**Commit:**
```bash
git add src/ui/modal/query-modal.ts
git commit -m "feat(ui): query modal shell with streaming answer and sources"
```

---

### Task 26 — ui/settings/query-section.ts

**Files**
- Create: `src/ui/settings/query-section.ts`
- Test: `tests/ui/settings/query-section.test.ts` (pure helper test only)

**What & why**
Renders the Query subsection of the settings tab. Per spec Section 7.2:
- Default model dropdown (text input — Phase 5 makes it a curated picker)
- Embedding model text input
- Default folder text input
- Recent questions count (number)
- Show source links toggle

Follows the same Phase 2 settings-section pattern: pure builder function `buildQuerySection({ container, settings, onChange })`. Tests cover the change handler logic.

**TDD**

1. **Failing test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { applyQuerySettingsPatch } from "../../../src/ui/settings/query-section.js";

   describe("applyQuerySettingsPatch", () => {
     it("merges patch into existing settings", () => {
       const before = {
         embeddingModel: "old",
         defaultQueryFolder: "",
         recentQuestionCount: 5,
         showSourceLinks: true,
       };
       const after = applyQuerySettingsPatch(before, {
         embeddingModel: "new",
       });
       expect(after.embeddingModel).toBe("new");
       expect(after.recentQuestionCount).toBe(5);
     });

     it("clamps recentQuestionCount to [0, 50]", () => {
       const before = {
         embeddingModel: "x",
         defaultQueryFolder: "",
         recentQuestionCount: 5,
         showSourceLinks: true,
       };
       expect(
         applyQuerySettingsPatch(before, { recentQuestionCount: -3 })
           .recentQuestionCount,
       ).toBe(0);
       expect(
         applyQuerySettingsPatch(before, { recentQuestionCount: 9999 })
           .recentQuestionCount,
       ).toBe(50);
     });
   });
   ```

2. **Run** — fails.

3. **Impl:**
   ```ts
   import { Setting } from "obsidian";

   export interface QuerySettings {
     embeddingModel: string;
     defaultQueryFolder: string;
     recentQuestionCount: number;
     showSourceLinks: boolean;
   }

   export function applyQuerySettingsPatch(
     prev: QuerySettings,
     patch: Partial<QuerySettings>,
   ): QuerySettings {
     const merged = { ...prev, ...patch };
     merged.recentQuestionCount = Math.max(
       0,
       Math.min(50, merged.recentQuestionCount),
     );
     return merged;
   }

   export interface BuildQuerySectionArgs {
     container: HTMLElement;
     settings: QuerySettings;
     onChange: (patch: Partial<QuerySettings>) => void | Promise<void>;
   }

   export function buildQuerySection(args: BuildQuerySectionArgs): void {
     args.container.createEl("h3", { text: "Query" });

     new Setting(args.container)
       .setName("Embedding model")
       .setDesc("Ollama model used to vectorize entities and questions")
       .addText((t) =>
         t.setValue(args.settings.embeddingModel).onChange((v) => {
           void args.onChange({ embeddingModel: v.trim() });
         }),
       );

     new Setting(args.container)
       .setName("Default folder")
       .setDesc("Restrict queries to this vault folder (empty = whole vault)")
       .addText((t) =>
         t.setValue(args.settings.defaultQueryFolder).onChange((v) => {
           void args.onChange({ defaultQueryFolder: v.trim() });
         }),
       );

     new Setting(args.container)
       .setName("Recent questions to remember")
       .addText((t) =>
         t
           .setValue(String(args.settings.recentQuestionCount))
           .onChange((v) => {
             const n = Number.parseInt(v, 10);
             if (!Number.isNaN(n)) {
               void args.onChange({ recentQuestionCount: n });
             }
           }),
       );

     new Setting(args.container)
       .setName("Show source links in answer")
       .addToggle((t) =>
         t.setValue(args.settings.showSourceLinks).onChange((v) => {
           void args.onChange({ showSourceLinks: v });
         }),
       );
   }
   ```

4. **Run** — pass.

5. **Commit:**
   ```bash
   git add src/ui/settings/query-section.ts tests/ui/settings/query-section.test.ts
   git commit -m "feat(ui): add Query subsection to settings tab"
   ```

---

### Task 27 — Wire query-section into settings-tab.ts

**Files**
- Modify: `src/ui/settings/settings-tab.ts`
- Test: existing settings-tab tests (extend if needed)

**What & why**
Call `buildQuerySection` from inside `display()`, passing the current settings and a save callback that persists via `plugin.saveSettings()`.

**Impl** — add to `display()` after the existing extraction section:
```ts
import { buildQuerySection } from "./query-section.js";

// inside display():
buildQuerySection({
  container: containerEl,
  settings: {
    embeddingModel: this.plugin.settings.embeddingModel,
    defaultQueryFolder: this.plugin.settings.defaultQueryFolder,
    recentQuestionCount: this.plugin.settings.recentQuestionCount,
    showSourceLinks: this.plugin.settings.showSourceLinks,
  },
  onChange: async (patch) => {
    Object.assign(this.plugin.settings, patch);
    await this.plugin.saveSettings();
  },
});
```

**Run** `npm run typecheck && npm run lint && npm test` — all green.

**Commit:**
```bash
git add src/ui/settings/settings-tab.ts
git commit -m "chore(ui): mount Query section in settings tab"
```

---

## Group I — Plugin wiring, integration test, merge

### Task 28 — Wire plugin.ts (settings, ribbon, hotkey, command)

**Files**
- Modify: `src/plugin.ts`
- Test: extend existing `tests/plugin.test.ts` if present, otherwise add a focused test for the openQueryModal helper

**What & why**
Final wiring step. The plugin must:
1. Extend `LlmWikiPluginSettings` with the new fields (`embeddingModel`, `defaultQueryFolder`, `recentQuestionCount`, `showSourceLinks`)
2. Provide defaults so Phase 2 users upgrade cleanly
3. Load `recentQuestions` on startup, save after each query
4. Lazy-load and cache the embedding index on first query (so plugin startup stays fast)
5. Register a ribbon icon (`addRibbonIcon("search", "Ask knowledge base", ...)`)
6. Register a command `llm-wiki:run-query` with hotkey `Mod+Shift+K`
7. Provide an `openQueryModal()` helper that constructs and opens the modal

**Impl outline** — apply to `src/plugin.ts`:

1. Extend the settings interface and DEFAULT_SETTINGS:
   ```ts
   export interface LlmWikiPluginSettings {
     // existing fields...
     embeddingModel: string;
     defaultQueryFolder: string;
     recentQuestionCount: number;
     showSourceLinks: boolean;
   }

   const DEFAULT_SETTINGS: LlmWikiPluginSettings = {
     // existing defaults...
     embeddingModel: "nomic-embed-text",
     defaultQueryFolder: "",
     recentQuestionCount: 5,
     showSourceLinks: true,
   };
   ```

2. Add fields to the plugin class:
   ```ts
   private recentQuestions: string[] = [];
   private embeddingIndex: Map<string, number[]> | null = null;
   private embeddingsCache: EmbeddingsCache | null = null;
   ```

3. In `onload()`, after loading KB and settings:
   ```ts
   this.recentQuestions = await loadRecentQuestions(this.app);

   this.addRibbonIcon("search", "Ask knowledge base", () => {
     void this.openQueryModal();
   });

   this.addCommand({
     id: "run-query",
     name: "Ask knowledge base",
     hotkeys: [{ modifiers: ["Mod", "Shift"], key: "k" }],
     callback: () => {
       void this.openQueryModal();
     },
   });
   ```

4. Add the `openQueryModal` method:
   ```ts
   private async openQueryModal(): Promise<void> {
     if (!this.kb) {
       new Notice("Knowledge base not loaded yet");
       return;
     }
     // Lazy-build the embedding index on first query
     if (!this.embeddingIndex) {
       try {
         this.embeddingsCache =
           this.embeddingsCache ?? (await loadEmbeddingsCache(this.app));
         this.embeddingIndex = await buildEmbeddingIndex({
           kb: this.kb,
           provider: this.provider,
           model: this.settings.embeddingModel,
           cache: this.embeddingsCache,
         });
         await saveEmbeddingsCache(this.app, this.embeddingsCache);
       } catch (err) {
         new Notice(
           `Failed to build embedding index: ${err instanceof Error ? err.message : String(err)} — falling back to keyword-only retrieval`,
         );
         this.embeddingIndex = new Map();
       }
     }

     // Compute the query embedding for *this* question lazily inside the modal flow
     // For Phase 3 simplicity: pass the index, leave queryEmbedding undefined
     // (embedding ranker will be skipped). Phase 5 will add per-query embedding.

     const modal = new QueryModal({
       app: this.app,
       kb: this.kb,
       provider: this.provider,
       model: this.settings.ollamaModel,
       folder: this.settings.defaultQueryFolder,
       recentQuestions: this.recentQuestions,
       embeddingIndex: this.embeddingIndex,
       onAnswered: async ({ question, answer, bundle, elapsedMs }) => {
         this.recentQuestions = pushRecentQuestion(
           this.recentQuestions,
           question,
           this.settings.recentQuestionCount,
         );
         await saveRecentQuestions(this.app, this.recentQuestions);
         await appendInteractionLog(this.app, {
           question,
           answer,
           model: this.settings.ollamaModel,
           queryType: bundle.queryType,
           entityCount: bundle.entities.length,
           conceptCount: bundle.concepts.length,
           elapsedMs,
         });
       },
     });
     modal.open();
   }
   ```

   Wait — there's a design tension here. The modal-onAnswered approach needs the *user's actual* question (which the modal owns) to compute its embedding. For Phase 3 simplicity we are deferring per-query embeddings: the embedding *index* is built (so future per-query embedding is cheap), but the embedding ranker contribution is zero this phase. This is consistent with Locked-In Decision #4 leaving room for Phase 5.

   **Alternative:** push the per-query embedding into the modal itself by passing a `provider + embeddingModel` and computing it just before `controller.run()`. This is cleaner. **Use this alternative**: extend `QueryModalArgs` with `embeddingProvider` and `embeddingModel`, compute the query vector inside `submit()` before `controller.run()`. Update Task 25 accordingly when implementing.

5. **Run** `npm run typecheck && npm run lint && npm test` — all green.

6. **Commit:**
   ```bash
   git add src/plugin.ts
   git commit -m "feat(plugin): wire query modal, ribbon icon, hotkey, and persistence"
   ```

---

### Task 29 — Integration test against sample KB

**Files**
- Create: `tests/integration/phase3-query.test.ts`
- Test fixture: reuse `tests/fixtures/sample-kb.json`

**What & why**
End-to-end smoke test that exercises retrieve → format → ask against the real Phase 2 KB fixture with a `MockLLMProvider`. Catches regressions in any of the rankers, fusion, blacklist, or ask pipeline.

**TDD**

1. **Write the test:**
   ```ts
   import { describe, it, expect } from "vitest";
   import { readFileSync } from "fs";
   import { fileURLToPath } from "url";
   import { resolve, dirname } from "path";
   import { KnowledgeBase } from "../../src/core/kb.js";
   import type { KBData } from "../../src/core/types.js";
   import { ask } from "../../src/query/ask.js";
   import { retrieve } from "../../src/query/retrieve.js";
   import { MockLLMProvider } from "../helpers/mock-llm-provider.js";

   const __dirname = dirname(fileURLToPath(import.meta.url));
   const fixturePath = resolve(__dirname, "../fixtures/sample-kb.json");

   function loadFixture(): KnowledgeBase {
     const json = JSON.parse(readFileSync(fixturePath, "utf-8")) as KBData;
     return KnowledgeBase.fromData(json);
   }

   describe("Phase 3 integration", () => {
     it("retrieves Alan Watts as the top entity for 'who is alan watts'", () => {
       const kb = loadFixture();
       const bundle = retrieve({ question: "who is Alan Watts", kb });
       expect(bundle.entities[0]?.name.toLowerCase()).toContain("alan");
     });

     it("never returns the blacklisted 'exact name' entity", () => {
       const kb = loadFixture();
       const bundle = retrieve({ question: "exact name", kb });
       expect(
         bundle.entities.find((e) => e.name.toLowerCase() === "exact name"),
       ).toBeUndefined();
     });

     it("returns Karpathy for the books-question even with type hint", () => {
       // sanity-check that type hint boost doesn't crowd out other strong signals
       const kb = loadFixture();
       const bundle = retrieve({ question: "what books did Watts write", kb });
       expect(bundle.queryType).toBe("list_category");
       expect(bundle.entities.length).toBeGreaterThan(0);
     });

     it("ask() yields context, chunks, and done", async () => {
       const kb = loadFixture();
       const provider = new MockLLMProvider({
         responses: ["Alan Watts was a British philosopher who wrote The Way of Zen."],
         chunked: true,
       });
       const events: Array<{ kind: string; text?: string }> = [];
       for await (const ev of ask({
         question: "who is Alan Watts",
         kb,
         provider,
         model: "test",
       })) {
         events.push({ kind: ev.kind, text: ev.text });
       }
       expect(events[0]?.kind).toBe("context");
       expect(events.some((e) => e.kind === "chunk")).toBe(true);
       expect(events[events.length - 1]?.kind).toBe("done");
     });

     it("respects folder scope on the real fixture", () => {
       const kb = loadFixture();
       const all = retrieve({ question: "philosopher", kb });
       const scoped = retrieve({ question: "philosopher", kb, folder: "Books" });
       // Scoped result must be a subset of unscoped
       expect(scoped.entities.length).toBeLessThanOrEqual(all.entities.length);
       for (const e of scoped.entities) {
         expect(e.sources.some((s) => s.startsWith("Books/"))).toBe(true);
       }
     });
   });
   ```

2. **Run** `npx vitest run tests/integration/phase3-query.test.ts` — all should pass on first run if Tasks 1-28 are correct. If any fail, fix the underlying module rather than the test.

3. **Commit:**
   ```bash
   git add tests/integration/phase3-query.test.ts
   git commit -m "test(integration): phase 3 quality regression against sample KB"
   ```

---

### Task 30 — Manual smoke checklist + README + merge

**Files**
- Create: `docs/superpowers/runbooks/2026-04-09-phase-3-smoke.md` (manual smoke checklist)
- Modify: `README.md` — add Phase 3 section
- No new code

**What & why**
Final wrap. The manual smoke checklist documents what to test in a real Obsidian session before merging. README gets a Phase 3 user-facing section so users know about the hotkey and modal.

**Smoke checklist content** (`docs/superpowers/runbooks/2026-04-09-phase-3-smoke.md`):
```markdown
# Phase 3 Manual Smoke Checklist

Run against the test vault `/Users/dominiqueleca/tools/llm-wiki-test-vault` after `npm run build` and reloading Obsidian.

- [ ] Cmd+Shift+K opens the query modal with focused input
- [ ] Ribbon icon (search) opens the same modal
- [ ] Typing a question and pressing Enter starts streaming an answer
- [ ] Sources collapsible shows the correct count and expands to a list
- [ ] Esc cancels an in-flight query and closes the modal
- [ ] Up/Down arrows cycle through recent questions
- [ ] Settings tab shows the new Query section
- [ ] Changing default folder restricts subsequent queries
- [ ] `.obsidian/plugins/llm-wiki/interactions/YYYY-MM-DD.jsonl` gains a new line per query
- [ ] `.obsidian/plugins/llm-wiki/recent-questions.json` updates after each query
- [ ] First query rebuilds the embedding cache; subsequent queries reuse it
- [ ] Asking "who is exact name" returns no results (blacklist working)
- [ ] Asking a question with no matches shows a graceful "I don't know" answer
```

**README addition** — add a section after the Phase 2 section:
```markdown
## Phase 3 — Ask your knowledge base

Press **Cmd+Shift+K** (or click the search icon in the ribbon) to open the query modal. Ask a question in natural language; the plugin retrieves matching entities, concepts, and connections from your KB and streams an LLM answer grounded in your notes.

**Settings → Query** lets you configure:
- Embedding model (default `nomic-embed-text`)
- Default folder scope
- How many recent questions to remember
- Whether to show source links in answers

All interactions are logged to `.obsidian/plugins/llm-wiki/interactions/<date>.jsonl` for later review.
```

**Final verification:**
```bash
npm test                  # all green
npm run typecheck         # zero errors
npm run lint              # zero errors
npm run build             # produces main.js
```

**Commit and merge:**
```bash
git add docs/superpowers/runbooks/2026-04-09-phase-3-smoke.md README.md
git commit -m "docs(phase-3): smoke checklist and README query section"

git checkout master
git merge --no-ff feature/phase-3-query -m "Merge Phase 3: Query"
```

After the merge, update `~/.claude/projects/-Users-dominiqueleca-tools/memory/project_llm_wiki_plugin.md` to mark Phase 3 as shipped.

---

## Self-Review Checklist (run before declaring the plan complete)

- [ ] Every task has a Files section, TDD steps with full code (no placeholders), an exact run command, and a conventional commit
- [ ] No task references a function/file that hasn't been created in an earlier task or already exists in the repo
- [ ] All `query/` modules use the `RankedItem` / `RetrievedBundle` / `QueryType` types from Task 4
- [ ] Type hint boost (×2.5) is applied AFTER quality multipliers, BEFORE final sort (Task 15)
- [ ] Embeddings cache invalidation by `sourceText` comparison (Task 10) — not by ID alone
- [ ] `safeAppendPluginData` (Task 19) is the only path to the JSONL log; no direct vault writes
- [ ] DOM-bearing code is only inside Task 25 (`query-modal.ts`); all other files are testable without jsdom
- [ ] `retrieve()` accepts an optional `dreamScores` arg (Task 15) that Phase 3 ignores — Phase 5 forward compat
- [ ] The blacklist in `quality.ts` (Task 13) is a SEPARATE structure from `core/filters.ts` — Phase 1's filter is untouched
- [ ] Settings extension in Task 28 includes all four new fields with defaults
- [ ] Integration test in Task 29 uses the real Phase 2 fixture, not a hand-built KB
- [ ] Smoke checklist in Task 30 covers every user-visible behavior from Section 7.1 of the spec

If any checkbox is unchecked after a re-read, fix it in place before handing off to execution.

