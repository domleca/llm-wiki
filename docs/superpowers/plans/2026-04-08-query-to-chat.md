# Query → Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-shot query modal (Shift-Cmd-K) into a multi-turn chat that keeps conversational context, persists history across sessions, and lets users resume past chats.

**Architecture:** A new `chats.json` store (replacing `recent-questions.json`) holds full conversations as `{id, title, createdAt, updatedAt, folder, model, turns[]}`. The modal gains a scrollable transcript above the input; the "recents" list under the input becomes a chat-history list (click to resume, hover to rename/delete). Each follow-up turn (≥2) runs an LLM rewrite step to resolve pronouns/ellipsis before retrieval, and the main ask prompt is extended to include prior turns, budgeted by the model's context window (discovered via Ollama `/api/show`). Turn 1 also fires a background LLM call to generate a ≤6-word title.

**Tech Stack:** TypeScript, Obsidian plugin API, Vitest, existing `LLMProvider` interface, existing `ask()` streaming pipeline.

**Deletion pass (per global rule):** `src/vault/recent-questions.ts`, `tests/vault/recent-questions.test.ts`, and all `recentQuestions`/`pushRecentQuestion`/`loadRecentQuestions`/`saveRecentQuestions` wiring are **deleted outright**, not migrated. Chat history replaces them.

---

## File Structure

**New files:**
- `src/chat/types.ts` — `Chat`, `ChatTurn`, `ChatStore` interfaces.
- `src/chat/store.ts` — pure helpers: `createChat`, `appendTurn`, `updateChatTitle`, `renameChat`, `deleteChat`, `touchChat`, `sortChatsByRecency`. No I/O.
- `src/chat/persistence.ts` — `loadChats(app)`, `saveChats(app, chats)` backed by `safeReadPluginData`/`safeWritePluginData` at `chats.json`.
- `src/chat/history-budget.ts` — pure: `budgetHistory(turns, opts)` → which turns fit into a token budget, oldest-first drop.
- `src/chat/rewrite.ts` — `rewriteFollowUp({provider, model, history, question, signal})` returns a standalone question string.
- `src/chat/title.ts` — `generateChatTitle({provider, model, firstTurn, signal})` returns ≤6-word title.
- `src/chat/model-context.ts` — `getModelContextWindow(provider, model)` with in-memory cache, `FALLBACK_CONTEXT_WINDOW = 4096`.
- `src/llm/ollama-show.ts` — thin wrapper around `GET /api/show` returning `{contextLength: number | null}`. Added to `OllamaProvider` as `showModel(model)`.
- `src/ui/modal/chat-transcript.ts` — renders the scrollable list of `{question, answer, sources}` blocks above the input.
- `src/ui/modal/chat-list.ts` — renders the history list under the input with hover rename/delete.
- Tests mirroring each of the above under `tests/…`.

**Modified files:**
- `src/llm/provider.ts` — add optional `showModel?(model): Promise<{contextLength: number | null}>` to `LLMProvider`.
- `src/llm/ollama.ts` — implement `showModel`.
- `src/query/ask.ts` — accept optional `history: ChatTurn[]` and pass through to prompt builder.
- `src/query/prompts.ts` — `buildAskPrompt` accepts optional `history` and renders `[user]/[assistant]` turns between rules and context.
- `src/ui/modal/query-controller.ts` — new `runChatTurn({chat, question})` path that: rewrites (if turn ≥ 2), retrieves, asks with history.
- `src/ui/modal/query-modal.ts` — swap single-answer rendering for transcript + chat list; add rename/delete UX; resume chat on click.
- `src/plugin.ts` — load/save chats instead of recentQuestions; wire modal to chat store.
- `src/vault/recent-questions.ts` — **deleted**.
- `tests/vault/recent-questions.test.ts` — **deleted**.

---

## Task 1: Chat domain types

**Files:**
- Create: `src/chat/types.ts`
- Test: `tests/chat/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/chat/types.test.ts
import { describe, it, expect } from "vitest";
import type { Chat, ChatTurn } from "../../src/chat/types.js";

describe("chat types", () => {
  it("compiles with the expected shape", () => {
    const turn: ChatTurn = {
      question: "q",
      answer: "a",
      sourceIds: ["a/b.md"],
      rewrittenQuery: null,
      createdAt: 1,
    };
    const chat: Chat = {
      id: "c1",
      title: "Untitled",
      createdAt: 1,
      updatedAt: 1,
      folder: "",
      model: "qwen2.5:7b",
      turns: [turn],
    };
    expect(chat.turns[0].question).toBe("q");
  });
});
```

- [ ] **Step 2: Run test — expect fail (module missing)**

Run: `npx vitest run tests/chat/types.test.ts`
Expected: FAIL — cannot find module `src/chat/types.js`.

- [ ] **Step 3: Implement**

```ts
// src/chat/types.ts
export interface ChatTurn {
  question: string;
  answer: string;
  sourceIds: string[];
  /** For turn ≥ 2: the LLM-rewritten standalone question used for retrieval. */
  rewrittenQuery: string | null;
  createdAt: number;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  folder: string;
  model: string;
  turns: ChatTurn[];
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/chat/types.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/types.ts tests/chat/types.test.ts
git commit -m "feat(chat): add Chat and ChatTurn domain types"
```

---

## Task 2: Pure chat store helpers

**Files:**
- Create: `src/chat/store.ts`
- Test: `tests/chat/store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/chat/store.test.ts
import { describe, it, expect } from "vitest";
import {
  createChat,
  appendTurn,
  updateChatTitle,
  renameChat,
  deleteChat,
  sortChatsByRecency,
} from "../../src/chat/store.js";
import type { Chat, ChatTurn } from "../../src/chat/types.js";

const turn = (q: string, t: number): ChatTurn => ({
  question: q,
  answer: `ans-${q}`,
  sourceIds: [],
  rewrittenQuery: null,
  createdAt: t,
});

describe("createChat", () => {
  it("makes a chat with a fresh id, empty turns, and matching timestamps", () => {
    const c = createChat({ id: "id1", now: 100, folder: "", model: "m" });
    expect(c.id).toBe("id1");
    expect(c.turns).toEqual([]);
    expect(c.title).toBe("Untitled");
    expect(c.createdAt).toBe(100);
    expect(c.updatedAt).toBe(100);
  });
});

describe("appendTurn", () => {
  it("appends and bumps updatedAt without mutating input", () => {
    const c = createChat({ id: "a", now: 1, folder: "", model: "m" });
    const t = turn("q1", 5);
    const next = appendTurn(c, t, 5);
    expect(next.turns).toHaveLength(1);
    expect(next.updatedAt).toBe(5);
    expect(c.turns).toHaveLength(0);
  });
});

describe("updateChatTitle / renameChat", () => {
  it("sets title and bumps updatedAt", () => {
    const c = createChat({ id: "a", now: 1, folder: "", model: "m" });
    expect(updateChatTitle(c, "Hello world", 10).title).toBe("Hello world");
    expect(renameChat(c, "Custom", 11).updatedAt).toBe(11);
  });
});

describe("deleteChat", () => {
  it("removes by id", () => {
    const chats: Chat[] = [
      createChat({ id: "a", now: 1, folder: "", model: "m" }),
      createChat({ id: "b", now: 2, folder: "", model: "m" }),
    ];
    expect(deleteChat(chats, "a").map((c) => c.id)).toEqual(["b"]);
  });
});

describe("sortChatsByRecency", () => {
  it("orders by updatedAt desc", () => {
    const chats: Chat[] = [
      { ...createChat({ id: "a", now: 1, folder: "", model: "m" }), updatedAt: 5 },
      { ...createChat({ id: "b", now: 1, folder: "", model: "m" }), updatedAt: 10 },
      { ...createChat({ id: "c", now: 1, folder: "", model: "m" }), updatedAt: 1 },
    ];
    expect(sortChatsByRecency(chats).map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/chat/store.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/chat/store.ts
import type { Chat, ChatTurn } from "./types.js";

export interface CreateChatArgs {
  id: string;
  now: number;
  folder: string;
  model: string;
}

export function createChat(args: CreateChatArgs): Chat {
  return {
    id: args.id,
    title: "Untitled",
    createdAt: args.now,
    updatedAt: args.now,
    folder: args.folder,
    model: args.model,
    turns: [],
  };
}

export function appendTurn(chat: Chat, turn: ChatTurn, now: number): Chat {
  return { ...chat, turns: [...chat.turns, turn], updatedAt: now };
}

export function updateChatTitle(chat: Chat, title: string, now: number): Chat {
  return { ...chat, title, updatedAt: now };
}

export const renameChat = updateChatTitle;

export function deleteChat(chats: readonly Chat[], id: string): Chat[] {
  return chats.filter((c) => c.id !== id);
}

export function sortChatsByRecency(chats: readonly Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/chat/store.ts tests/chat/store.test.ts
git commit -m "feat(chat): pure helpers for creating, appending, and sorting chats"
```

