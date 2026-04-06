# LLM Wiki — Obsidian Plugin Design

**Status:** Draft for review
**Date:** 2026-04-07
**Author:** Dominique Leca (with Claude)
**Source tool:** `~/tools/llm-wiki/` (Python CLI, Karpathy-style local LLM Wiki)

---

## 1. Purpose

Port the existing `llm-wiki` Python tool into a first-class Obsidian community plugin. The plugin lets users:

- Index their entire vault into a structured knowledge base (entities, concepts, connections, sources) using a local or cloud LLM of their choice
- Ask natural-language questions about their vault from a Cmd+K style modal, with streamed answers grounded in retrieved context
- Choose between local Ollama models (downloaded on demand from inside the plugin) and cloud APIs (OpenAI, Anthropic, Google) by pasting an API key
- Generate Bases-compatible markdown pages for the entities, concepts, and sources that pass quality filters, so the KB is queryable through Obsidian's native ecosystem (Bases, Dataview, Templater, Graph view)
- Run a nightly "dream pass" that scores what they actively care about and feeds those scores back into retrieval ranking

The plugin must never modify user-authored content. It only writes to `wiki/` and `.obsidian/plugins/llm-wiki/`, enforced by a path allowlist at the I/O layer.

---

## 2. Decision log

Twelve design decisions were made during brainstorming. Each is recorded here with the chosen option and rationale.

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | LLM backend | **Ollama (default local) + cloud APIs (OpenAI, Anthropic, Google) as alternatives** | Ollama is the proven path from the Python tool. Cloud APIs handle users without GPU or who want better/faster models. Per-task choice in the model picker. |
| 2 | KB location | **Hybrid: `knowledge.json` lives in `$VAULT/wiki/` (shared with Python CLI); ephemeral caches live in `$VAULT/.obsidian/plugins/llm-wiki/`** | Preserves CLI interop. Keeps cache clutter out of the file tree. |
| 3 | Extraction process | **In-process, async queue, crash recovery via per-batch checkpoints** | Work is I/O-bound (HTTP to Ollama), so the renderer thread is fine. Simpler than child processes. |
| 4 | Dream mode | **Background scheduled pass + dream scores feed retrieval as a 4th ranker signal** | Faithful port of the Python tool's `dream.py` plus the obvious upgrade of actually using the scores at query time. |
| 5 | First-use estimates | **Lookup table for instant ETA, refined by live calibration after the first ~5 files extract** | Best of both: instant feedback + accuracy convergence. |
| 6 | Model UI | **Curated cards (with accuracy/speed/size visuals) + custom Ollama model field with autocomplete from the live catalog + cloud provider section with API key auto-detect and inline validation** | Matches the screenshot reference. Power-user escape hatch. No need to remember exact tags. |
| 7 | Concurrency on shared KB | **mtime check before save, no file locks** | Costs nothing, requires zero changes to the Python CLI, catches the dangerous overlap window. Realistic data loss probability is effectively zero in normal use. |
| 8 | Query UI | **Cmd+K style modal** | Native Obsidian pattern (Quick Switcher, Templater, Command Palette all use modals). Sidebar pane deferred to v2. |
| 9 | Indexing triggers | **Manual button + scheduled background pass (default daily at midnight, includes dream) + on-save re-extraction of the active note** | Covers all realistic update patterns without forcing the user into one mode. |
| 10 | Page generation | **Filtered generation: JSON KB always contains everything, but `wiki/entities/`, `wiki/concepts/`, `wiki/sources/` only get markdown pages for items passing configurable quality filters** | Evidence from the Python tool's first-run on real data: a 60-character file produced 2 hallucinated entities. Generating pages for everything would amplify noise. Filters are reused from `query.py`'s existing quality logic. |
| 11 | API key storage | **Plain text in `data.json` (Obsidian standard); password-style input field; clear warning under the field** | Matches every other Obsidian plugin (Smart Connections, Copilot). Keychain alternative breaks cross-device sync. |
| 12 | Answer modal sources display | **Answer + collapsible "Sources used (N)" section + optional debug context view (off by default, hidden in Advanced settings)** | Best UX (real source links, no fake citation numbers) plus invaluable debugging affordance for filter tuning. Debug toggle is intentionally discrete. |

---

## 3. Architecture overview

**Plugin name:** `llm-wiki` (matches the existing Python tool)

**Languages & build:** TypeScript → bundled to a single `main.js` via esbuild. Standard Obsidian plugin structure (`manifest.json`, `main.js`, `styles.css`). `isDesktopOnly: true`.

**The plugin is the orchestrator, not the engine.** Inference always happens out-of-process:

1. **Ollama** at `localhost:11434` for local models
2. **Cloud APIs** (OpenAI, Anthropic, Google) for users with API keys
3. The user picks per-task in the model dropdown — local for extraction and cloud for queries is a valid combination

**The KB is shared with the Python CLI.** `knowledge.json` lives in `$VAULT/wiki/`. The plugin reads/writes it with an mtime check before saves to avoid clobbering external edits. Ephemeral state (embeddings cache, dream state, interaction logs, plugin settings, API keys) lives in `$VAULT/.obsidian/plugins/llm-wiki/`.

**Three big surfaces:**

1. **Settings panel** — model management, indexing config, API keys, filter thresholds, debug toggle
2. **Cmd+K query modal** — the question-answering UX
3. **Background workers** — scheduled extraction pass, on-save extraction for the active note, dream pass

**Three integration paths into Obsidian:**

- Ribbon icon (sidebar) → opens query modal
- Command palette → all actions are commands
- Configurable hotkey → defaults to `Cmd+Shift+K`

