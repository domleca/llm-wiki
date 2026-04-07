# Async Embedding Index Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every code task uses the strict TDD five-step loop: write failing test → run failure → minimal impl → run pass → commit.

**Goal:** Make the query modal open instantly even on a cold start, by deferring the embedding-index build, surfacing build progress inside the modal, and (optionally) pre-building the index in the background at plugin startup.

**Architecture:**
- Introduce a long-lived `EmbeddingIndexController` owned by the plugin. It exposes a state machine (`idle | building | ready | error`) and an idempotent `ensureBuilt()` method that returns the cached promise if a build is already in flight.
- `buildEmbeddingIndex` learns an `onProgress` callback so the controller can report `{ current, total }` per item.
- `QueryModal` no longer takes a static `embeddingIndex`. It takes the controller, opens immediately, subscribes to controller state, renders an "indexing" UI with progress, and only constructs its inner `QueryController` (and enables the input) once the index is ready.
- `LlmWikiPlugin.openQueryModal()` no longer awaits the build — it constructs and opens the modal immediately, then triggers `controller.ensureBuilt()`.
- A new `prebuildEmbeddingIndex` setting (default `true`) makes the plugin call `controller.ensureBuilt()` after a short `setTimeout` in `onload()`, so the first modal open is usually instant.

**Tech Stack:** TypeScript, ESM (`.js` import suffixes), Vitest (`environment: "node"`), Obsidian API. Follows the established Phase 3 split: pure helpers in `src/query/` and `src/ui/modal/`, thin Obsidian shell in `query-modal.ts`.

---

## File Structure

**Created:**
- `src/query/embedding-index-controller.ts` — state machine + idempotent `ensureBuilt()`
- `tests/query/embedding-index-controller.test.ts`
- `src/ui/modal/indexing-status.ts` — pure helper formatting controller state into a status string
- `tests/ui/modal/indexing-status.test.ts`

**Modified:**
- `src/query/embeddings.ts` — add `onProgress` to `BuildEmbeddingIndexArgs`
- `tests/query/embeddings.test.ts` — cover the new callback
- `src/ui/modal/query-modal.ts` — accept controller, defer `QueryController` construction, render indexing state
- `src/plugin.ts` — own controller, open modal immediately, optional pre-build at `onload()`, new setting in `LlmWikiSettings`
- `src/ui/settings/query-section.ts` — add "Pre-build embedding index on startup" toggle and extend `QuerySettings` + `applyQuerySettingsPatch`
- `tests/ui/settings/query-section.test.ts` — cover the new field

---

## Tasks

### Task 1: Add `onProgress` to `buildEmbeddingIndex`

Surface per-item progress so the controller (and via it, the modal) can show "entity N of M".

**Files:**
- Modify: `src/query/embeddings.ts`
- Test: `tests/query/embeddings.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/query/embeddings.test.ts` inside the existing `describe("buildEmbeddingIndex", ...)` block:

```ts
  it("calls onProgress for every entity and concept with a stable total", async () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      aliases: [],
      facts: ["philosopher"],
      source: "x.md",
    });
    kb.addEntity({
      name: "Richard Feynman",
      type: "person",
      aliases: [],
      facts: ["physicist"],
      source: "x.md",
    });
    kb.addConcept({
      name: "Flow",
      definition: "absorbed attention",
      source: "x.md",
    });
    const provider = new MockLLMProvider({
      responses: [],
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    });
    const cache: EmbeddingsCache = { vaultId: "v1", entries: {} };
    const events: Array<{ current: number; total: number }> = [];
    await buildEmbeddingIndex({
      kb,
      provider,
      model: "nomic-embed-text",
      cache,
      onProgress: (p) => events.push({ ...p }),
    });
    expect(events.length).toBe(3);
    expect(events[0]).toEqual({ current: 1, total: 3 });
    expect(events[1]).toEqual({ current: 2, total: 3 });
    expect(events[2]).toEqual({ current: 3, total: 3 });
  });

  it("calls onProgress even for cache hits", async () => {
    const kb = new KnowledgeBase();
    kb.addEntity({
      name: "Alan Watts",
      type: "person",
      aliases: [],
      facts: ["philosopher"],
      source: "x.md",
    });
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
    const provider = new MockLLMProvider({ responses: [], embeddings: [] });
    const events: Array<{ current: number; total: number }> = [];
    await buildEmbeddingIndex({
      kb,
      provider,
      model: "nomic-embed-text",
      cache,
      onProgress: (p) => events.push({ ...p }),
    });
    expect(events).toEqual([{ current: 1, total: 1 }]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd llm-wiki-plugin && npx vitest run tests/query/embeddings.test.ts`
Expected: FAIL with TypeScript / runtime error about `onProgress` not being a known property of `BuildEmbeddingIndexArgs`.

- [ ] **Step 3: Add `onProgress` to `buildEmbeddingIndex`**

Edit `src/query/embeddings.ts`. Replace the entire file with:

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

export interface EmbeddingIndexProgress {
  /** 1-based count of items processed so far (cache hits included). */
  current: number;
  /** Total number of items the build will visit. Stable for the whole call. */
  total: number;
}

export interface BuildEmbeddingIndexArgs {
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  cache: EmbeddingsCache;
  signal?: AbortSignal;
  onProgress?: (progress: EmbeddingIndexProgress) => void;
}