---

## Task 3: Persistence (`chats.json`)

**Files:**
- Create: `src/chat/persistence.ts`
- Test: `tests/chat/persistence.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/chat/persistence.test.ts
import { describe, it, expect } from "vitest";
import { loadChats, saveChats } from "../../src/chat/persistence.js";
import { createChat } from "../../src/chat/store.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("chat persistence", () => {
  it("round-trips via save/load", async () => {
    const { app } = createMockApp();
    const chats = [createChat({ id: "a", now: 1, folder: "", model: "m" })];
    await saveChats(app as never, chats);
    expect(await loadChats(app as never)).toEqual(chats);
  });

  it("returns empty array when file missing", async () => {
    const { app } = createMockApp();
    expect(await loadChats(app as never)).toEqual([]);
  });

  it("returns empty array on malformed JSON", async () => {
    const { app } = createMockApp();
    await saveChats(app as never, [] as never);
    // overwrite with garbage via the same safe-write path
    const { safeWritePluginData } = await import("../../src/vault/safe-write.js");
    await safeWritePluginData(app as never, "chats.json", "{not json");
    expect(await loadChats(app as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```ts
// src/chat/persistence.ts
import {
  safeReadPluginData,
  safeWritePluginData,
  type SafeWriteApp,
} from "../vault/safe-write.js";
import type { Chat } from "./types.js";

const FILE = "chats.json";

export async function loadChats(app: SafeWriteApp): Promise<Chat[]> {
  const raw = await safeReadPluginData(app, FILE);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive: only keep objects that look like Chats.
    return parsed.filter(
      (c): c is Chat =>
        !!c &&
        typeof c === "object" &&
        typeof (c as Chat).id === "string" &&
        Array.isArray((c as Chat).turns),
    );
  } catch {
    return [];
  }
}

export async function saveChats(
  app: SafeWriteApp,
  chats: readonly Chat[],
): Promise<void> {
  await safeWritePluginData(app, FILE, JSON.stringify(chats, null, 2));
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/chat/persistence.ts tests/chat/persistence.test.ts
git commit -m "feat(chat): persist chats to chats.json via safe-write"
```

---

## Task 4: Model context-window discovery

**Files:**
- Create: `src/llm/ollama-show.ts`
- Modify: `src/llm/provider.ts`, `src/llm/ollama.ts`
- Create: `src/chat/model-context.ts`
- Test: `tests/llm/ollama-show.test.ts`, `tests/chat/model-context.test.ts`

- [ ] **Step 1: Write failing test for `showModel`**

```ts
// tests/llm/ollama-show.test.ts
import { describe, it, expect } from "vitest";
import { OllamaProvider } from "../../src/llm/ollama.js";

function mockFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

describe("OllamaProvider.showModel", () => {
  it("extracts context length from model_info", async () => {
    const p = new OllamaProvider({
      fetchImpl: mockFetch({
        model_info: { "qwen2.arch.context_length": 32768 },
      }),
    });
    const r = await p.showModel!("qwen2.5:7b");
    expect(r.contextLength).toBe(32768);
  });

  it("returns null when no context_length field is present", async () => {
    const p = new OllamaProvider({ fetchImpl: mockFetch({ model_info: {} }) });
    const r = await p.showModel!("x");
    expect(r.contextLength).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const p = new OllamaProvider({
      fetchImpl: (async () =>
        new Response("", { status: 500 })) as unknown as typeof fetch,
    });
    const r = await p.showModel!("x");
    expect(r.contextLength).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Add interface method and implement**

In `src/llm/provider.ts`, add to `LLMProvider`:

```ts
  /** Optional: fetch model metadata, notably the context window length. */
  showModel?(model: string): Promise<{ contextLength: number | null }>;
```

In `src/llm/ollama.ts`, add:

```ts
  async showModel(model: string): Promise<{ contextLength: number | null }> {
    try {
      const res = await this.fetchImpl(`${this.url}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: model }),
      });
      if (!res.ok) return { contextLength: null };
      const json = (await res.json()) as { model_info?: Record<string, unknown> };
      const info = json.model_info ?? {};
      // Ollama keys this as "<arch>.context_length" — scan for any key ending in .context_length.
      for (const [k, v] of Object.entries(info)) {
        if (k.endsWith("context_length") && typeof v === "number") {
          return { contextLength: v };
        }
      }
      return { contextLength: null };
    } catch {
      return { contextLength: null };
    }
  }
```

- [ ] **Step 4: Run ollama-show test — expect pass.**

- [ ] **Step 5: Write failing test for `getModelContextWindow`**

```ts
// tests/chat/model-context.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  getModelContextWindow,
  FALLBACK_CONTEXT_WINDOW,
  _resetModelContextCache,
} from "../../src/chat/model-context.js";
import type { LLMProvider } from "../../src/llm/provider.js";

function makeProvider(ctx: number | null): LLMProvider {
  return {
    complete: () => (async function* () {})(),
    embed: async () => [],
    ping: async () => true,
    showModel: async () => ({ contextLength: ctx }),
  };
}