**Output to the vault** (Bases-compatible per the spec):
- `wiki/knowledge.json` — JSON KB (source of truth, shared with CLI)
- `wiki/entities/*.md` — generated, only for entities passing quality filters
- `wiki/concepts/*.md` — generated, only for concepts passing quality filters
- `wiki/sources/*.md` — generated, only for sources passing quality filters
- `wiki/index.md`, `wiki/log.md`, `wiki/memory.md` — auto-maintained

All markdown uses flat YAML frontmatter, kebab-case keys, ISO dates, list-typed `tags` — strict adherence to the spec's Bases compatibility rules.

**Hard guarantee:** the plugin only ever writes inside `wiki/` and `.obsidian/plugins/llm-wiki/`. It never touches files the user authored. Enforced at the I/O layer (a single `safeWrite()` function with a path allowlist), so it cannot be accidentally violated by any future code path.

---

## 4. File / module structure

```
llm-wiki-plugin/
├── manifest.json
├── main.ts                          # plugin entry point — registers commands, ribbon, settings
├── styles.css                       # modal + settings panel styling
├── package.json
├── esbuild.config.mjs
├── tsconfig.json
│
├── src/
│   ├── core/                        # pure logic, no Obsidian/IO dependencies
│   │   ├── kb.ts                    # KnowledgeBase class (port of kb.py)
│   │   ├── ids.ts                   # makeId() — deterministic slugification
│   │   ├── vocabulary.ts            # vocab export sent to LLM at extraction time
│   │   ├── filters.ts               # quality filter rules (used by retrieval AND page gen)
│   │   └── types.ts                 # Entity, Concept, Connection, Source types
│   │
│   ├── llm/                         # LLM provider abstraction
│   │   ├── provider.ts              # LLMProvider interface
│   │   ├── ollama.ts                # OllamaProvider
│   │   ├── openai.ts                # OpenAIProvider
│   │   ├── anthropic.ts             # AnthropicProvider
│   │   ├── google.ts                # GoogleProvider
│   │   ├── detect-key.ts            # auto-detect provider from API key prefix
│   │   └── catalog.ts               # Ollama library catalog fetcher + cache
│   │
│   ├── extract/                     # extraction pipeline
│   │   ├── extractor.ts             # extractFile() — port of extract.py
│   │   ├── prompts.ts               # extraction prompt templates
│   │   ├── parser.ts                # robust JSON parsing for 7B model quirks
│   │   └── queue.ts                 # in-process queue with crash recovery + checkpoint
│   │
│   ├── query/                       # retrieval + Q&A
│   │   ├── retrieve.ts              # hybrid retrieval (kw + emb + path + dream)
│   │   ├── classify.ts              # query type detection
│   │   ├── rrf.ts                   # Reciprocal Rank Fusion + dream boost curve
│   │   ├── embeddings.ts            # contextual embeddings + cosine sim + cache
│   │   ├── format-context.ts        # format retrieved bundle for the LLM
│   │   └── ask.ts                   # full Q&A pipeline
│   │
│   ├── dream/                       # memory consolidation
│   │   ├── score.ts                 # signal scoring with origin weights + recency decay
│   │   ├── memory-md.ts             # render memory.md
│   │   └── runner.ts                # scheduled execution + watermark state
│   │
│   ├── pages/                       # markdown page generation (the new piece)
│   │   ├── frontmatter.ts           # build flat YAML, kebab-case, ISO dates (Bases-safe)
│   │   ├── render-entity.ts         # entity → markdown
│   │   ├── render-concept.ts        # concept → markdown
│   │   ├── render-source.ts         # source → markdown
│   │   ├── render-index.ts          # index.md generation
│   │   └── generator.ts             # filter check + write via processFrontMatter
│   │
│   ├── vault/                       # Obsidian I/O — the only layer that touches files
│   │   ├── safe-write.ts            # path allowlist enforcement, atomic writes
│   │   ├── walker.ts                # vault file walker (port of vault_files in wiki.py)
│   │   ├── kb-store.ts              # load/save knowledge.json with mtime check
│   │   └── plugin-data.ts           # read/write .obsidian/plugins/llm-wiki/ files
│   │
│   ├── ui/                          # all rendering
│   │   ├── modal/
│   │   │   ├── query-modal.ts       # the Cmd+K modal
│   │   │   ├── answer-view.ts       # answer + sources + debug section
│   │   │   └── model-picker.ts      # inline model + folder pickers
│   │   ├── settings/
│   │   │   ├── settings-tab.ts      # main settings entry
│   │   │   ├── models-section.ts    # curated cards + custom field + autocomplete
│   │   │   ├── cloud-section.ts     # API key inputs with auto-detect + validation
│   │   │   ├── indexing-section.ts  # cadence, on-save, manual button
│   │   │   ├── filters-section.ts   # quality filter thresholds for page generation
│   │   │   └── advanced-section.ts  # discrete debug toggle, paths, dev tools
│   │   ├── status-bar.ts            # extraction progress indicator
│   │   └── first-run.ts             # onboarding flow
│   │
│   ├── runtime/                     # background work coordination
│   │   ├── scheduler.ts             # cron-like scheduling (default: midnight)
│   │   ├── on-save-watcher.ts       # vault.on('modify') handler for current note
│   │   ├── progress.ts              # shared progress state for status bar + UI
│   │   └── hardware.ts              # detect CPU/RAM/Apple Silicon for estimates
│   │
│   └── plugin.ts                    # the main Plugin subclass — wires everything together
│
└── tests/
    ├── core/                        # unit tests for pure logic
    ├── llm/                         # provider tests with mocked HTTP
    ├── query/                       # retrieval ranking tests with fixture KB
    ├── pages/                       # frontmatter compliance tests (Bases rules)
    └── fixtures/                    # sample knowledge.json files for testing
```