export async function buildEmbeddingIndex(
  args: BuildEmbeddingIndexArgs,
): Promise<Map<string, number[]>> {
  const index = new Map<string, number[]>();
  const entities = args.kb.allEntities();
  const concepts = args.kb.allConcepts();
  const total = entities.length + concepts.length;
  let current = 0;

  const tick = (): void => {
    current += 1;
    args.onProgress?.({ current, total });
  };

  for (const e of entities) {
    const id = e.id;
    const text = contextualTextForEntity(e);
    const cached = args.cache.entries[id];
    if (cached && cached.sourceText === text) {
      index.set(id, cached.vector);
      tick();
      continue;
    }
    const vec = await args.provider.embed({
      text,
      model: args.model,
      signal: args.signal,
    });
    args.cache.entries[id] = { sourceText: text, vector: vec };
    index.set(id, vec);
    tick();
  }

  for (const c of concepts) {
    const id = `concept:${c.id}`;
    const text = contextualTextForConcept(c);
    const cached = args.cache.entries[id];
    if (cached && cached.sourceText === text) {
      index.set(id, cached.vector);
      tick();
      continue;
    }
    const vec = await args.provider.embed({
      text,
      model: args.model,
      signal: args.signal,
    });
    args.cache.entries[id] = { sourceText: text, vector: vec };
    index.set(id, vec);
    tick();
  }

  return index;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd llm-wiki-plugin && npx vitest run tests/query/embeddings.test.ts`
Expected: PASS, all five tests in the file green.

- [ ] **Step 5: Commit**

```bash
cd llm-wiki-plugin
git add src/query/embeddings.ts tests/query/embeddings.test.ts
git commit -m "feat(query): emit progress callbacks from buildEmbeddingIndex"
```

---

### Task 2: Create `EmbeddingIndexController` — idle path

Build the state machine, focusing first on the happy "idle → building → ready" path.

**Files:**
- Create: `src/query/embedding-index-controller.ts`
- Create: `tests/query/embedding-index-controller.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/query/embedding-index-controller.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  EmbeddingIndexController,
  type EmbeddingIndexState,
} from "../../src/query/embedding-index-controller.js";

function recordingController(opts: {
  buildResult?: ReadonlyMap<string, number[]>;
  buildError?: Error;
  emitProgress?: Array<{ current: number; total: number }>;
}): {
  controller: EmbeddingIndexController;
  states: EmbeddingIndexState[];
  buildCalls: number;
} {
  const states: EmbeddingIndexState[] = [];
  let buildCalls = 0;
  const controller = new EmbeddingIndexController({
    buildIndex: async (onProgress) => {
      buildCalls += 1;
      for (const p of opts.emitProgress ?? []) onProgress(p);
      if (opts.buildError) throw opts.buildError;
      return opts.buildResult ?? new Map();
    },
  });
  controller.subscribe((s) => states.push(s));
  return { controller, states, buildCalls };
}