describe("getModelContextWindow", () => {
  beforeEach(() => _resetModelContextCache());

  it("returns the reported context length", async () => {
    const p = makeProvider(32768);
    expect(await getModelContextWindow(p, "m")).toBe(32768);
  });

  it("falls back when null", async () => {
    const p = makeProvider(null);
    expect(await getModelContextWindow(p, "m")).toBe(FALLBACK_CONTEXT_WINDOW);
  });

  it("caches per model (showModel called once)", async () => {
    const show = vi.fn(async () => ({ contextLength: 4096 }));
    const p: LLMProvider = {
      complete: () => (async function* () {})(),
      embed: async () => [],
      ping: async () => true,
      showModel: show,
    };
    await getModelContextWindow(p, "m");
    await getModelContextWindow(p, "m");
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("uses fallback when provider does not implement showModel", async () => {
    const p: LLMProvider = {
      complete: () => (async function* () {})(),
      embed: async () => [],
      ping: async () => true,
    };
    expect(await getModelContextWindow(p, "m")).toBe(FALLBACK_CONTEXT_WINDOW);
  });
});
```

- [ ] **Step 6: Run — expect fail.**

- [ ] **Step 7: Implement**

```ts
// src/chat/model-context.ts
import type { LLMProvider } from "../llm/provider.js";

export const FALLBACK_CONTEXT_WINDOW = 4096;

const cache = new Map<string, number>();

export function _resetModelContextCache(): void {
  cache.clear();
}

export async function getModelContextWindow(
  provider: LLMProvider,
  model: string,
): Promise<number> {
  const hit = cache.get(model);
  if (hit !== undefined) return hit;
  if (!provider.showModel) {
    cache.set(model, FALLBACK_CONTEXT_WINDOW);
    return FALLBACK_CONTEXT_WINDOW;
  }
  try {
    const { contextLength } = await provider.showModel(model);
    const value = contextLength ?? FALLBACK_CONTEXT_WINDOW;
    cache.set(model, value);
    return value;
  } catch {
    cache.set(model, FALLBACK_CONTEXT_WINDOW);
    return FALLBACK_CONTEXT_WINDOW;
  }
}
```

- [ ] **Step 8: Run — expect pass.**

- [ ] **Step 9: Commit**

```bash
git add src/llm/provider.ts src/llm/ollama.ts src/chat/model-context.ts \
        tests/llm/ollama-show.test.ts tests/chat/model-context.test.ts
git commit -m "feat(llm): discover model context window via /api/show with fallback"
```

---

## Task 5: History token budget

**Files:**
- Create: `src/chat/history-budget.ts`
- Test: `tests/chat/history-budget.test.ts`

**Design:** Simple char-based token approximation — `tokens ≈ chars / 4`. Budget is `contextWindow − reservedForSystemPlusContextPlusAnswer`. Drop oldest turns until the rest fits. Returns the turns array (newest-preserving).

- [ ] **Step 1: Write failing tests**

```ts
// tests/chat/history-budget.test.ts
import { describe, it, expect } from "vitest";
import {
  budgetHistory,
  approximateTokens,
} from "../../src/chat/history-budget.js";
import type { ChatTurn } from "../../src/chat/types.js";

const turn = (q: string, a: string): ChatTurn => ({
  question: q,
  answer: a,
  sourceIds: [],
  rewrittenQuery: null,
  createdAt: 0,
});

describe("approximateTokens", () => {
  it("is ceil(chars/4)", () => {
    expect(approximateTokens("")).toBe(0);
    expect(approximateTokens("abcd")).toBe(1);
    expect(approximateTokens("abcde")).toBe(2);
  });
});

describe("budgetHistory", () => {
  it("keeps all turns when within budget", () => {
    const turns = [turn("a", "b"), turn("c", "d")];
    expect(budgetHistory(turns, { availableTokens: 1000 })).toEqual(turns);
  });

  it("drops oldest first until under budget", () => {
    const turns = [
      turn("a".repeat(400), "b".repeat(400)), // ~200 tokens
      turn("c".repeat(400), "d".repeat(400)),
      turn("e".repeat(400), "f".repeat(400)),
    ];
    const kept = budgetHistory(turns, { availableTokens: 300 });
    expect(kept).toEqual([turns[2]]);
  });

  it("returns empty when budget is zero", () => {
    expect(budgetHistory([turn("a", "b")], { availableTokens: 0 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```ts
// src/chat/history-budget.ts
import type { ChatTurn } from "./types.js";

export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function turnTokens(t: ChatTurn): number {
  // "[user] ...\n[assistant] ...\n" framing adds a little overhead — ~6 tokens.
  return approximateTokens(t.question) + approximateTokens(t.answer) + 6;
}

export interface BudgetOptions {
  /** Tokens available for history (i.e. context window minus everything else). */
  availableTokens: number;
}

/** Returns the newest-preserving subset of `turns` that fits into the budget. */
export function budgetHistory(
  turns: readonly ChatTurn[],
  opts: BudgetOptions,
): ChatTurn[] {
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turnTokens(turns[i]!);
    if (used + cost > opts.availableTokens) break;
    kept.unshift(turns[i]!);
    used += cost;
  }
  return kept;
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/chat/history-budget.ts tests/chat/history-budget.test.ts
git commit -m "feat(chat): token-based history budget with oldest-first drop"
```

---

## Task 6: Prompt builder accepts history

**Files:**
- Modify: `src/query/prompts.ts`
- Test: `tests/query/prompts.test.ts`

- [ ] **Step 1: Extend failing test**

Append to `tests/query/prompts.test.ts`:

```ts
import { buildAskPrompt } from "../../src/query/prompts.js";

describe("buildAskPrompt with history", () => {
  it("injects history between rules and context", () => {
    const out = buildAskPrompt({
      question: "and why?",
      context: "CTX",
      history: [
        { question: "what is X?", answer: "X is a thing.", sourceIds: [], rewrittenQuery: null, createdAt: 0 },
      ],
    });
    expect(out).toContain("Conversation so far:");
    expect(out).toContain("[user] what is X?");
    expect(out).toContain("[assistant] X is a thing.");
    // question still last
    expect(out.indexOf("Question: and why?")).toBeGreaterThan(out.indexOf("[assistant]"));
  });

  it("omits the history block when history is empty or missing", () => {
    expect(buildAskPrompt({ question: "q", context: "c" })).not.toContain(
      "Conversation so far:",
    );
    expect(
      buildAskPrompt({ question: "q", context: "c", history: [] }),
    ).not.toContain("Conversation so far:");
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Update `buildAskPrompt`**

```ts
// src/query/prompts.ts
import type { ChatTurn } from "../chat/types.js";

export interface BuildAskPromptArgs {
  question: string;
  context: string;
  history?: readonly ChatTurn[];
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
  "If the user refers to something from earlier in the conversation, use that context to interpret the question.",
];

export function buildAskPrompt(args: BuildAskPromptArgs): string {
  const rulesBlock = RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const parts: string[] = [
    "You answer questions using a personal knowledge base.",
    "",
    "Rules:",
    rulesBlock,
    "",
  ];
  if (args.history && args.history.length > 0) {
    parts.push("Conversation so far:");
    for (const t of args.history) {
      parts.push(`[user] ${t.question}`);
      parts.push(`[assistant] ${t.answer}`);
    }
    parts.push("");
  }
  parts.push(
    "Knowledge base context:",
    args.context,
    "",
    `Question: ${args.question}`,
    "",
    "Answer:",
  );
  return parts.join("\n");
}
```

- [ ] **Step 4: Run — expect pass. Also re-run the existing prompts tests to confirm no regression.**

Run: `npx vitest run tests/query/prompts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/query/prompts.ts tests/query/prompts.test.ts
git commit -m "feat(prompts): include prior turns in ask prompt when history is provided"
```

---

## Task 7: Follow-up query rewriter

**Files:**
- Create: `src/chat/rewrite.ts`
- Test: `tests/chat/rewrite.test.ts`

**Design:** Tiny LLM call that takes prior turns + raw follow-up, emits one standalone sentence. Collects the streamed chunks into a single string, trims, and returns. Non-streaming from the caller's POV.

- [ ] **Step 1: Write failing test**

```ts
// tests/chat/rewrite.test.ts
import { describe, it, expect, vi } from "vitest";
import { rewriteFollowUp } from "../../src/chat/rewrite.js";
import type { LLMProvider } from "../../src/llm/provider.js";
import type { ChatTurn } from "../../src/chat/types.js";

function mockProvider(response: string): LLMProvider {
  return {
    complete: ({ prompt: _prompt }) =>
      (async function* () {
        yield response;
      })(),
    embed: async () => [],
    ping: async () => true,
  };
}

const turn = (q: string, a: string): ChatTurn => ({
  question: q,
  answer: a,
  sourceIds: [],
  rewrittenQuery: null,
  createdAt: 0,
});

describe("rewriteFollowUp", () => {
  it("returns the trimmed model response", async () => {
    const p = mockProvider("  What is the runtime of the embedding index?  ");
    const out = await rewriteFollowUp({
      provider: p,
      model: "m",
      history: [turn("what is the embedding index?", "It's a cache.")],
      question: "what's its runtime?",
    });
    expect(out).toBe("What is the runtime of the embedding index?");
  });

  it("passes history and raw question into the prompt", async () => {
    const spy = vi.fn((_opts: unknown) =>
      (async function* () {
        yield "rewritten";
      })(),
    );
    const p: LLMProvider = {
      complete: spy as never,
      embed: async () => [],
      ping: async () => true,
    };
    await rewriteFollowUp({
      provider: p,
      model: "m",
      history: [turn("q1", "a1")],
      question: "and then?",
    });
    const call = (spy.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(call).toContain("q1");
    expect(call).toContain("a1");
    expect(call).toContain("and then?");
  });

  it("falls back to the raw question if the model returns empty", async () => {
    const p = mockProvider("   ");
    const out = await rewriteFollowUp({
      provider: p,
      model: "m",
      history: [turn("q", "a")],
      question: "raw",
    });
    expect(out).toBe("raw");
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```ts
// src/chat/rewrite.ts
import type { LLMProvider } from "../llm/provider.js";
import type { ChatTurn } from "./types.js";

export interface RewriteArgs {
  provider: LLMProvider;
  model: string;
  history: readonly ChatTurn[];
  question: string;
  signal?: AbortSignal;
}

function buildRewritePrompt(history: readonly ChatTurn[], question: string): string {
  const lines: string[] = [
    "Rewrite the user's latest question into a single standalone sentence that can be understood without the prior conversation.",
    "Resolve pronouns and implied subjects using the conversation below.",
    "Output ONLY the rewritten question, no preamble, no quotes, no explanation.",
    "",
    "Conversation:",
  ];
  for (const t of history) {
    lines.push(`[user] ${t.question}`);
    lines.push(`[assistant] ${t.answer}`);
  }
  lines.push("", `Latest question: ${question}`, "", "Standalone question:");
  return lines.join("\n");
}

export async function rewriteFollowUp(args: RewriteArgs): Promise<string> {
  const prompt = buildRewritePrompt(args.history, args.question);
  let out = "";
  for await (const chunk of args.provider.complete({
    prompt,
    model: args.model,
    temperature: 0.1,
    signal: args.signal,
  })) {
    out += chunk;
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : args.question;
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/chat/rewrite.ts tests/chat/rewrite.test.ts
git commit -m "feat(chat): LLM rewrite of follow-up questions into standalone form"
```

---

## Task 8: Title generator

**Files:**
- Create: `src/chat/title.ts`
- Test: `tests/chat/title.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/chat/title.test.ts
import { describe, it, expect } from "vitest";
import { generateChatTitle } from "../../src/chat/title.js";
import type { LLMProvider } from "../../src/llm/provider.js";

function mockProvider(response: string): LLMProvider {
  return {
    complete: () =>
      (async function* () {
        yield response;
      })(),
    embed: async () => [],
    ping: async () => true,
  };
}

describe("generateChatTitle", () => {
  it("returns a trimmed ≤6-word title", async () => {
    const p = mockProvider("Embedding Index Runtime Details");
    const out = await generateChatTitle({
      provider: p,
      model: "m",
      firstTurn: { question: "q", answer: "a", sourceIds: [], rewrittenQuery: null, createdAt: 0 },
    });
    expect(out).toBe("Embedding Index Runtime Details");
  });

  it("truncates to 6 words when the model over-produces", async () => {
    const p = mockProvider("one two three four five six seven eight");
    const out = await generateChatTitle({
      provider: p,
      model: "m",
      firstTurn: { question: "q", answer: "a", sourceIds: [], rewrittenQuery: null, createdAt: 0 },
    });
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(6);
  });

  it("strips surrounding quotes and trailing punctuation", async () => {
    const p = mockProvider('"Hello World."');
    const out = await generateChatTitle({
      provider: p,
      model: "m",
      firstTurn: { question: "q", answer: "a", sourceIds: [], rewrittenQuery: null, createdAt: 0 },
    });
    expect(out).toBe("Hello World");
  });

  it("falls back to 'Untitled' on empty model output", async () => {
    const p = mockProvider("");
    const out = await generateChatTitle({
      provider: p,
      model: "m",
      firstTurn: { question: "q", answer: "a", sourceIds: [], rewrittenQuery: null, createdAt: 0 },
    });
    expect(out).toBe("Untitled");
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```ts
// src/chat/title.ts
import type { LLMProvider } from "../llm/provider.js";
import type { ChatTurn } from "./types.js";

export interface TitleArgs {
  provider: LLMProvider;
  model: string;
  firstTurn: ChatTurn;
  signal?: AbortSignal;
}

export async function generateChatTitle(args: TitleArgs): Promise<string> {
  const prompt = [
    "Summarize this Q&A as a short chat title of at most 6 words.",
    "Output only the title. No quotes, no trailing punctuation, no preamble.",
    "",
    `Q: ${args.firstTurn.question}`,
    `A: ${args.firstTurn.answer}`,
    "",
    "Title:",
  ].join("\n");

  let out = "";
  try {
    for await (const chunk of args.provider.complete({
      prompt,
      model: args.model,
      temperature: 0.2,
      signal: args.signal,
    })) {
      out += chunk;
    }
  } catch {
    return "Untitled";
  }

  let t = out.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/[.!?]+$/g, "").trim();
  if (t.length === 0) return "Untitled";
  const words = t.split(/\s+/);
  if (words.length > 6) t = words.slice(0, 6).join(" ");
  return t;
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/chat/title.ts tests/chat/title.test.ts
git commit -m "feat(chat): LLM-generated ≤6-word chat titles from first turn"
```

---

## Task 9: `ask()` accepts history

**Files:**
- Modify: `src/query/ask.ts`
- Test: `tests/query/ask.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/query/ask.test.ts`:

```ts
describe("ask with history", () => {
  it("passes history into the prompt builder", async () => {
    // Use existing test harness pattern in this file — fake provider captures
    // the prompt and returns a fixed chunk. The assertion is that the prompt
    // contains the [user]/[assistant] framing for the prior turn.
    // (Use the same provider mocking style the surrounding tests already use.)
  });
});
```

> Note to implementer: this file already has a pattern for mocking a provider and retrieval. Mirror it — do not invent a new harness. Drop the TODO comment after filling in the test using the existing helpers.

- [ ] **Step 2: Implement `ask` change**

```ts
// src/query/ask.ts — add to AskArgs
import type { ChatTurn } from "../chat/types.js";

export interface AskArgs {
  question: string;
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folder?: string;
  embeddingIndex?: ReadonlyMap<string, number[]>;
  queryEmbedding?: number[] | null;
  history?: readonly ChatTurn[];
  signal?: AbortSignal;
}
```

And pass history through:

```ts
    const prompt = buildAskPrompt({
      question: args.question,
      context,
      history: args.history,
    });
```

- [ ] **Step 3: Run ask tests — expect pass. No existing tests should regress because history is optional.**

Run: `npx vitest run tests/query/ask.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/query/ask.ts tests/query/ask.test.ts
git commit -m "feat(ask): thread chat history through to the prompt builder"
```

---

## Task 10: QueryController gains a chat-turn path

**Files:**
- Modify: `src/ui/modal/query-controller.ts`
- Test: `tests/ui/modal/query-controller.test.ts` (extend or create)

**Design:** Add a new public method `runChatTurn({chat, question})` that:
1. If `chat.turns.length === 0`, uses `question` as-is.
2. Otherwise, calls `rewriteFollowUp` to get a standalone query.
3. Calls `getModelContextWindow(provider, model)`, subtracts a fixed reserve (`RESERVE_TOKENS = 2048`), then calls `budgetHistory` to pick the history subset.
4. Streams via `ask()` passing `question: standaloneQuery` and `history: budgetedHistory`.
5. Emits existing state/context/chunk events unchanged so the modal keeps working.

The `run(question)` method stays for backwards compat but becomes a thin wrapper that calls `runChatTurn` with an empty-turns chat. The internal `ask` call uses the **original** `question` for the prompt's "Question:" line (so the user's raw phrasing still appears), but the **rewritten** query for retrieval. That means `ask()` needs to accept a separate retrieval query. Simplest path: add an optional `retrievalQuery` on `AskArgs`; if present, use it in `retrieve()`, otherwise use `question`.

**Sub-step:** update `ask()` first, then the controller.

- [ ] **Step 1: Failing test — ask() honors `retrievalQuery`**

Append to `tests/query/ask.test.ts`:

```ts
it("uses retrievalQuery for retrieval but question for the prompt", async () => {
  // Mirror the existing ask test harness: capture what retrieve() sees,
  // and what prompt buildAskPrompt produced.
});
```

- [ ] **Step 2: Update `src/query/ask.ts`**

```ts
export interface AskArgs {
  question: string;
  /** If set, used for retrieval. If not, `question` is used. */
  retrievalQuery?: string;
  // ...existing fields
}
```

```ts
    const retrieveArgs: RetrieveArgs = {
      question: args.retrievalQuery ?? args.question,
      kb: args.kb,
      folder: args.folder,
      embeddingIndex: args.embeddingIndex,
      queryEmbedding: args.queryEmbedding,
    };
```

- [ ] **Step 3: Run — expect pass.**

- [ ] **Step 4: Update `QueryController`**

```ts
// src/ui/modal/query-controller.ts
import type { Chat } from "../../chat/types.js";
import { rewriteFollowUp } from "../../chat/rewrite.js";
import { getModelContextWindow } from "../../chat/model-context.js";
import { budgetHistory } from "../../chat/history-budget.js";

const RESERVE_TOKENS = 2048;

export interface RunChatTurnArgs {
  chat: Chat;
  question: string;
}

// Inside QueryController:
async runChatTurn(args: RunChatTurnArgs): Promise<void> {
  this.abortCtrl = new AbortController();
  this.transition("loading");

  try {
    const isFollowUp = args.chat.turns.length > 0;
    const retrievalQuery = isFollowUp
      ? await rewriteFollowUp({
          provider: this.opts.provider,
          model: this.opts.model,
          history: args.chat.turns,
          question: args.question,
          signal: this.abortCtrl.signal,
        })
      : args.question;

    const ctx = await getModelContextWindow(this.opts.provider, this.opts.model);
    const history = budgetHistory(args.chat.turns, {
      availableTokens: Math.max(0, ctx - RESERVE_TOKENS),
    });

    for await (const ev of ask({
      question: args.question,
      retrievalQuery,
      history,
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
```

Also expose the rewritten query to the caller — add an optional callback `onRetrievalQuery?: (q: string) => void` to `QueryControllerOptions` so the modal can store `rewrittenQuery` on the turn. Call it right after the rewrite (or with `args.question` for turn 1).

- [ ] **Step 5: Write controller test covering turn 1 (no rewrite) and turn 2 (rewrite invoked)**

```ts
// tests/ui/modal/query-controller.test.ts — new cases
// Use fakes for provider/kb. Assert:
//  - turn 1: provider.complete called once (the main ask), not twice
//  - turn 2: provider.complete called twice (rewrite + ask), and the second
//    call's prompt contains the rewritten query text
```

- [ ] **Step 6: Run — expect pass.**

- [ ] **Step 7: Commit**

```bash
git add src/ui/modal/query-controller.ts src/query/ask.ts \
        tests/ui/modal/query-controller.test.ts tests/query/ask.test.ts
git commit -m "feat(chat): QueryController.runChatTurn with rewrite and budgeted history"
```

---

## Task 11: Transcript renderer

**Files:**
- Create: `src/ui/modal/chat-transcript.ts`
- Test: `tests/ui/modal/chat-transcript.test.ts`

**Design:** `class ChatTranscript` owns a root `HTMLDivElement`. API:
- `renderChat(chat: Chat): void` — replaces transcript with all prior turns.
- `beginTurn(question: string): TurnHandle` — appends a new turn block and returns a handle:
  - `handle.appendAnswerChunk(text)`
  - `handle.setSources(sourceIds: string[])`
  - `handle.finalize()`
- `clear(): void`

Renders each turn as: `<div class="turn"><div class="turn-q">…</div><div class="turn-a">…</div><details class="turn-sources"><summary>Sources used (N)</summary><ul>…</ul></details></div>`. Markdown in answers is rendered through the same `MarkdownRenderer` the current modal uses — accept a `renderMarkdown(el, md)` callback so tests can stub it.

- [ ] **Step 1: Write failing test**

```ts
// tests/ui/modal/chat-transcript.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { ChatTranscript } from "../../../src/ui/modal/chat-transcript.js";
import { createChat, appendTurn } from "../../../src/chat/store.js";

const renderMarkdown = (el: HTMLElement, md: string): void => {
  el.textContent = md;
};

describe("ChatTranscript", () => {
  it("renders all turns of a chat", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    let chat = createChat({ id: "a", now: 0, folder: "", model: "m" });
    chat = appendTurn(
      chat,
      { question: "q1", answer: "a1", sourceIds: ["x.md"], rewrittenQuery: null, createdAt: 1 },
      1,
    );
    t.renderChat(chat);
    expect(root.querySelectorAll(".turn")).toHaveLength(1);
    expect(root.querySelector(".turn-q")?.textContent).toBe("q1");
    expect(root.querySelector(".turn-a")?.textContent).toBe("a1");
    expect(root.querySelector(".turn-sources summary")?.textContent).toBe(
      "Sources used (1)",
    );
  });

  it("streams an answer via beginTurn → appendAnswerChunk", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    const h = t.beginTurn("hello?");
    h.appendAnswerChunk("Hi");
    h.appendAnswerChunk(" there");
    h.setSources(["a.md", "b.md"]);
    h.finalize();
    expect(root.querySelector(".turn-q")?.textContent).toBe("hello?");
    expect(root.querySelector(".turn-a")?.textContent).toBe("Hi there");
    expect(root.querySelector(".turn-sources summary")?.textContent).toBe(
      "Sources used (2)",
    );
  });

  it("clear() empties the transcript", () => {
    const root = document.createElement("div");
    const t = new ChatTranscript(root, { renderMarkdown });
    t.beginTurn("q").finalize();
    t.clear();
    expect(root.querySelectorAll(".turn")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```ts
// src/ui/modal/chat-transcript.ts
import type { Chat } from "../../chat/types.js";

export interface ChatTranscriptOptions {
  renderMarkdown: (el: HTMLElement, md: string) => void;
}

export interface TurnHandle {
  appendAnswerChunk(text: string): void;
  setSources(sourceIds: readonly string[]): void;
  finalize(): void;
}

export class ChatTranscript {
  constructor(
    private readonly root: HTMLElement,
    private readonly opts: ChatTranscriptOptions,
  ) {}

  clear(): void {
    this.root.empty?.();
    if (!("empty" in this.root)) this.root.innerHTML = "";
  }

  renderChat(chat: Chat): void {
    this.clear();
    for (const t of chat.turns) {
      const turnEl = this.appendTurnBlock(t.question);
      this.opts.renderMarkdown(turnEl.answerEl, t.answer);
      this.fillSources(turnEl.sourcesEl, t.sourceIds);
    }
    this.scrollToBottom();
  }

  beginTurn(question: string): TurnHandle {
    const { answerEl, sourcesEl } = this.appendTurnBlock(question);
    let buffer = "";
    const h: TurnHandle = {
      appendAnswerChunk: (text) => {
        buffer += text;
        this.opts.renderMarkdown(answerEl, buffer);
        this.scrollToBottom();
      },
      setSources: (ids) => this.fillSources(sourcesEl, ids),
      finalize: () => {
        this.scrollToBottom();
      },
    };
    return h;
  }

  private appendTurnBlock(question: string): {
    answerEl: HTMLDivElement;
    sourcesEl: HTMLDetailsElement;
  } {
    const turn = document.createElement("div");
    turn.className = "turn";
    const q = document.createElement("div");
    q.className = "turn-q";
    q.textContent = question;
    const a = document.createElement("div");
    a.className = "turn-a";
    const s = document.createElement("details");
    s.className = "turn-sources";
    const summary = document.createElement("summary");
    summary.textContent = "Sources used (0)";
    s.appendChild(summary);
    turn.append(q, a, s);
    this.root.appendChild(turn);
    return { answerEl: a, sourcesEl: s };
  }

  private fillSources(
    details: HTMLDetailsElement,
    ids: readonly string[],
  ): void {
    const summary = details.querySelector("summary");
    if (summary) summary.textContent = `Sources used (${ids.length})`;
    details.querySelector("ul")?.remove();
    if (ids.length > 0) {
      const ul = document.createElement("ul");
      for (const id of ids) {
        const li = document.createElement("li");
        li.textContent = id;
        ul.appendChild(li);
      }
      details.appendChild(ul);
    }
  }

  private scrollToBottom(): void {
    this.root.scrollTop = this.root.scrollHeight;
  }
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/ui/modal/chat-transcript.ts tests/ui/modal/chat-transcript.test.ts
git commit -m "feat(ui): ChatTranscript renders multi-turn conversations with streaming"
```

---

## Task 12: Chat list (under input) with rename / delete

**Files:**
- Create: `src/ui/modal/chat-list.ts`
- Test: `tests/ui/modal/chat-list.test.ts`

**Design:** `class ChatList` owns a root div. API:
- `render(chats: Chat[], selectedId: string | null)`
- Callbacks on construction:
  - `onPick(chatId)`
  - `onRename(chatId, newTitle)`
  - `onDelete(chatId)`
- Keyboard nav (↑/↓) exposed via `moveSelection(delta)` and `getSelectedId()` for the modal to wire.
- Each row: `<div class="chat-row"><span class="chat-title">{title}</span><button class="rename">…</button><button class="delete">…</button></div>` — buttons only visible on `:hover` or `.is-selected` via CSS.
- Rename: button click swaps the title span for an `<input>`, commits on Enter/blur, reverts on Escape.

- [ ] **Step 1: Write failing tests**

```ts
// tests/ui/modal/chat-list.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { ChatList } from "../../../src/ui/modal/chat-list.js";
import { createChat } from "../../../src/chat/store.js";

function mk(id: string, title: string, updatedAt: number) {
  return { ...createChat({ id, now: 0, folder: "", model: "m" }), title, updatedAt };
}

describe("ChatList", () => {
  it("renders one row per chat, newest first", () => {
    const root = document.createElement("div");
    const list = new ChatList(root, { onPick: () => {}, onRename: () => {}, onDelete: () => {} });
    list.render([mk("a", "A", 1), mk("b", "B", 5)], null);
    const titles = [...root.querySelectorAll(".chat-title")].map((e) => e.textContent);
    expect(titles).toEqual(["B", "A"]);
  });

  it("fires onPick when a row is clicked", () => {
    const root = document.createElement("div");
    const onPick = vi.fn();
    const list = new ChatList(root, { onPick, onRename: () => {}, onDelete: () => {} });
    list.render([mk("a", "A", 1)], null);
    (root.querySelector(".chat-row") as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith("a");
  });

  it("fires onDelete when the delete button is clicked", () => {
    const root = document.createElement("div");
    const onDelete = vi.fn();
    const list = new ChatList(root, { onPick: () => {}, onRename: () => {}, onDelete });
    list.render([mk("a", "A", 1)], null);
    (root.querySelector(".chat-row .delete") as HTMLElement).click();
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("rename flow: click → input → Enter commits via onRename", () => {
    const root = document.createElement("div");
    const onRename = vi.fn();
    const list = new ChatList(root, { onPick: () => {}, onRename, onDelete: () => {} });
    list.render([mk("a", "A", 1)], null);
    (root.querySelector(".chat-row .rename") as HTMLElement).click();
    const input = root.querySelector(".chat-row input") as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "New title";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onRename).toHaveBeenCalledWith("a", "New title");
  });

  it("moveSelection steps through rows", () => {
    const root = document.createElement("div");
    const list = new ChatList(root, { onPick: () => {}, onRename: () => {}, onDelete: () => {} });
    list.render([mk("a", "A", 2), mk("b", "B", 1)], null);
    list.moveSelection(1);
    expect(list.getSelectedId()).toBe("a");
    list.moveSelection(1);
    expect(list.getSelectedId()).toBe("b");
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```ts
// src/ui/modal/chat-list.ts
import type { Chat } from "../../chat/types.js";
import { sortChatsByRecency } from "../../chat/store.js";

export interface ChatListCallbacks {
  onPick(chatId: string): void;
  onRename(chatId: string, newTitle: string): void;
  onDelete(chatId: string): void;
}

export class ChatList {
  private chats: Chat[] = [];
  private selectedIdx = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: ChatListCallbacks,
  ) {}

  render(chats: readonly Chat[], selectedId: string | null): void {
    this.chats = sortChatsByRecency(chats);
    this.selectedIdx = selectedId
      ? this.chats.findIndex((c) => c.id === selectedId)
      : -1;
    this.root.innerHTML = "";
    this.chats.forEach((c, i) => this.root.appendChild(this.buildRow(c, i)));
  }

  getSelectedId(): string | null {
    return this.selectedIdx >= 0 ? (this.chats[this.selectedIdx]?.id ?? null) : null;
  }

  moveSelection(delta: number): void {
    if (this.chats.length === 0) return;
    const next =
      this.selectedIdx === -1
        ? delta > 0
          ? 0
          : this.chats.length - 1
        : this.selectedIdx + delta;
    if (next < 0 || next >= this.chats.length) return;
    this.selectedIdx = next;
    this.refreshHighlight();
  }

  private buildRow(chat: Chat, idx: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "chat-row";
    if (idx === this.selectedIdx) row.classList.add("is-selected");
    row.dataset.id = chat.id;

    const title = document.createElement("span");
    title.className = "chat-title";
    title.textContent = chat.title;
    row.appendChild(title);

    const rename = document.createElement("button");
    rename.className = "rename";
    rename.type = "button";
    rename.setAttribute("aria-label", "Rename chat");
    rename.textContent = "✎";
    row.appendChild(rename);

    const del = document.createElement("button");
    del.className = "delete";
    del.type = "button";
    del.setAttribute("aria-label", "Delete chat");
    del.textContent = "×";
    row.appendChild(del);

    row.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".rename") || target.closest(".delete") || target.tagName === "INPUT") return;
      this.cb.onPick(chat.id);
    });

    rename.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.startRename(row, chat);
    });

    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.cb.onDelete(chat.id);
    });

    return row;
  }

  private startRename(row: HTMLElement, chat: Chat): void {
    const titleEl = row.querySelector(".chat-title") as HTMLElement;
    const input = document.createElement("input");
    input.type = "text";
    input.value = chat.title;
    row.replaceChild(input, titleEl);
    input.focus();
    input.select();

    const commit = (): void => {
      const v = input.value.trim();
      if (v.length > 0 && v !== chat.title) this.cb.onRename(chat.id, v);
      // Re-render will happen via the modal's store update + render() call.
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        row.replaceChild(titleEl, input);
      }
    });
    input.addEventListener("blur", commit);
  }

  private refreshHighlight(): void {
    [...this.root.querySelectorAll(".chat-row")].forEach((el, i) =>
      el.classList.toggle("is-selected", i === this.selectedIdx),
    );
  }
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/ui/modal/chat-list.ts tests/ui/modal/chat-list.test.ts
git commit -m "feat(ui): ChatList with pick, rename, delete, and keyboard nav"
```

---

## Task 13: Rewire `QueryModal` to chat mode

**Files:**
- Modify: `src/ui/modal/query-modal.ts`
- Test: existing query-modal tests if any — add minimal smoke coverage of chat wiring.

**Design changes:**
- Constructor args: replace `recentQuestions: string[]` with `chats: Chat[]`, add `activeChatId: string | null`. Add `onChatsChanged(chats: Chat[])` callback fired whenever the modal mutates the store (append turn, rename, delete, new chat).
- Replace `recentsEl` and its rendering with `ChatList`. Replace `answerEl`/`sourcesEl` with `ChatTranscript`.
- Submit flow:
  1. Resolve `activeChat` (existing chat-in-progress, or a fresh one created on first submit).
  2. `transcript.beginTurn(question)` → `handle`.
  3. `controller.runChatTurn({chat: activeChat, question})`.
  4. On `onChunk`, `handle.appendAnswerChunk`.
  5. On `onContext`, `handle.setSources(bundle.sources.map(s => s.id))`.
  6. On `done`, append the turn to the chat via `appendTurn`, fire `onChatsChanged`, and if it was turn 1 kick off `generateChatTitle` in the background; when it resolves, call `updateChatTitle` + `onChatsChanged` again.
- Clicking a row in `ChatList`: set `activeChatId`, `transcript.renderChat(chat)`, focus the input.
- Rename/delete flow: mutate chats locally, call `onChatsChanged`, re-render list. If the deleted chat was active, reset transcript and `activeChatId = null`.

- [ ] **Step 1: Update constructor + state wiring** (no tests here — smoke tested via plugin wiring in Task 14).

Follow the design above. Important details:
- **Pills row:** unchanged except the model pill now also shows the active chat's title if present (`title · model: X`). If no active chat, show `model: X` as before.
- **Keyboard nav:** ↑/↓ still drives the list, but now via `ChatList.moveSelection` + Enter resumes (instead of filling the input with a past question).
- **"New chat" behavior without a button:** typing in the input while a chat is active keeps appending to that chat. To start a new chat, user presses Escape to close and reopens — the default on reopen is *no* active chat (empty transcript, input focused).

Key code sketch — replace the existing `this.recentsEl` construction block with:

```ts
const listRoot = contentEl.createDiv({ cls: "llm-wiki-chat-list" });
this.chatList = new ChatList(listRoot, {
  onPick: (id) => this.pickChat(id),
  onRename: (id, t) => this.handleRename(id, t),
  onDelete: (id) => this.handleDelete(id),
});
this.chatList.render(this.chats, this.activeChatId);
```

Replace `this.answerEl = ...` and `this.sourcesEl = ...` construction with:

```ts
const transcriptRoot = contentEl.createDiv({ cls: "llm-wiki-chat-transcript" });
this.transcript = new ChatTranscript(transcriptRoot, {
  renderMarkdown: (el, md) => {
    el.empty();
    void MarkdownRenderer.render(this.app, md, el, "", this.mdComponent);
  },
});
if (this.activeChatId) {
  const active = this.chats.find((c) => c.id === this.activeChatId);
  if (active) this.transcript.renderChat(active);
}
```

Submit:

```ts
private submit(): void {
  if (!this.controller) return;
  const q = this.inputEl.value.trim();
  if (!q) return;

  const active = this.ensureActiveChat();
  const handle = this.transcript.beginTurn(q);
  let streamedAnswer = "";
  let sourceIds: string[] = [];

  // Per-submission callbacks override the controller callbacks we set at construction.
  // Easiest: the controller already exposes onContext/onChunk/onState via ctor opts.
  // Stash per-submit locals and use them inside those callbacks via `this`.
  this.currentHandle = handle;
  this.currentStreamedAnswer = "";
  this.currentSourceIds = [];
  this.startMs = Date.now();
  this.firstChunkMs = 0;

  void this.controller.runChatTurn({ chat: active, question: q });
  this.inputEl.value = "";
  this.updateClearVisibility();
}
```

In the callbacks passed to `buildQueryController` (Task 10 modified the controller to keep those same callbacks):

```ts
onChunk: (t) => {
  if (!this.currentHandle) return;
  if (this.firstChunkMs === 0) this.firstChunkMs = Date.now();
  this.currentStreamedAnswer += t;
  this.currentHandle.appendAnswerChunk(t);
},
onContext: (bundle) => {
  this.currentSourceIds = bundle.sources.map((s) => s.id);
  this.currentHandle?.setSources(this.currentSourceIds);
  this.currentBundle = bundle;
},
onState: (s) => {
  this.applyState(s);
  if (s === "done") void this.finalizeTurn();
},
```

`finalizeTurn`:

```ts
private async finalizeTurn(): Promise<void> {
  if (!this.activeChatId || !this.currentHandle) return;
  const active = this.chats.find((c) => c.id === this.activeChatId);
  if (!active) return;
  const isFirstTurn = active.turns.length === 0;
  const turn = {
    question: this.lastSubmittedQuestion,
    answer: this.currentStreamedAnswer,
    sourceIds: this.currentSourceIds,
    rewrittenQuery: this.currentRewrittenQuery,
    createdAt: Date.now(),
  };
  const updated = appendTurn(active, turn, Date.now());
  this.chats = this.chats.map((c) => (c.id === updated.id ? updated : c));
  this.args.onChatsChanged(this.chats);
  this.chatList.render(this.chats, this.activeChatId);
  this.currentHandle.finalize();
  this.currentHandle = null;

  if (isFirstTurn) {
    void this.runTitleGeneration(updated);
  }
}

private async runTitleGeneration(chat: Chat): Promise<void> {
  const title = await generateChatTitle({
    provider: this.args.provider,
    model: this.args.model,
    firstTurn: chat.turns[0]!,
  });
  const titled = updateChatTitle(chat, title, Date.now());
  this.chats = this.chats.map((c) => (c.id === titled.id ? titled : c));
  this.args.onChatsChanged(this.chats);
  this.chatList.render(this.chats, this.activeChatId);
}
```

Add necessary fields: `lastSubmittedQuestion`, `currentHandle`, `currentStreamedAnswer`, `currentSourceIds`, `currentRewrittenQuery`, `chats`, `activeChatId`, `chatList`, `transcript`. Remove `recents`, `recentItemEls`, `recentsEl`, `selectedRecentIdx`, and their methods.

Capture the rewritten query by setting `onRetrievalQuery: (q) => (this.currentRewrittenQuery = q)` on the controller (added in Task 10).

- [ ] **Step 2: Remove recents-related code entirely**

Delete from `query-modal.ts`: `MAX_RECENTS_DISPLAYED`, `recents`, `recentsEl`, `recentItemEls`, `selectedRecentIdx`, `moveRecentSelection`, `refreshRecentHighlight`, `clearRecentSelection`. Arrow-key handling now calls `this.chatList.moveSelection`; Enter on a selected row calls `pickChat`.

- [ ] **Step 3: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (may require small adjustments — fix inline).

- [ ] **Step 4: Commit**

```bash
git add src/ui/modal/query-modal.ts
git commit -m "feat(ui): QueryModal drives ChatList + ChatTranscript end-to-end"
```

---

## Task 14: Plugin wiring — replace `recent-questions` with chat store

**Files:**
- Modify: `src/plugin.ts`
- Delete: `src/vault/recent-questions.ts`, `tests/vault/recent-questions.test.ts`

- [ ] **Step 1: Add chat loading on `onload`**

Replace:

```ts
this.recentQuestions = await loadRecentQuestions(this.app);
```

with:

```ts
this.chats = await loadChats(this.app);
```

Add field: `private chats: Chat[] = [];`. Remove `private recentQuestions: string[] = [];`.

- [ ] **Step 2: Update `openQueryModal`**

```ts
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
    chats: this.chats,
    activeChatId: null,
    indexController: this.embeddingIndexController,
    onChatsChanged: (chats): void => {
      this.chats = chats;
      void saveChats(this.app, this.chats);
    },
    onAnswered: ({ question, answer, bundle, elapsedMs }): void => {
      void appendInteractionLog(this.app, {
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

- [ ] **Step 3: Remove recent-questions imports**

Delete these lines from `plugin.ts`:

```ts
import {
  loadRecentQuestions,
  saveRecentQuestions,
  pushRecentQuestion,
} from "./vault/recent-questions.js";
```

Replace with:

```ts
import { loadChats, saveChats } from "./chat/persistence.js";
import type { Chat } from "./chat/types.js";
```

- [ ] **Step 4: Delete recent-questions files**

```bash
git rm src/vault/recent-questions.ts tests/vault/recent-questions.test.ts
```

- [ ] **Step 5: Remove `recentQuestionCount` from settings**

In `LlmWikiSettings` and `DEFAULT_SETTINGS`, delete the `recentQuestionCount` field. Delete its control from `src/ui/settings/query-section.ts` — grep the file first to find the exact block:

```bash
grep -n recentQuestionCount src/ui/settings/query-section.ts
```

Remove the matching setting definition and any helper text referring to recent questions.

- [ ] **Step 6: Typecheck + full tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Any reference to the deleted helpers = fix at call site.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(plugin): replace recent-questions store with chats.json"
```

---

## Task 15: Chat id generator

**Files:**
- Modify: `src/chat/store.ts` or create `src/chat/id.ts`
- Wire into `QueryModal.ensureActiveChat`

**Design:** Simple `generateChatId()` using `crypto.randomUUID()` with a `Date.now()`-based fallback for environments where `crypto` is absent. Called from `QueryModal.ensureActiveChat` when there's no active chat yet.

- [ ] **Step 1: Test**

```ts
// tests/chat/id.test.ts
import { describe, it, expect } from "vitest";
import { generateChatId } from "../../src/chat/id.js";

describe("generateChatId", () => {
  it("returns a non-empty string", () => {
    expect(generateChatId().length).toBeGreaterThan(0);
  });
  it("returns unique values across calls", () => {
    const a = generateChatId();
    const b = generateChatId();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/chat/id.ts
export function generateChatId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
```

- [ ] **Step 3: Wire into `QueryModal`**

```ts
// src/ui/modal/query-modal.ts
import { generateChatId } from "../../chat/id.js";
import { createChat } from "../../chat/store.js";

private ensureActiveChat(): Chat {
  if (this.activeChatId) {
    const existing = this.chats.find((c) => c.id === this.activeChatId);
    if (existing) return existing;
  }
  const now = Date.now();
  const fresh = createChat({
    id: generateChatId(),
    now,
    folder: this.args.folder,
    model: this.args.model,
  });
  this.chats = [fresh, ...this.chats];
  this.activeChatId = fresh.id;
  this.args.onChatsChanged(this.chats);
  this.chatList.render(this.chats, this.activeChatId);
  return fresh;
}
```

- [ ] **Step 4: Test + commit**

```bash
npx vitest run tests/chat/id.test.ts
git add src/chat/id.ts tests/chat/id.test.ts src/ui/modal/query-modal.ts
git commit -m "feat(chat): id generator and ensureActiveChat wiring in modal"
```

---

## Task 16: Minimal CSS for transcript and chat list

**Files:**
- Modify: `styles.css`

**Design:** Keep it minimal — match existing `llm-wiki-query-*` aesthetic.

- [ ] **Step 1: Append styles**

```css
/* Chat transcript */
.llm-wiki-chat-transcript {
  max-height: 50vh;
  overflow-y: auto;
  margin-top: 0.5rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
}
.llm-wiki-chat-transcript:empty {
  display: none;
}
.llm-wiki-chat-transcript .turn {
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--background-modifier-border);
}
.llm-wiki-chat-transcript .turn:last-child { border-bottom: none; }
.llm-wiki-chat-transcript .turn-q {
  font-weight: 600;
  margin-bottom: 0.25rem;
}
.llm-wiki-chat-transcript .turn-a { margin-bottom: 0.25rem; }
.llm-wiki-chat-transcript .turn-sources { font-size: 0.85em; opacity: 0.8; }

/* Chat list */
.llm-wiki-chat-list { margin-top: 0.5rem; }
.llm-wiki-chat-list .chat-row {
  display: flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
}
.llm-wiki-chat-list .chat-row:hover,
.llm-wiki-chat-list .chat-row.is-selected {
  background: var(--background-modifier-hover);
}
.llm-wiki-chat-list .chat-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.llm-wiki-chat-list .rename,
.llm-wiki-chat-list .delete {
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0;
  padding: 0 0.25rem;
  color: var(--text-muted);
}
.llm-wiki-chat-list .chat-row:hover .rename,
.llm-wiki-chat-list .chat-row:hover .delete,
.llm-wiki-chat-list .chat-row.is-selected .rename,
.llm-wiki-chat-list .chat-row.is-selected .delete {
  opacity: 1;
}
.llm-wiki-chat-list .chat-row input {
  flex: 1;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  padding: 0.1rem 0.25rem;
  border-radius: 3px;
}
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "style(chat): minimal CSS for transcript and chat list"
```

---

## Task 17: End-to-end smoke test

**Files:**
- Create: `tests/integration/chat-flow.test.ts`

**Design:** Integration test that stitches together: empty chats → open modal (mocked DOM) → submit turn 1 → assert first chat created + turn appended + title generation invoked → submit turn 2 → assert rewrite invoked + history passed through to `ask`.

- [ ] **Step 1: Write**

```ts
// tests/integration/chat-flow.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { createChat, appendTurn } from "../../src/chat/store.js";
import { rewriteFollowUp } from "../../src/chat/rewrite.js";
import { budgetHistory } from "../../src/chat/history-budget.js";
import { getModelContextWindow } from "../../src/chat/model-context.js";
import type { LLMProvider } from "../../src/llm/provider.js";

describe("chat flow integration (unit-level composition)", () => {
  it("turn 1 has no history, turn 2 runs rewrite and budgets history", async () => {
    const completeSpy = vi.fn((_opts: unknown) =>
      (async function* () {
        yield "rewritten q";
      })(),
    );
    const provider: LLMProvider = {
      complete: completeSpy as never,
      embed: async () => [],
      ping: async () => true,
      showModel: async () => ({ contextLength: 8192 }),
    };

    // turn 1
    let chat = createChat({ id: "c1", now: 1, folder: "", model: "m" });
    expect(chat.turns).toHaveLength(0);

    chat = appendTurn(
      chat,
      { question: "what is X?", answer: "X is a thing", sourceIds: [], rewrittenQuery: null, createdAt: 2 },
      2,
    );

    // turn 2: rewrite should be called
    const rewritten = await rewriteFollowUp({
      provider,
      model: "m",
      history: chat.turns,
      question: "and why?",
    });
    expect(rewritten).toBe("rewritten q");

    // budget should include the prior turn
    const ctx = await getModelContextWindow(provider, "m");
    const budgeted = budgetHistory(chat.turns, { availableTokens: ctx - 2048 });
    expect(budgeted).toHaveLength(1);
    expect(budgeted[0]!.question).toBe("what is X?");
  });
});
```

- [ ] **Step 2: Run — expect pass.**

- [ ] **Step 3: Commit**

```bash
git add tests/integration/chat-flow.test.ts
git commit -m "test(chat): integration smoke covering rewrite + budget composition"
```

---

## Task 18: Final verification

- [ ] **Step 1: Full test run**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build` (or whatever the build script is — check `package.json` if unsure).
Expected: clean build.

- [ ] **Step 4: Manual smoke in Obsidian**
- Reload plugin in Obsidian test vault.
- Shift-Cmd-K → empty chat list, empty transcript, input focused.
- Ask "what is the embedding index?" → streams an answer → chat appears in list with generated title.
- Ask "what's its runtime?" → rewrite happens (may be visible as a brief delay before retrieval), answer streams, second turn appears in transcript.
- Close modal, reopen, click the chat in the list → transcript re-hydrates.
- Hover a chat → rename button → change name → persists after close/reopen.
- Hover a chat → delete → gone after close/reopen.

- [ ] **Step 5: Commit any final tweaks discovered during manual QA**

```bash
git add -A
git commit -m "fix(chat): manual-QA polish"
```