**Layered dependencies, one direction.** UI depends on runtime depends on extract/query/dream depends on llm + vault depends on core. Core has zero dependencies on Obsidian or anything else, so it is trivially testable.

**The vault layer is the only place that does I/O.** Everything else gets data passed in. Path allowlist enforcement lives in exactly one file.

**Provider abstraction lets new providers be added without touching extract/query code.** Adding Mistral, Cohere, or a custom OpenAI-compatible endpoint = one new file in `src/llm/`.

**`pages/` is its own module** because it's the new piece. The Python tool does not write per-entity markdown. Keeping it isolated means we can iterate filter rules, frontmatter format, and templates without disturbing the proven extraction/query pipeline.

### Python → TypeScript module mapping

| Python file | TypeScript module |
|---|---|
| `kb.py` | `core/kb.ts` |
| `extract.py` | `extract/extractor.ts` |
| `query.py` | `query/retrieve.ts` + `query/ask.ts` + `query/embeddings.ts` |
| `dream.py` | `dream/score.ts` + `dream/runner.ts` |
| `vault.py` | `vault/safe-write.ts` + `vault/walker.ts` |
| `prompts.py` | `extract/prompts.ts` + `query/format-context.ts` |
| `parser.py` | `extract/parser.ts` |
| `llm.py` | `llm/ollama.ts` |

---

## 5. Data flow

### 5.1 Extraction flow

```
Trigger (manual / scheduled / on-save / palette)
        ↓
vault/walker.ts          → list of (path, content, mtime, origin)
        ↓                    (skips wiki/, .obsidian/, Template/, Assets/, old Dailies)
extract/queue.ts         → dedupe vs KB.sources by mtime; cancellable;
        ↓                    progress events to UI; checkpoint every 5 files
core/vocabulary.ts       → read current KB vocab; build extraction prompt
        ↓
llm/provider.complete()  → Ollama or OpenAI/Anthropic/Google
        ↓
extract/parser.ts        → robust JSON parsing (handles 7B model quirks)
        ↓
core/kb.ts               → addEntity / addConcept / addConnection / markSource
        ↓
vault/kb-store.save()    → mtime check before write; atomic .tmp + rename
        ↓ (every 5 files; full save at end of batch)
pages/generator.ts       → apply filters; render and safeWrite() qualifying pages
        ↓
ui/status-bar.ts         → "✓ N files processed"
```

**Idempotent.** Re-running on the same files is a no-op (mtime check at queue level + KB save).

**Cancellable** at file boundaries. Cancel → finish current file, save, stop. Resume picks up via the KB sources map.

**Page generation runs once per batch, not per file.** Avoids rewriting the same entity page 50 times during a big run; gives filter rules a complete picture before deciding what to publish.

### 5.2 Query flow

```
Trigger (hotkey / ribbon / palette)
        ↓
ui/modal/query-modal.ts  → input + model picker + folder scope
        ↓
query/classify.ts        → entity_lookup | list_category | relational | conceptual
        ↓
query/retrieve.ts        → 3 rankers (keyword, embedding, path) → RRF fusion
        ↓                    + dream score boost as 4th signal
core/filters.ts          → quality multipliers
        ↓
(folder scope filter)    → keep only entities/concepts whose sources start with selected path
        ↓
query/format-context.ts  → markdown context block
        ↓
llm/provider.complete()  → streaming
        ↓
ui/modal/answer-view.ts  → token-by-token render
        ↓                    + collapsible "Sources used (N)"
        ↓                    + collapsible "Context (debug)" if Advanced toggle on
vault/plugin-data.ts     → append interaction log (.obsidian/.../interactions/YYYY-MM-DD.jsonl)
```

**Streaming first-class.** Tokens render in a Markdown view that re-parses progressively (headers, bullets, bold, links render live).

**Folder scope is a retrieval filter, not re-extraction.** Scoping to `Books/` only changes which retrieved items pass through. No new LLM work.

**Source links are real wikilinks.** Click → opens the note in Obsidian. If the entity/concept page exists (passed quality filter), the link goes there. Otherwise it falls back to an inline preview from the JSON record.

**Interaction logs feed dream.** Every Q&A appends a JSONL line. Dream reads these to weight frequently-asked entities higher in tomorrow's `memory.md` and `dream-scores.json`.

### 5.3 Dream flow

```
Trigger (scheduled after extraction, or manual command)
        ↓
dream/score.ts           → score = Σ(origin_weight × recency_decay) for each entity/concept
        ↓                    inputs: KB.sources origins + interactions/*.jsonl + watermark
        ↓                    weights: user-note 3.0, promoted 4.0, daily 2.0, clipping 1.0,
        ↓                             question 2.5; 30-day half-life
dream/memory-md.ts       → render top-30 entities + top-30 concepts with breakdowns
        ↓
vault/safe-write.ts      → wiki/memory.md (human-facing digest)
        ↓
vault/plugin-data.ts     → dream-state.json (watermark = now)
                         → dream-scores.json (flat {id: score} map for retrieval ranker)
```

**Dream produces two outputs.** `memory.md` is human-facing. `dream-scores.json` is machine-facing, consumed by `query/rrf.ts`. Written together so they cannot drift.

**Dream is read-only on the KB.** It only reads `knowledge.json` and interaction logs. Safe to run in parallel with extraction (rare but possible).

**The 4th-ranker boost is multiplicative.** `1 + log(1 + dream_score)` — nudges relevance without dominating it. Curve tunable in `query/rrf.ts` against real data.

---

## 6. Storage layout

### 6.1 Inside the vault — `$VAULT/wiki/`

Visible to the user, syncs with iCloud/Obsidian Sync, shared with the Python CLI.