describe("EmbeddingIndexController", () => {
  it("starts in idle state", () => {
    const { controller } = recordingController({});
    expect(controller.getState().kind).toBe("idle");
  });

  it("transitions idle → building → ready on a successful build", async () => {
    const result = new Map<string, number[]>([["a", [1, 0]]]);
    const { controller, states } = recordingController({
      buildResult: result,
      emitProgress: [
        { current: 1, total: 2 },
        { current: 2, total: 2 },
      ],
    });
    const index = await controller.ensureBuilt();
    expect(index).toBe(result);
    expect(states.map((s) => s.kind)).toEqual([
      "building",
      "building",
      "building",
      "ready",
    ]);
    const lastBuilding = states[2];
    if (lastBuilding.kind !== "building") throw new Error("expected building");
    expect(lastBuilding.progress).toEqual({ current: 2, total: 2 });
    const ready = states[3];
    if (ready.kind !== "ready") throw new Error("expected ready");
    expect(ready.index).toBe(result);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd llm-wiki-plugin && npx vitest run tests/query/embedding-index-controller.test.ts`
Expected: FAIL — module `../../src/query/embedding-index-controller.js` not found.

- [ ] **Step 3: Create the controller**

Create `src/query/embedding-index-controller.ts`:

```ts
import type { EmbeddingIndexProgress } from "./embeddings.js";

export type EmbeddingIndexState =
  | { kind: "idle" }
  | { kind: "building"; progress: EmbeddingIndexProgress }
  | { kind: "ready"; index: ReadonlyMap<string, number[]> }
  | { kind: "error"; message: string };

export interface EmbeddingIndexControllerOptions {
  buildIndex: (
    onProgress: (progress: EmbeddingIndexProgress) => void,
  ) => Promise<ReadonlyMap<string, number[]>>;
}

export class EmbeddingIndexController {
  private state: EmbeddingIndexState = { kind: "idle" };
  private buildPromise: Promise<ReadonlyMap<string, number[]>> | null = null;
  private readonly listeners = new Set<(state: EmbeddingIndexState) => void>();

  constructor(private readonly opts: EmbeddingIndexControllerOptions) {}

  getState(): EmbeddingIndexState {
    return this.state;
  }

  /**
   * Registers a listener for every future state transition. Does NOT fire
   * immediately with the current state — callers should call getState()
   * first if they need the initial value. Returns an unsubscribe function.
   */
  subscribe(cb: (state: EmbeddingIndexState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async ensureBuilt(): Promise<ReadonlyMap<string, number[]>> {
    if (this.state.kind === "ready") return this.state.index;
    if (this.state.kind === "error") return new Map();
    if (this.buildPromise) return this.buildPromise;

    this.transition({
      kind: "building",
      progress: { current: 0, total: 0 },
    });
    this.buildPromise = (async () => {
      try {
        const index = await this.opts.buildIndex((progress) => {
          this.transition({ kind: "building", progress });
        });
        this.transition({ kind: "ready", index });
        return index;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.transition({ kind: "error", message });
        return new Map<string, number[]>();
      } finally {
        this.buildPromise = null;
      }
    })();
    return this.buildPromise;
  }

  private transition(state: EmbeddingIndexState): void {
    this.state = state;
    // Snapshot listeners so a callback that unsubscribes itself (or a sibling)
    // mid-fan-out doesn't skip later listeners.
    for (const cb of [...this.listeners]) cb(state);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd llm-wiki-plugin && npx vitest run tests/query/embedding-index-controller.test.ts`
Expected: PASS, two tests green.

- [ ] **Step 5: Commit**

```bash
cd llm-wiki-plugin
git add src/query/embedding-index-controller.ts tests/query/embedding-index-controller.test.ts
git commit -m "feat(query): add EmbeddingIndexController happy path"
```

---

### Task 3: `EmbeddingIndexController` — idempotency and concurrent callers

Cover the case where a second `ensureBuilt()` call arrives while the first build is still in flight, and the case where a third call arrives after the first build is `ready`.

**Files:**
- Test: `tests/query/embedding-index-controller.test.ts` (extend)
- Modify: `src/query/embedding-index-controller.ts` (only if tests fail)

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("EmbeddingIndexController", ...)` block in `tests/query/embedding-index-controller.test.ts`:

```ts
  it("returns the same promise when ensureBuilt is called concurrently", async () => {
    let resolveBuild: (value: ReadonlyMap<string, number[]>) => void = () => {};
    let buildCalls = 0;
    const controller = new EmbeddingIndexController({
      buildIndex: async () => {
        buildCalls += 1;
        return await new Promise<ReadonlyMap<string, number[]>>((resolve) => {
          resolveBuild = resolve;
        });
      },
    });
    const p1 = controller.ensureBuilt();
    const p2 = controller.ensureBuilt();
    expect(buildCalls).toBe(1);
    const result = new Map<string, number[]>([["x", [1]]]);
    resolveBuild(result);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(result);
    expect(r2).toBe(result);
    expect(buildCalls).toBe(1);
  });

  it("does not rebuild after reaching ready", async () => {
    const result = new Map<string, number[]>([["x", [1]]]);
    const { controller, buildCalls } = recordingController({
      buildResult: result,
    });
    await controller.ensureBuilt();
    await controller.ensureBuilt();
    await controller.ensureBuilt();
    // buildCalls is captured at construction time; re-read via the closure
    expect(controller.getState().kind).toBe("ready");
    // Re-instrument: create a fresh controller and assert the count directly.
    let calls = 0;
    const fresh = new EmbeddingIndexController({
      buildIndex: async () => {
        calls += 1;
        return result;
      },
    });
    await fresh.ensureBuilt();
    await fresh.ensureBuilt();
    expect(calls).toBe(1);
    void buildCalls; // silence unused-var lint
  });
```

- [ ] **Step 2: Run the tests to verify behavior**

Run: `cd llm-wiki-plugin && npx vitest run tests/query/embedding-index-controller.test.ts`
Expected: Both new tests should already PASS — the controller already short-circuits via `state.kind === "ready"` and `buildPromise`. If they fail, fix the controller to honor those guards before moving on. Do **not** change the controller unless a test fails.

- [ ] **Step 3: Commit**

```bash
cd llm-wiki-plugin
git add tests/query/embedding-index-controller.test.ts
git commit -m "test(query): cover EmbeddingIndexController idempotency"
```

---

### Task 4: `EmbeddingIndexController` — error path

The build can fail (e.g. Ollama is down). The controller should land in `error` with a fallback empty index, and subsequent `ensureBuilt()` calls should return the same fallback without retrying.

**Files:**
- Test: `tests/query/embedding-index-controller.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append inside `describe("EmbeddingIndexController", ...)`:

```ts
  it("transitions to error with an empty fallback when buildIndex throws", async () => {
    const { controller, states } = recordingController({
      buildError: new Error("ollama down"),
    });
    const index = await controller.ensureBuilt();
    expect(index.size).toBe(0);
    const last = states[states.length - 1]!;
    if (last.kind !== "error") throw new Error("expected error state");
    expect(last.message).toBe("ollama down");
  });

  it("does not retry after landing in error", async () => {
    let calls = 0;
    const controller = new EmbeddingIndexController({
      buildIndex: async () => {
        calls += 1;
        throw new Error("nope");
      },
    });
    await controller.ensureBuilt();
    await controller.ensureBuilt();
    expect(calls).toBe(1);
    expect(controller.getState().kind).toBe("error");
  });
```

- [ ] **Step 2: Run the tests**

Run: `cd llm-wiki-plugin && npx vitest run tests/query/embedding-index-controller.test.ts`
Expected: PASS — the existing implementation already handles this. If they fail, fix the controller before continuing.

- [ ] **Step 3: Commit**

```bash
cd llm-wiki-plugin
git add tests/query/embedding-index-controller.test.ts
git commit -m "test(query): cover EmbeddingIndexController error path"
```

---

### Task 5: Pure helper — `formatIndexingStatus`

A pure function that turns an `EmbeddingIndexState` into the human string the modal shows. Keeping it pure means we can test it under vitest's `node` environment without touching the DOM.

**Files:**
- Create: `src/ui/modal/indexing-status.ts`
- Create: `tests/ui/modal/indexing-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ui/modal/indexing-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatIndexingStatus } from "../../../src/ui/modal/indexing-status.js";

describe("formatIndexingStatus", () => {
  it("returns 'Preparing…' for idle", () => {
    expect(formatIndexingStatus({ kind: "idle" })).toBe("Preparing…");
  });

  it("shows 'Building index…' before the first item is processed", () => {
    expect(
      formatIndexingStatus({
        kind: "building",
        progress: { current: 0, total: 0 },
      }),
    ).toBe("Building index…");
  });

  it("shows current/total when total is known", () => {
    expect(
      formatIndexingStatus({
        kind: "building",
        progress: { current: 3, total: 12 },
      }),
    ).toBe("Building index… 3 / 12");
  });

  it("returns 'Ready' when ready", () => {
    expect(
      formatIndexingStatus({
        kind: "ready",
        index: new Map(),
      }),
    ).toBe("Ready");
  });

  it("returns a fallback warning when in error", () => {
    expect(
      formatIndexingStatus({
        kind: "error",
        message: "ollama down",
      }),
    ).toBe("Embedding index unavailable (ollama down) — keyword-only fallback");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd llm-wiki-plugin && npx vitest run tests/ui/modal/indexing-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/ui/modal/indexing-status.ts`:

```ts
import type { EmbeddingIndexState } from "../../query/embedding-index-controller.js";

export function formatIndexingStatus(state: EmbeddingIndexState): string {
  switch (state.kind) {
    case "idle":
      return "Preparing…";
    case "building": {
      const { current, total } = state.progress;
      if (total === 0) return "Building index…";
      return `Building index… ${current} / ${total}`;
    }
    case "ready":
      return "Ready";
    case "error":
      return `Embedding index unavailable (${state.message}) — keyword-only fallback`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd llm-wiki-plugin && npx vitest run tests/ui/modal/indexing-status.test.ts`
Expected: PASS, five tests green.

- [ ] **Step 5: Commit**

```bash
cd llm-wiki-plugin
git add src/ui/modal/indexing-status.ts tests/ui/modal/indexing-status.test.ts
git commit -m "feat(ui): add formatIndexingStatus pure helper"
```

---

### Task 6: Wire `EmbeddingIndexController` into `QueryModal`

Update the already-polished modal (clear button, recents, terminal status line, `applyState`) to:

1. Replace the static `embeddingIndex` arg with an `indexController`. Keep `queryEmbedding` for Phase 5 forward-compat.
2. Start with `this.controller: QueryController | null = null` — no longer eagerly constructed in `onOpen`.
3. On open, subscribe to `indexController`, render the current state into the existing `terminalTextEl`, kick off `ensureBuilt()`. While the build is in progress, `contentEl[data-state]` is `"indexing"` and the input is `disabled`.
4. When the controller reaches `ready` or `error`, lazily construct the inner `QueryController` with `state.index` (or an empty `Map` on error), show a `Notice` on error, then hand off to the existing `applyState("idle")` which focuses the input and clears the terminal line.
5. Guard `submit()` against a null controller. Unsubscribe in `onClose()`.

**Files:**
- Modify: `src/ui/modal/query-modal.ts`

- [ ] **Step 1: Replace the modal source**

Edit `src/ui/modal/query-modal.ts`. Replace the entire file with:

```ts
import {
  App,
  Modal,
  MarkdownRenderer,
  Component,
  Notice,
  setIcon,
} from "obsidian";
import type { KnowledgeBase } from "../../core/kb.js";
import type { LLMProvider } from "../../llm/provider.js";
import {
  QueryController,
  type QueryControllerState,
} from "./query-controller.js";
import { AnswerRenderer, type RenderTarget } from "./answer-renderer.js";
import type { RetrievedBundle } from "../../query/types.js";
import type {
  EmbeddingIndexController,
  EmbeddingIndexState,
} from "../../query/embedding-index-controller.js";
import { formatIndexingStatus } from "./indexing-status.js";

const MAX_RECENTS_DISPLAYED = 5;

export interface QueryModalArgs {
  app: App;
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folder: string;
  recentQuestions: readonly string[];
  indexController: EmbeddingIndexController;
  queryEmbedding?: number[] | null;
  onAnswered: (entry: {
    question: string;
    answer: string;
    bundle: RetrievedBundle;
    elapsedMs: number;
  }) => void;
}

export class QueryModal extends Modal {
  private inputEl!: HTMLInputElement;
  private clearBtn!: HTMLButtonElement;
  private answerEl!: HTMLDivElement;
  private sourcesEl!: HTMLDetailsElement;
  private terminalTextEl!: HTMLSpanElement;
  private recentsEl!: HTMLDivElement;
  private recentItemEls: HTMLDivElement[] = [];
  private renderer!: AnswerRenderer;
  private controller: QueryController | null = null;
  private currentAnswer = "";
  private currentBundle: RetrievedBundle | null = null;
  private startMs = 0;
  private selectedRecentIdx = -1;
  private readonly recents: readonly string[];
  private readonly mdComponent = new Component();
  private unsubscribeIndex: (() => void) | null = null;

  constructor(private readonly args: QueryModalArgs) {
    super(args.app);
    this.recents = args.recentQuestions.slice(0, MAX_RECENTS_DISPLAYED);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-wiki-query-modal");
    contentEl.setAttr("data-state", "idle");
    this.modalEl.addClass("llm-wiki-query-modal");

    // Full-width input with inline clear button. Matches the command-palette
    // look without inheriting Obsidian's prompt-input sizing constraints.
    const inputContainer = contentEl.createDiv({
      cls: "llm-wiki-query-input-container",
    });
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: "Ask your knowledge base…",
      cls: "llm-wiki-query-input",
    });
    this.clearBtn = inputContainer.createEl("button", {
      cls: "llm-wiki-query-clear",
      attr: { type: "button", "aria-label": "Clear" },
    });
    setIcon(this.clearBtn, "x");
    this.clearBtn.onclick = (ev): void => {
      ev.preventDefault();
      this.inputEl.value = "";
      this.updateClearVisibility();
      this.clearRecentSelection();
      this.inputEl.focus();
    };

    // Pills row
    const pills = contentEl.createDiv({ cls: "llm-wiki-query-pills" });
    pills.createSpan({
      cls: "llm-wiki-query-pill",
      text: `model: ${this.args.model}`,
    });
    pills.createSpan({
      cls: "llm-wiki-query-pill",
      text: `folder: ${this.args.folder || "(whole vault)"}`,
    });

    // Recent questions — full-width suggestion rows, no header/container
    this.recentsEl = contentEl.createDiv({ cls: "llm-wiki-query-recents" });
    this.recents.forEach((q, i) => {
      const item = this.recentsEl.createDiv({
        cls: "suggestion-item llm-wiki-query-recent-item",
        text: q,
      });
      item.onclick = (): void => {
        this.inputEl.value = q;
        this.selectedRecentIdx = i;
        this.refreshRecentHighlight();
        this.submit();
      };
      this.recentItemEls.push(item);
    });

    // Terminal-style status line
    const terminal = contentEl.createDiv({ cls: "llm-wiki-query-terminal" });
    this.terminalTextEl = terminal.createSpan({
      cls: "llm-wiki-query-terminal-text",
    });
    terminal.createSpan({ cls: "llm-wiki-query-cursor" });

    // Answer + sources
    this.answerEl = contentEl.createDiv({ cls: "llm-wiki-query-answer" });
    this.sourcesEl = contentEl.createEl("details", {
      cls: "llm-wiki-query-sources",
    });
    this.sourcesEl.setAttr("data-empty", "true");
    this.sourcesEl.createEl("summary", { text: "Sources used (0)" });

    // Keyboard hints — uses Obsidian's native .prompt-instructions classes
    const footer = contentEl.createDiv({ cls: "prompt-instructions" });
    this.appendInstruction(footer, "↑↓", "to navigate");
    this.appendInstruction(footer, "↩", "to use");
    this.appendInstruction(footer, "esc", "to dismiss");

    // Markdown rendering pipeline
    const renderTarget: RenderTarget = {
      setMarkdown: (md): void => {
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

    // Input wiring
    this.inputEl.addEventListener("input", () => {
      this.updateClearVisibility();
      this.clearRecentSelection();
    });

    this.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        this.moveRecentSelection(1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        this.moveRecentSelection(-1);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.close();
      }
    });

    // Embedding index — render current state, subscribe, kick off build.
    this.applyIndexState(this.args.indexController.getState());
    this.unsubscribeIndex = this.args.indexController.subscribe((s) =>
      this.applyIndexState(s),
    );
    void this.args.indexController.ensureBuilt();

    this.inputEl.focus();
  }

  private applyIndexState(state: EmbeddingIndexState): void {
    if (state.kind === "idle" || state.kind === "building") {
      this.contentEl.setAttr("data-state", "indexing");
      this.terminalTextEl.setText(formatIndexingStatus(state));
      this.inputEl.setAttr("disabled", "true");
      return;
    }
    // state.kind === "ready" | "error" — either way we hand the modal a usable
    // (possibly empty) embedding index so keyword-only retrieval keeps working.
    const index: ReadonlyMap<string, number[]> =
      state.kind === "ready" ? state.index : new Map();
    if (!this.controller) {
      this.controller = this.buildQueryController(index);
    }
    if (state.kind === "error") {
      new Notice(
        `LLM Wiki: embedding index unavailable (${state.message}) — keyword-only retrieval`,
      );
    }
    // Hand off the terminal line to the query-controller state machine.
    this.applyState("idle");
    this.inputEl.focus();
  }

  private buildQueryController(
    embeddingIndex: ReadonlyMap<string, number[]>,
  ): QueryController {
    return new QueryController({
      kb: this.args.kb,
      provider: this.args.provider,
      model: this.args.model,
      folder: this.args.folder,
      embeddingIndex,
      queryEmbedding: this.args.queryEmbedding,
      onState: (s): void => {
        this.applyState(s);
        if (s === "done" && this.currentBundle) {
          this.args.onAnswered({
            question: this.inputEl.value,
            answer: this.currentAnswer,
            bundle: this.currentBundle,
            elapsedMs: Date.now() - this.startMs,
          });
        }
      },
      onContext: (bundle): void => {
        this.currentBundle = bundle;
        const summary = this.sourcesEl.querySelector("summary");
        if (summary) {
          summary.setText(`Sources used (${bundle.sources.length})`);
        }
        this.sourcesEl.querySelector("ul")?.remove();
        if (bundle.sources.length > 0) {
          this.sourcesEl.setAttr("data-empty", "false");
          const list = this.sourcesEl.createEl("ul");
          for (const s of bundle.sources) {
            list.createEl("li", { text: s.id });
          }
        } else {
          this.sourcesEl.setAttr("data-empty", "true");
        }
      },
      onChunk: (t): void => {
        this.currentAnswer += t;
        this.renderer.append(t);
      },
      onError: (msg): void => {
        new Notice(`Query failed: ${msg}`);
      },
    });
  }

  private submit(): void {
    if (!this.controller) return;
    const q = this.inputEl.value.trim();
    if (!q) return;
    this.currentAnswer = "";
    this.currentBundle = null;
    this.renderer.reset();
    this.answerEl.empty();
    this.sourcesEl.setAttr("data-empty", "true");
    this.sourcesEl.querySelector("ul")?.remove();
    const summary = this.sourcesEl.querySelector("summary");
    if (summary) summary.setText("Sources used (0)");
    this.startMs = Date.now();
    void this.controller.run(q);
  }

  private applyState(s: QueryControllerState): void {
    this.contentEl.setAttr("data-state", s);
    this.terminalTextEl.setText(this.terminalLabel(s));
    if (s === "loading" || s === "streaming") {
      this.inputEl.setAttr("disabled", "true");
    } else {
      this.inputEl.removeAttribute("disabled");
      if (s === "done" || s === "error" || s === "cancelled") {
        this.inputEl.focus();
      }
    }
  }

  private terminalLabel(s: QueryControllerState): string {
    switch (s) {
      case "idle":
        return "";
      case "loading":
        return "thinking";
      case "streaming":
        return "streaming";
      case "done": {
        const secs = ((Date.now() - this.startMs) / 1000).toFixed(1);
        return `done in ${secs}s`;
      }
      case "error":
        return "error — see notice";
      case "cancelled":
        return "cancelled";
    }
  }

  private moveRecentSelection(delta: number): void {
    if (this.recents.length === 0) return;
    const next =
      this.selectedRecentIdx === -1
        ? delta > 0
          ? 0
          : this.recents.length - 1
        : this.selectedRecentIdx + delta;
    if (next < 0 || next >= this.recents.length) return;
    this.selectedRecentIdx = next;
    this.inputEl.value = this.recents[next]!;
    this.updateClearVisibility();
    this.refreshRecentHighlight();
    this.recentItemEls[next]?.scrollIntoView({ block: "nearest" });
  }

  private updateClearVisibility(): void {
    this.clearBtn.setAttr(
      "data-visible",
      this.inputEl.value.length > 0 ? "true" : "false",
    );
  }

  private clearRecentSelection(): void {
    if (this.selectedRecentIdx === -1) return;
    this.selectedRecentIdx = -1;
    this.refreshRecentHighlight();
  }

  private refreshRecentHighlight(): void {
    this.recentItemEls.forEach((el, i) => {
      el.toggleClass("is-selected", i === this.selectedRecentIdx);
    });
  }

  private appendInstruction(
    parent: HTMLElement,
    cmd: string,
    text: string,
  ): void {
    const instruction = parent.createDiv({ cls: "prompt-instruction" });
    instruction.createSpan({
      cls: "prompt-instruction-command",
      text: cmd,
    });
    instruction.createSpan({ text });
  }

  onClose(): void {
    this.controller?.cancel();
    this.renderer.flush();
    this.mdComponent.unload();
    this.unsubscribeIndex?.();
    this.unsubscribeIndex = null;
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: Typecheck the whole project**

Run: `cd llm-wiki-plugin && npx tsc --noEmit`
Expected: FAIL — `src/plugin.ts` still passes `embeddingIndex` and not `indexController` to `QueryModal`. That's fine; Task 8 fixes it. The only errors should be in `src/plugin.ts`. If you see an error in any other file, **stop and fix it** before moving on.

- [ ] **Step 3: Commit**

```bash
cd llm-wiki-plugin
git add src/ui/modal/query-modal.ts
git commit -m "feat(ui): show indexing progress in QueryModal"
```

---

### Task 7: Add `prebuildEmbeddingIndex` to settings

Add the new boolean to `LlmWikiSettings`, default `true`. Surface it as a toggle in the Query section of the settings tab. Extend the existing `applyQuerySettingsPatch` test to cover the new field.

**Files:**
- Modify: `src/ui/settings/query-section.ts`
- Modify: `tests/ui/settings/query-section.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `tests/ui/settings/query-section.test.ts` with:

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
      prebuildEmbeddingIndex: true,
    };
    const after = applyQuerySettingsPatch(before, {
      embeddingModel: "new",
    });
    expect(after.embeddingModel).toBe("new");
    expect(after.recentQuestionCount).toBe(5);
    expect(after.defaultQueryFolder).toBe("");
    expect(after.showSourceLinks).toBe(true);
    expect(after.prebuildEmbeddingIndex).toBe(true);
  });

  it("clamps recentQuestionCount to [0, 50]", () => {
    const before = {
      embeddingModel: "x",
      defaultQueryFolder: "",
      recentQuestionCount: 5,
      showSourceLinks: true,
      prebuildEmbeddingIndex: true,
    };
    expect(
      applyQuerySettingsPatch(before, { recentQuestionCount: -3 })
        .recentQuestionCount,
    ).toBe(0);
    expect(
      applyQuerySettingsPatch(before, { recentQuestionCount: 9999 })
        .recentQuestionCount,
    ).toBe(50);
    expect(
      applyQuerySettingsPatch(before, { recentQuestionCount: 25 })
        .recentQuestionCount,
    ).toBe(25);
  });

  it("does not mutate the previous settings object", () => {
    const before = {
      embeddingModel: "old",
      defaultQueryFolder: "",
      recentQuestionCount: 5,
      showSourceLinks: true,
      prebuildEmbeddingIndex: true,
    };
    applyQuerySettingsPatch(before, {
      embeddingModel: "new",
      recentQuestionCount: 12,
    });
    expect(before.embeddingModel).toBe("old");
    expect(before.recentQuestionCount).toBe(5);
    expect(before.prebuildEmbeddingIndex).toBe(true);
  });

  it("preserves prebuildEmbeddingIndex when patched to false", () => {
    const before = {
      embeddingModel: "x",
      defaultQueryFolder: "",
      recentQuestionCount: 5,
      showSourceLinks: true,
      prebuildEmbeddingIndex: true,
    };
    expect(
      applyQuerySettingsPatch(before, { prebuildEmbeddingIndex: false })
        .prebuildEmbeddingIndex,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd llm-wiki-plugin && npx vitest run tests/ui/settings/query-section.test.ts`
Expected: FAIL — `prebuildEmbeddingIndex` not assignable to `QuerySettings`.

- [ ] **Step 3: Add the field and toggle**

Replace `src/ui/settings/query-section.ts` with:

```ts
import { Setting } from "obsidian";

export interface QuerySettings {
  embeddingModel: string;
  defaultQueryFolder: string;
  recentQuestionCount: number;
  showSourceLinks: boolean;
  prebuildEmbeddingIndex: boolean;
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
      t.setValue(args.settings.embeddingModel).onChange((v: string) => {
        void args.onChange({ embeddingModel: v.trim() });
      }),
    );

  new Setting(args.container)
    .setName("Default folder")
    .setDesc("Restrict queries to this vault folder (empty = whole vault)")
    .addText((t) =>
      t.setValue(args.settings.defaultQueryFolder).onChange((v: string) => {
        void args.onChange({ defaultQueryFolder: v.trim() });
      }),
    );

  new Setting(args.container)
    .setName("Recent questions to remember")
    .setDesc("How many recent questions to keep in the up/down history (0–50)")
    .addText((t) =>
      t
        .setValue(String(args.settings.recentQuestionCount))
        .onChange((v: string) => {
          const n = Number.parseInt(v, 10);
          if (!Number.isNaN(n)) {
            void args.onChange({ recentQuestionCount: n });
          }
        }),
    );

  new Setting(args.container)
    .setName("Show source links in answer")
    .setDesc("Render source citations as clickable links in the answer body")
    .addToggle((t) =>
      t.setValue(args.settings.showSourceLinks).onChange((v: boolean) => {
        void args.onChange({ showSourceLinks: v });
      }),
    );

  new Setting(args.container)
    .setName("Pre-build embedding index on startup")
    .setDesc(
      "Build the embedding index in the background a moment after Obsidian launches, so the first query modal opens instantly. Disable to keep startup quiet at the cost of a one-time build on the first query.",
    )
    .addToggle((t) =>
      t.setValue(args.settings.prebuildEmbeddingIndex).onChange((v: boolean) => {
        void args.onChange({ prebuildEmbeddingIndex: v });
      }),
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd llm-wiki-plugin && npx vitest run tests/ui/settings/query-section.test.ts`
Expected: PASS, four tests green.

- [ ] **Step 5: Commit**

```bash
cd llm-wiki-plugin
git add src/ui/settings/query-section.ts tests/ui/settings/query-section.test.ts
git commit -m "feat(settings): add prebuildEmbeddingIndex toggle"
```

---

### Task 8: Wire the controller into the plugin and pre-build at `onload()`

Plug everything together:
1. Add `prebuildEmbeddingIndex: true` to `DEFAULT_SETTINGS` and to `LlmWikiSettings`.
2. Replace the `embeddingIndex` / `embeddingsCache` fields with an `embeddingIndexController` field.
3. Construct it once at the start of `onload()`. Its `buildIndex` closure loads the cache (lazily on first call), runs `buildEmbeddingIndex` with an `onProgress` adapter, then saves the cache.
4. After `onload()` finishes wiring commands, schedule `setTimeout(() => void this.embeddingIndexController.ensureBuilt(), 2000)` if `prebuildEmbeddingIndex` is enabled. Register the timeout via `this.registerInterval` or just clear it in `onunload()`.
5. `openQueryModal()` no longer awaits the build. It constructs the modal immediately and passes the controller. The "kb not loaded" guard stays.

**Files:**
- Modify: `src/plugin.ts`

- [ ] **Step 1: Replace the plugin source**

Edit `src/plugin.ts`. Replace the entire file with:

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
import {
  loadEmbeddingsCache,
  saveEmbeddingsCache,
  type EmbeddingsCache,
} from "./vault/plugin-data.js";
import { appendInteractionLog } from "./vault/interaction-log.js";
import {
  loadRecentQuestions,
  saveRecentQuestions,
  pushRecentQuestion,
} from "./vault/recent-questions.js";
import { QueryModal } from "./ui/modal/query-modal.js";
import { buildEmbeddingIndex } from "./query/embeddings.js";
import { EmbeddingIndexController } from "./query/embedding-index-controller.js";

interface LlmWikiSettings {
  version: number;
  ollamaUrl: string;
  ollamaModel: string;
  extractionCharLimit: number;
  lastExtractionRunIso: string | null;
  embeddingModel: string;
  defaultQueryFolder: string;
  recentQuestionCount: number;
  showSourceLinks: boolean;
  prebuildEmbeddingIndex: boolean;
}

const DEFAULT_SETTINGS: LlmWikiSettings = {
  version: 1,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  extractionCharLimit: 12_000,
  lastExtractionRunIso: null,
  embeddingModel: "nomic-embed-text",
  defaultQueryFolder: "",
  recentQuestionCount: 5,
  showSourceLinks: true,
  prebuildEmbeddingIndex: true,
};

/** Delay before kicking off the background pre-build, so plugin load stays snappy. */
const PREBUILD_DELAY_MS = 2000;

export default class LlmWikiPlugin extends Plugin {
  settings: LlmWikiSettings = DEFAULT_SETTINGS;
  kb: KnowledgeBase = new KnowledgeBase();
  kbMtime = 0;

  progress = new ProgressEmitter();
  private provider: LLMProvider = new OllamaProvider({
    url: this.settings.ollamaUrl,
  });
  private abortController: AbortController | null = null;
  private running = false;
  private recentQuestions: string[] = [];
  private embeddingsCache: EmbeddingsCache | null = null;
  private embeddingIndexController: EmbeddingIndexController | null = null;
  private prebuildTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.rebuildProvider();
    await this.reloadKB();
    this.recentQuestions = await loadRecentQuestions(this.app);
    this.embeddingIndexController = this.createIndexController();

    // Status bar
    const statusEl = this.addStatusBarItem();
    new StatusBarWidget(statusEl, this.progress);

    // Settings tab
    this.addSettingTab(new LlmWikiSettingsTab(this.app, this));

    // Ribbon icon — open the query modal
    this.addRibbonIcon("rainbow", "Ask knowledge base", () => {
      this.openQueryModal();
    });

    // Commands
    this.addCommand({
      id: "run-query",
      name: "Ask knowledge base",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "k" }],
      callback: () => {
        this.openQueryModal();
      },
    });

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

    if (this.settings.prebuildEmbeddingIndex) {
      this.prebuildTimer = window.setTimeout(() => {
        this.prebuildTimer = null;
        void this.embeddingIndexController?.ensureBuilt();
      }, PREBUILD_DELAY_MS);
    }
  }

  onunload(): void {
    this.cancelExtraction();
    if (this.prebuildTimer !== null) {
      window.clearTimeout(this.prebuildTimer);
      this.prebuildTimer = null;
    }
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

  private createIndexController(): EmbeddingIndexController {
    return new EmbeddingIndexController({
      buildIndex: async (onProgress) => {
        if (!this.embeddingsCache) {
          this.embeddingsCache = await loadEmbeddingsCache(this.app);
        }
        const index = await buildEmbeddingIndex({
          kb: this.kb,
          provider: this.provider,
          model: this.settings.embeddingModel,
          cache: this.embeddingsCache,
          onProgress,
        });
        await saveEmbeddingsCache(this.app, this.embeddingsCache);
        return index;
      },
    });
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
          origin: w.origin,
        });
      }

      const saveCallback = async (): Promise<void> => {
        await saveKB(this.app as never, this.kb, this.kbMtime);
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

  private openQueryModal(): void {
    if (!this.kb) {
      new Notice("LLM Wiki: knowledge base not loaded yet");
      return;
    }
    if (!this.embeddingIndexController) {
      this.embeddingIndexController = this.createIndexController();
    }

    const modal = new QueryModal({
      app: this.app,
      kb: this.kb,
      provider: this.provider,
      model: this.settings.ollamaModel,
      folder: this.settings.defaultQueryFolder,
      recentQuestions: this.recentQuestions,
      indexController: this.embeddingIndexController,
      onAnswered: ({ question, answer, bundle, elapsedMs }): void => {
        void (async (): Promise<void> => {
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
        })();
      },
    });
    modal.open();
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

- [ ] **Step 2: Typecheck the whole project**

Run: `cd llm-wiki-plugin && npx tsc --noEmit`
Expected: PASS with no errors.

- [ ] **Step 3: Run the full test suite**

Run: `cd llm-wiki-plugin && npm test`
Expected: PASS — all 240+ tests green, plus the new tests added in Tasks 1–7.

- [ ] **Step 4: Lint**

Run: `cd llm-wiki-plugin && npm run lint`
Expected: PASS with no errors.

- [ ] **Step 5: Commit**

```bash
cd llm-wiki-plugin
git add src/plugin.ts
git commit -m "feat(plugin): open query modal instantly with deferred index build"
```

---

### Task 9: Smoke checklist update

Add a short manual smoke for the new behavior so the next test-vault run actually exercises it.

**Files:**
- Modify: `docs/superpowers/runbooks/2026-04-09-phase-3-smoke.md` (append to the end)

- [ ] **Step 1: Append to the smoke runbook**

Open the existing smoke runbook and append a new section verbatim:

```markdown

## Async embedding index (post-Phase-3 follow-up)

- [ ] Cold start with `prebuildEmbeddingIndex = true`: launch Obsidian, wait ~2s, then immediately press Cmd+Shift+K. The modal should open instantly. The "Building index…" line either flashes briefly or is already "Ready".
- [ ] Cold start with `prebuildEmbeddingIndex = false`: relaunch Obsidian, immediately press Cmd+Shift+K. The modal should open instantly. The input should be disabled and the status line should show `Building index… N / M` with the counter advancing. When the build finishes, the input should focus and accept typing.
- [ ] Disconnect Ollama (or stop the server), then open the query modal cold. The status line should show `Embedding index unavailable (...) — keyword-only fallback` and the input should still become enabled. A query should still complete using keyword retrieval.
- [ ] With the modal already open and the build in progress, close the modal and reopen it. The new modal should pick up the in-flight build (no double build), and the input should enable as soon as the build finishes.
```

- [ ] **Step 2: Commit**

```bash
cd llm-wiki-plugin
git add docs/superpowers/runbooks/2026-04-09-phase-3-smoke.md
git commit -m "docs: smoke steps for async embedding index build"
```

---

## Self-Review Notes

- **Spec coverage:** Original ask had two parts. Part A (instant modal + progress) is covered by Tasks 1–6 and 8. Part B (background pre-build + setting) is covered by Tasks 7–8. The cold-start Ollama warning is **not** included as a separate task; the existing `Embedding index unavailable …` line in `formatIndexingStatus` covers the Ollama-down case, and warning users about a slow first query is best left to user-facing docs rather than UI noise. If the user explicitly wants the warning, add a one-line `setText` in the modal's initial render after Task 6.
- **Type consistency:** `EmbeddingIndexProgress` is defined once in `embeddings.ts` and re-imported by `embedding-index-controller.ts`. `EmbeddingIndexState` lives in the controller and is imported by both `indexing-status.ts` and `query-modal.ts`. `prebuildEmbeddingIndex` appears in `LlmWikiSettings`, `DEFAULT_SETTINGS`, `QuerySettings`, and `applyQuerySettingsPatch` tests.
- **TDD discipline:** Tasks 1, 2, 5, 7 follow the strict five-step loop. Tasks 3 and 4 are characterization tests that should pass without code changes; if they fail, fix the controller before continuing. Tasks 6 and 8 are wiring tasks where the safety net is `tsc --noEmit` + the existing test suite — there's no new pure logic to TDD against, since modal code is not directly testable in vitest's `node` env.
- **Frequent commits:** One commit per task, nine commits total. Squash on merge if desired.
- **YAGNI check:** No retry-on-error in the controller (user can reopen the modal). No "build cancelled" state — the user can't trigger a cancel from the modal, and `onunload` already cleans up the prebuild timer. No queueing of submitted questions during the build — the input is just disabled, which is simpler and matches the spec.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-07-async-embedding-index-build.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints

Which approach?