```
$VAULT/wiki/
├── knowledge.json              ← THE source of truth (shared with Python CLI)
├── index.md                    ← auto-generated catalog
├── log.md                      ← append-only activity log
├── memory.md                   ← dream pass output
│
├── entities/
│   ├── alan-watts.md           ← only generated if entity passes quality filters
│   └── …
│
├── concepts/
│   ├── zen-buddhism.md         ← only generated if concept passes quality filters
│   └── …
│
└── sources/
    ├── books/
    │   └── watts-wisdom-of-insecurity.md   ← mirrors source folder structure
    └── learn/
        └── buddhism-and-insecurity.md
```

**Naming rules:**
- Entity/concept filenames = the kebab-case ID from `core/ids.ts` (deterministic lookup from a name)
- Source filenames = sanitized version of the source's vault-relative path
- Source subfolder structure mirrors the user's vault folder structure for navigability and to prevent flat 500-file directories

**Frontmatter (Bases-strict):** All generated pages follow the spec's schema — flat keys, kebab-case, ISO dates, `tags`/`aliases`/`cssclasses` always lists, `source-count` always integer, no nested objects, no inline `Key:: Value`. Written via Obsidian's `processFrontMatter` API.

### 6.2 Inside the plugin folder — `$VAULT/.obsidian/plugins/llm-wiki/`

```
.obsidian/plugins/llm-wiki/
├── manifest.json
├── main.js
├── styles.css
│
├── data.json                   ← Obsidian's standard plugin settings file
│                                  • model preferences, API keys (plain text, password input)
│                                  • indexing cadence (default midnight)
│                                  • on-save toggle
│                                  • filter thresholds for page generation
│                                  • hotkey binding (delegated to Obsidian)
│                                  • Advanced: debug toggle (off by default)
│
├── embeddings-cache.json       ← contextual embeddings, keyed by entity/concept ID
├── dream-state.json            ← {"last_run": "2026-04-07T00:00:01"}
├── dream-scores.json           ← {entity_id|concept_id: score} flat map
├── catalog-cache.json          ← cached Ollama library catalog (24h TTL)
├── extraction-state.json       ← in-flight queue state for crash recovery
├── hardware-profile.json       ← detected CPU/RAM + measured throughput
└── interactions/
    └── 2026-04-07.jsonl        ← one file per day, JSONL append-only
```

**Why some things live here instead of in `wiki/`:** ephemeral, regeneratable, internal machinery, per-machine state. Nothing here is meaningful to a human or to another device.

The Python CLI keeps using its own equivalents under `$VAULT/wiki/` (`embeddings_cache.json`, `.dream-state.json`). The only shared file is `knowledge.json`, protected by the mtime check.

### 6.3 Path allowlist (the safety net)

Every write goes through `vault/safe-write.ts`, which validates the target path against an allowlist before touching disk:

```ts
const ALLOWED_PREFIXES = [
  "wiki/knowledge.json",
  "wiki/index.md",
  "wiki/log.md",
  "wiki/memory.md",
  "wiki/entities/",
  "wiki/concepts/",
  "wiki/sources/",
  ".obsidian/plugins/llm-wiki/",
];
```

Any attempt to write outside this allowlist throws and is logged. **There is no path the plugin can take to modify a user-authored note** — not through a bug, not through an LLM hallucination, not through a malformed config. The allowlist is the single chokepoint. A custom ESLint rule fails CI on any direct call to `app.vault.create()` or `app.vault.adapter.write()` outside the `vault/` module.

### 6.4 Sync behavior across devices

| Scenario | Behavior |
|---|---|
| Pure local | Everything works on one machine |
| Vault synced, `.obsidian/` not synced | KB and generated pages travel; settings/embeddings/extraction state are per-machine |
| Vault and `.obsidian/` both synced | Settings travel too; embeddings cache versioned by `vaultId` and rebuilt if mismatch |

### 6.5 Disk footprint estimates

For a 500-file vault with ~300 entities and ~150 concepts after extraction:

| File | Approx size |
|---|---|
| `knowledge.json` | 1–5 MB |
| `embeddings-cache.json` | 1–2 MB |
| Generated entity pages (filtered) | ~500 KB |
| Generated concept pages (filtered) | ~250 KB |
| Generated source pages (filtered) | ~1 MB |
| `memory.md` | <50 KB |
| `interactions/*.jsonl` | <1 KB per Q&A |
| Plugin bundle (`main.js`) | 200–400 KB |

**Total plugin footprint on disk: ~5–10 MB** for a typical vault.

---

## 7. UI components

### 7.1 Query modal (Cmd+K style)

Triggered by hotkey, ribbon icon, or command palette. Centered floating modal, ~640px wide, dimmed background, `Esc` closes.

**Layout:**

- Top: question input (autofocus)
- Below input: inline pills for model picker (`⌘ qwen2.5:7b ▾`) and folder scope (`📁 Whole vault ▾`)
- Body: empty state shows recent questions or example prompts; after submit, body shows the streamed answer
- Below answer: collapsed `▸ Sources used (N)` section
- Below that (only if Advanced debug toggle on): collapsed `▸ ⓘ Context (debug)` section
- Action row: `[↻ Re-ask] [⤴ Open as note] [✕ Close (Esc)]`

**Source link behavior:**

- **Click** → opens the note in a new background tab via `app.workspace.getLeaf('tab').openFile(file, { active: false })`. Modal stays in foreground.
- **Cmd-click** → opens in the active tab (foreground), which steals focus and closes the modal.
- **Cmd+Shift-click** → opens in a new split pane.

**Model picker behavior:**

- Picking a model only affects the current modal session (not persisted to settings).
- **After an answer has finished streaming** → automatically re-runs the same question with the new model.
- **While an answer is streaming** → an inline alert (not a separate modal) drops down inside the query modal:
  ```
  ⚠ An answer is currently being generated.
    [Cancel current and use claude-sonnet-4]
    [Keep generating with qwen2.5:7b]
  ```
  Picking the first option aborts cleanly and re-runs. Picking the second restores the previous selection. Auto-dismisses if the in-flight answer completes first.

**Folder picker behavior:**

- The default folder is set in settings (default = whole vault). It is always the first item in the dropdown, labeled clearly: `📁 Default (Whole vault)`.
- Picking a different folder in the modal scopes retrieval AND persists for subsequent queries within the same modal session.
- Closing and reopening the modal resets the picker back to the default.
- Changing the folder mid-session does NOT re-run the previous answer — folder scope only takes effect on the next question.

**Streaming details:**

- Tokens render in a Markdown view that re-parses progressively
- A small spinner shows next to "Sources used" until streaming completes
- Cancellation (`Esc` or close button) cleanly aborts the LLM request via `AbortController`

**Empty-state behavior:**

- Below the input, show the last 5 questions asked (clickable to re-ask)
- If no past questions, show three example prompts based on what is in the KB

### 7.2 Settings panel

Standard Obsidian settings tab. Sections in order from "you'll touch these often" to "you'll never touch these."

**Section 1: Models**

Local models — a grid of curated cards matching the screenshot reference (radio button, name, badge, accuracy/speed dots, size, download button or green check). Cards include `qwen2.5:7b` (default), `qwen2.5:14b`, `gemma3:4b`, `llama3.1:8b`, plus 4 more under "Show more curated models."

Custom model field below the grid, with autocomplete from the cached Ollama library catalog. Type any model name → suggestions appear → pick one → click Download.

Embeddings model card (separate, since `nomic-embed-text` is required for semantic retrieval).

Cloud providers section: one input row per key with eye toggle and inline auto-detection + validation. Pasting a key triggers `detect-key.ts` (provider from prefix), then a cheap validation call (`GET /v1/models`), then either green check + model list or red error with specific failure. Validated cloud models are added to the query modal's model picker dropdown.

**Section 2: Indexing**

- Last run timestamp
- "Index now" / "Cancel running extraction" buttons
- Schedule: daily at HH:MM | every N hours | manual only
- "Re-extract the active note when I save it" toggle
- "Run dream pass after each scheduled extraction" toggle
- Quality filters subsection: min facts per entity, min sources per entity, min source content length, "skip clipping-only entities" toggle
- "Regenerate all pages from current KB" button

**Section 3: Query**

- Default model dropdown
- Hotkey display (configurable in Obsidian's hotkey settings)
- Default folder scope dropdown
- "Show source links" toggle
- Recent questions to remember (count)

**Section 4: Advanced** (collapsed by default)

When expanded:
- Debug context view toggle (off by default, intentionally discrete)
- KB location with "Change…" button
- "Open plugin data folder" button
- "Export KB as JSON" button
- "Reset embeddings cache" button
- "View extraction log" button

### 7.3 First-run onboarding

Triggers automatically the first time the plugin loads with no `data.json`. Three-step modal flow:

**Step 1 — Hardware detection and recommendation.** Detects CPU, RAM, Apple Silicon vs Intel via Node `os` module. Recommends a model from the lookup table:

| RAM | Recommended local model |
|---|---|
| 8 GB | gemma3:4b |
| 16 GB | qwen2.5:7b |
| 24+ GB | qwen2.5:14b |

Offers download button or "use cloud provider" alternative or skip.

**Step 2 — Vault scan and time estimate.** Counts markdown files and total characters. Shows estimated indexing time using lookup table for the chosen model + machine, plus estimated query time. Offers "Start indexing now" / "Schedule for tonight" / "Skip" buttons.

**Step 3 — Done.** Shows the hotkey, the ribbon icon, and where to find settings.

The lookup-table estimate gets refined after the first ~5 files actually run — the modal/status bar transitions to a measured-throughput ETA at that point.

### 7.4 Status bar widget

Small, unobtrusive item in Obsidian's bottom status bar.

| State | Display | Click action |
|---|---|---|
| Idle | `🧠 LLM Wiki` | Opens settings |
| Indexing | `🧠 Indexing 47/512 · ETA 6h 12m` | Opens popover with progress + cancel |
| Dreaming | `🧠 Dream pass…` | (none) |
| Error | `🧠 ⚠ Ollama unreachable` | Opens popover with error + retry button |

Never intrusive, never modal, always one click away from more detail.

---

## 8. Obsidian integration points

### 8.1 Plugin lifecycle

| Hook | Action |
|---|---|
| `onload()` | Load `data.json`, validate settings, register everything below, start scheduler, run first-run onboarding if no settings exist, defer KB load (avoid blocking startup on a 5 MB JSON parse) |
| `onunload()` | Cancel in-flight extraction, abort streaming LLM requests, persist extraction-state for resume, clear timers |
| `onLayoutReady()` | "Catch up" check — if a scheduled run was missed (machine off at midnight), trigger it now |
| `onExternalSettingsChange()` | Reload settings if `data.json` was edited externally (e.g. via cross-device sync) |

### 8.2 Commands

| Command ID | Title in Cmd+P |
|---|---|
| `llm-wiki:ask` | LLM Wiki: Ask… (default hotkey `Cmd+Shift+K`) |
| `llm-wiki:extract-current` | LLM Wiki: Extract current file |
| `llm-wiki:extract-all` | LLM Wiki: Run extraction now |
| `llm-wiki:extract-cancel` | LLM Wiki: Cancel running extraction |
| `llm-wiki:dream` | LLM Wiki: Run dream pass |
| `llm-wiki:open-entity-for-current` | LLM Wiki: Open entity for current note |
| `llm-wiki:show-vocabulary` | LLM Wiki: Show vocabulary |
| `llm-wiki:regenerate-pages` | LLM Wiki: Regenerate pages from KB |
| `llm-wiki:open-settings` | LLM Wiki: Open settings |

### 8.3 Ribbon icon

`addRibbonIcon('brain', 'LLM Wiki', () => openQueryModal())`. Right-click → context menu shortcuts.

### 8.4 Status bar

`addStatusBarItem()`. Updates pushed via `runtime/progress.ts` event emitter so only `ui/status-bar.ts` knows about Obsidian's status bar API.

### 8.5 Settings tab

`addSettingTab()`. Each section from 7.2 lives in its own file under `ui/settings/`. API key fields use the standard `inputEl.setAttribute('type', 'password')` pattern with a custom eye toggle button.

### 8.6 Vault events

| Event | Handler | Purpose |
|---|---|---|
| `modify` | `runtime/on-save-watcher.ts` | Debounced 2s; queue active file for re-extraction (if on-save toggle on) |
| `delete` | `core/kb.ts.removeSource()` | Remove source from KB; decrement `source-count` on entities/concepts; mark orphans |
| `rename` | `core/kb.ts.renameSource()` | Update source path in KB; update entity/concept `sources[]`; rename generated source page if it exists |

We do NOT listen to `create` (empty new files have no useful content).

### 8.7 File writes — every single one through `vault/safe-write.ts`

Four entry points:

```ts
await safeWriteKB(plugin, kb);                           // wiki/knowledge.json (atomic, mtime-checked)
await safeWritePage(plugin, relPath, content, fm);       // wiki/entities|concepts|sources/...
await safeWritePluginData(plugin, filename, content);    // .obsidian/plugins/llm-wiki/...
await plugin.saveData(settings);                         // standard Obsidian API
```

Every helper validates its target path against the allowlist. There is no `app.vault.create()` or `adapter.write()` call anywhere else in the codebase. CI lint enforces this.

### 8.8 Reading vault files

```ts
const files = app.vault.getMarkdownFiles()
  .filter(f => !isInSkippedDir(f.path))
  .filter(f => !isOldDailyNote(f.path))
  .filter(f => f.stat.size >= MIN_FILE_SIZE);

const content = await app.vault.cachedRead(file);
```

`getMarkdownFiles()` uses Obsidian's in-memory index (fast). `cachedRead` is friendly with the editor cache and won't conflict with unsaved edits in an open note.

### 8.9 Frontmatter writes — `processFrontMatter` exclusively

Every YAML write goes through:

```ts
await app.fileManager.processFrontMatter(file, (fm) => {
  fm['source-count'] = (fm['source-count'] ?? 0) + 1;
  fm['date-updated'] = todayIso();
});
```

`pages/frontmatter.ts` builds frontmatter objects with strict Bases-compliance helpers. A test in `tests/pages/frontmatter.test.ts` runs every helper output through a Bases-rules validator. CI fails if a helper produces non-compliant output.

### 8.10 Streaming responses

Each provider exposes:

```ts
interface LLMProvider {
  complete(opts: CompletionOptions): AsyncIterable<string>;
  embed(text: string): Promise<number[]>;
  listModels(): Promise<string[]>;
}
```

Modal consumes:

```ts
for await (const token of provider.complete({...})) {
  if (cancelled) break;
  answerView.appendToken(token);
}
```

Cancellation via `AbortController` in `CompletionOptions`. Same pattern for Ollama's native streaming format and cloud providers' SSE.

### 8.11 Network calls — exactly three destinations

1. **`http://localhost:11434`** — Ollama (only if a local model is active)
2. **Cloud LLM APIs** — `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com` (only if a cloud model is active)
3. **`https://ollama.com/library`** — model catalog autocomplete (24h cache, can be disabled in Advanced)

No telemetry, no analytics, no error reporting, no update check. A test asserts no `fetch()` call hits any other host.

### 8.12 Explicitly NOT done

- ❌ Modify any file outside the allowlist
- ❌ Call `app.vault.create()` or `adapter.write()` outside `vault/safe-write.ts`
- ❌ Read or write `.obsidian/workspace.json` or other Obsidian config
- ❌ Register vault events not actively needed
- ❌ Make network calls to any host except the three above
- ❌ Run on mobile (`isDesktopOnly: true`)
- ❌ Ship a model file with the plugin (zero binary assets)
- ❌ Bundle Ollama or any inference runtime
- ❌ Store anything in `localStorage` or IndexedDB

---

## 9. Testing strategy

### 9.1 The pyramid

Heavy investment in unit tests for the pure-logic layer. Moderate integration tests with mocked HTTP for LLM and vault layers. A small handful of slow E2E tests in real Obsidian.

### 9.2 Unit tests

**Tooling:** Vitest. ESM-native, fast, plays well with TypeScript and esbuild.

**Coverage targets:**

| Module | What we test |
|---|---|
| `core/ids.ts` | makeId edge cases (unicode, hyphens), idempotence |
| `core/kb.ts` | add/merge/dedupe, mtime handling, cascade on delete |
| `core/filters.ts` | every quality bar against fixture entities |
| `core/vocabulary.ts` | export shape stability, character cap |
| `extract/parser.ts` | every 7B model quirk: trailing commas, markdown fences, partial JSON, single quotes, embedded code blocks. Fixtures from real Python tool logs. |
| `query/classify.ts` | every example query in `query.py` test set |
| `query/rrf.ts` | RRF math + dream-boost curve at boundaries |
| `query/embeddings.ts` | cosine sim, contextual text floor, cache hit/miss |
| `dream/score.ts` | weights, decay at 0/30/60/90 days, breakdowns |
| `pages/frontmatter.ts` | **Bases compliance gate** — every helper output validated |
| `pages/render-*.ts` | snapshot tests against fixture entities (snapshots in git) |
| `llm/detect-key.ts` | every supported key prefix, edge cases (whitespace, newlines) |
| `llm/catalog.ts` | parsing, TTL, offline fallback |

**Fixture KB:** Hand-curated `tests/fixtures/sample-kb.json` with ~30 entities and ~15 concepts representing every shape (rich, empty, twitter-only, well-connected, orphan, etc.).

**Real-data extraction quirks fixture set:** `tests/fixtures/raw-llm-responses/` containing actual raw text from the Python tool's runs, with paired expected-parsed-output files. Grows as new parser bugs are caught in the wild.

### 9.3 Integration tests

**Tooling:** Vitest + a fake Obsidian `App` (`tests/helpers/mock-app.ts`) implementing the API subset the plugin uses. ~200 lines.

**LLM mocking:** Each provider gets a `MockLLMProvider` that returns canned responses. Library at `tests/fixtures/llm-responses/`.

**Scenarios:**

| Test | Assertion |
|---|---|
| Full extraction pipeline | Fixture file + canned response → KB has right entities → page generation runs filters → only quality items get pages → all pages pass Bases validation |
| Incremental extraction | 5 files, then re-run → 0 LLM calls. Modify 1 → 1 LLM call. Add 1 → 1 LLM call. |
| Crash recovery | Kill process at file 6 → restart → resumes at file 6 with no duplicates |
| Concurrent KB write detection | External process modifies `knowledge.json` → plugin save throws `KBStaleError` → caller reloads + retries |
| Path allowlist enforcement | Try to write outside allowlist (absolute, `..`, symlink, non-`wiki/`) → all blocked |
| Page filter enforcement | KB with 100 entities, 60 noise → exactly 40 pages generated, never 100 |
| Folder-scoped query | KB with `Books/` and `Learn/` items → query scoped to `Books/` returns only Books items |
| Streaming + cancellation | Mid-stream abort → stream stops cleanly, no leaked timers |
| Dream pass full cycle | Fixture KB + interactions → `memory.md` + `dream-scores.json` + watermark advanced |
| API key validation | Mock cloud HTTP → valid → green + models. Invalid → red. Network error → distinct error. |
| First-run hardware detection | Mock 8/16/24 GB → recommendation matches lookup table |
| Vault event handlers | Simulate modify/delete/rename → KB updates correctly |

### 9.4 E2E tests

**Tooling:** A second test config that boots headless Obsidian against a disposable test vault at `tests/e2e/fixture-vault/` (~10 hand-crafted files).

**Scenarios:** Plugin loads cleanly, real Ollama extraction, real Ollama query, settings round-trip, first-run flow.

E2E tests are slow and prone to flakiness. Kept few and focused on things that can only break when integrated with real Obsidian.

### 9.5 Property-based tests

[fast-check](https://github.com/dubzzz/fast-check) for two areas:

1. **`makeId` invariants** — for any string, output is lowercase, only `[a-z0-9-]`, no leading/trailing/double hyphens, idempotent
2. **Frontmatter Bases compliance** — random entity/concept objects → run through helpers → assert Bases validator passes

### 9.6 Performance regression tests

Against a 1,000-entity / 500-concept fixture:

| Benchmark | Threshold |
|---|---|
| Load `knowledge.json` from disk | < 100 ms |
| Build embedding index from cache | < 500 ms |
| Run all three rankers + RRF on a query | < 50 ms |
| Render `memory.md` from scored items | < 100 ms |
| Generate one entity page (no LLM) | < 20 ms |

CI fails if any regress >20% in a PR.

### 9.7 Bases compatibility CI gate

Dedicated CI job:

```
bases-compatibility:
  - Run pages/frontmatter unit tests
  - Run page generation against tests/fixtures/sample-kb.json
  - Pipe every generated .md file through tests/helpers/validate-bases.ts
  - Fail loudly with the offending file + the rule it violated
```

Validator script checks every rule from the spec: frontmatter is first thing, flat keys, ISO date format, list-typed `tags`/`aliases`/`cssclasses`, integer numerics, no deprecated names, no inline `Key:: Value`, UTF-8/LF/no BOM.

Same validator exposed as a plugin command: `LLM Wiki: Validate generated pages`.

### 9.8 Quality regression with real vault data

After a full overnight extraction run, snapshot the real `knowledge.json` into `tests/fixtures/real-vault-kb.json` (PII scrubbed if needed). Three quality regression tests:

1. **Filter precision/recall** — 20 hand-labeled good entities + 20 bad → assert filter classifies correctly
2. **Retrieval relevance** — 5 benchmark questions with expected top-3 entities → assert no silent regressions
3. **Page generation count stability** — assert `wiki/entities/` contains exactly N files, etc.

Added in Phase 2 of implementation, after real data exists.

### 9.9 CI shape

| Job | Runs on | Time |
|---|---|---|
| `fast` | every PR push | ~60 s (lint, unit, integration, Bases gate, property) |
| `perf` | every PR push | ~30 s |
| `e2e` | nightly + tagged release | ~5 min |

Total PR CI: under 2 minutes.

### 9.10 Manual release checklist

- [ ] Fresh install on a vault with no `wiki/` folder → first-run flow → KB created
- [ ] Install on a vault with existing CLI `knowledge.json` → loaded without modification → extraction adds new items
- [ ] Pull a new local model from picker → progress → appears in dropdown
- [ ] Paste each cloud key → green check → models populated
- [ ] Ask a question with each model variant → streams → sources clickable → background tab
- [ ] Run extraction, cancel mid-run → stops cleanly → resume works
- [ ] Quit Obsidian during extraction → relaunch → resume works
- [ ] Two devices syncing same KB → mtime check prevents conflicts
- [ ] Toggle every setting → restart → all persisted

---

## 10. Implementation phasing

Six phases. Each ends with a working, useful, releasable plugin.

### Phase 1 — Foundation (week 1)

**Goal:** Loadable plugin that reads vault and KB with safety guarantees in place. No LLM calls.

**Deliverables:** Plugin scaffolding, build pipeline, lint, CI. `core/` fully ported. `vault/` layer with allowlist + mtime check. Minimal `LLM Wiki: Show vocabulary` command. Unit tests >90% on `core/` and `vault/`. Bases-compatibility CI gate operational.

**Releasable as:** "LLM Wiki Reader" — browse a KB built by the Python CLI from inside Obsidian.

### Phase 2 — Extraction (week 2)

**Goal:** Plugin can extract from vault files using Ollama.

**Deliverables:** `llm/provider.ts` interface + `llm/ollama.ts` with streaming + AbortController. `extract/` module with checkpointing + crash recovery. `runtime/progress.ts`. `ui/status-bar.ts`. Extraction commands. Minimal settings tab with one section: "Indexing" (Index now button). Integration tests with mocked Ollama.

**Releasable as:** "LLM Wiki — Extraction Beta" — build a KB from the vault using a local model. Used to rebuild the real KB and tune Phase 3 against real data.

### Phase 3 — Query (week 3)

**Goal:** Cmd+K modal alive. Ask questions, get streamed answers.

**Deliverables:** `query/` module fully ported (minus dream boost — that comes in Phase 5). `ui/modal/` with streaming, sources collapsible, debug toggle hidden. Model + folder pickers per Section 7.1 rules. `Cmd+Shift+K` hotkey. Ribbon icon. Interaction logging. Quality regression tests using real KB from Phase 2.

**Releasable as:** "LLM Wiki 1.0 — Local" — the first version genuinely useful day-to-day.

### Phase 4 — Page generation (week 4)

**Goal:** Plugin writes filtered, Bases-compatible pages.

**Deliverables:** `pages/` module with strict Bases helpers. `ui/settings/filters-section.ts` tuned against real data. `LLM Wiki: Regenerate pages from KB` command. Vault event handlers for modify/delete/rename. Full Bases CI gate exercised against real generated pages. Property tests for frontmatter helpers.

**Releasable as:** "LLM Wiki 1.1" — navigable, Bases-queryable wiki in the vault. Smart Connections / Dataview / Templater all work against generated content.

### Phase 5 — Cloud providers + dream + scheduling (week 5)

**Goal:** Full feature parity with the spec.

**Deliverables:** OpenAI, Anthropic, Google providers with streaming. `detect-key.ts` and `catalog.ts` autocomplete. Full `models-section.ts` and `cloud-section.ts` with key validation. `dream/` module. Dream boost as 4th ranker signal. `runtime/scheduler.ts` with daily cron + missed-run catch-up. `runtime/on-save-watcher.ts`. Full `indexing-section.ts`. `Run dream pass` and `Open entity for current note` commands.

**Releasable as:** "LLM Wiki 1.2" — spec fully implemented; ready for store submission.

### Phase 6 — Onboarding, polish, store submission (week 6)

**Goal:** Nice first install, get into the community store.

**Deliverables:** `runtime/hardware.ts` with lookup table. `ui/first-run.ts`. Live calibration refinement after first 5 files. `ui/settings/advanced-section.ts` with discrete debug toggle, KB location, export, log viewer. README, screenshots. E2E suite. Performance regression suite. Manual checklist. Store submission to obsidianmd/obsidian-releases.

**Releasable as:** "LLM Wiki 1.0" in the Obsidian community plugin store.

### Out of scope for v1 (deferred to v2)

- Watch mode (vault-wide file watcher beyond current-note on-save)
- Sidebar pane for persistent Q&A sessions
- macOS Keychain for API keys (plain text in `data.json` is the ecosystem norm)
- Modelfile imports for arbitrary GGUF (Ollama registry names + autocomplete is enough)
- Cross-vault KB sharing
- Mobile (Ollama doesn't run there)
- Templater integration helpers (beyond what works automatically via frontmatter + commands)
- Bases plugin API (spec says don't depend on v1.10+)

### Total timeline

**6 weeks of focused work** for a fully-featured, production-quality plugin in the community store. Each weekly milestone is releasable on its own.

---

## 11. Open questions to resolve before implementation

1. **Final vault path for the plugin's source repo.** This spec is at `/Users/dominiqueleca/tools/llm-wiki-plugin/docs/superpowers/specs/`. Confirm or relocate before phase 1 begins.

2. **Filter threshold defaults.** Initial defaults proposed (≥2 facts, ≥2 sources, ≥500-char source content, skip clipping-only). To be tuned against real KB data from the overnight extraction run.

3. **Scheduler implementation choice.** macOS-friendly cron-like scheduling inside an Obsidian plugin: simple `setInterval` loop checking `now >= nextRun` works well enough; revisit if users want richer scheduling expressions.

4. **Ollama library catalog source.** Whether to scrape `https://ollama.com/library` HTML or call an undocumented JSON endpoint. Decision deferred to Phase 5 implementation.

5. **`obsidian-tests-runner` viability for E2E.** If unstable, fall back to a custom `obsidian://` URL automation harness. Decision deferred to Phase 6.

---

## 12. References

- Existing Python tool: `~/tools/llm-wiki/` (zero-dependency Python CLI; the source of truth this design ports)
- Karpathy LLM Wiki pattern: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Obsidian Plugin API: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- Obsidian Bases (v1.9+): https://help.obsidian.md/bases
- The user's own spec on Obsidian Ecosystem Integration (provided in conversation): hard rules on flat YAML, kebab-case, Bases compatibility, `processFrontMatter` API usage, command palette integration, file encoding/portability
