# LLM Wiki for Obsidian

**Prompt your knowledge base privately, on your own hardware, with the model of your choice.**

LLM Wiki turns your Obsidian vault into a queryable knowledge base. It extracts entities, concepts, and relationships from your notes into a structured store, then answers natural-language questions against that store using a local LLM. Nothing leaves your laptop. Nothing is billed per token.

## Why

- **Private by default.** Your notes and your questions are processed on your machine by a local Ollama model. No API keys, no upload, no telemetry.
- **Zero inference cost.** You pay for electricity, not tokens. Ask as many questions as you want, iterate on prompts, re-index whenever.
- **Grounded in your actual notes.** Every answer cites the source files it came from, so you can verify the claim and jump back to the original.
- **Works offline.** Once the models are pulled, the whole pipeline runs without a network.

## Features

### Structured knowledge extraction
Walks your vault and uses a local LLM to pull out:
- **Entities** — people, organizations, tools, projects, books, articles, places, events
- **Concepts** — definitions and the ideas they relate to
- **Connections** — how entities and concepts relate (`influences`, `uses`, `critiques`, `extends`, `part-of`, `created-by`, `related-to`, `applies-to`, `contrasts-with`)
- **Sources** — a record of every note that contributed to the knowledge base

Everything lands in `wiki/knowledge.json`, a single structured file you can inspect, version with git, or feed to other tools.

### Natural-language query modal
Press **Cmd+Shift+K** (or click the ribbon icon) and ask your vault anything:
- *"What does Kieran think about Rails service objects?"*
- *"Which books on focus have I read this year?"*
- *"Projects that use Claude in some form"*

Answers stream token by token with cited source notes listed below.

### Hybrid retrieval
Every question runs through three rankers in parallel — keyword matching, semantic embeddings, and path-based scoring — then fuses them with Reciprocal Rank Fusion. The plugin auto-classifies each question (entity lookup, category list, relational, conceptual) and adjusts the weights accordingly, so a *"who is Ada Lovelace"* question leans on keyword/embedding matches while a *"things that influenced X"* question leans on connections.

### Instant-open modal with background indexing
The first-ever query used to stall for several seconds while the embedding index built. Now the modal opens immediately and shows live `Building index… N / M` progress, with the input enabling the moment the build finishes. By default the index also pre-builds in the background a couple of seconds after Obsidian launches, so the first modal open of the session is almost always instant.

### Folder scoping
Restrict queries to a specific vault folder when you want to ask "just my work notes" or "just my reading list". Configurable globally in settings.

### Recent-questions history
Arrow-key navigation through recent questions, command-palette style. Useful for re-asking or tweaking a previous question without retyping.

### Graceful Ollama-down fallback
If the local Ollama server is unreachable, the plugin degrades to keyword-only retrieval instead of crashing the modal. You get a clear status banner and the input stays usable.

### Interaction log
Every Q&A (question, answer, sources, elapsed time, model) is appended to `.obsidian/plugins/llm-wiki/interactions/<date>.jsonl` so you can review your own query history, grep it, or feed it back to the LLM later.

### Status bar widget
Shows `🧠 LLM Wiki` when idle and `🧠 Indexing N/T · ETA` during extraction passes, with the ETA computed from the measured per-file rate after the first few files complete.

## Requirements

- **Obsidian** 1.5.0 or later (desktop only — mobile is not supported)
- **[Ollama](https://ollama.com)** running locally
- Two models pulled through Ollama:
  - A chat model for extraction and answering (default: `qwen2.5:7b`)
  - An embedding model for semantic search (default: `nomic-embed-text`)

Any recent Mac/PC that can run a 7B model at a reasonable speed is enough. A GPU helps but isn't required.

## Install

1. Start Ollama and pull the models:
   ```bash
   ollama serve
   ollama pull qwen2.5:7b
   ollama pull nomic-embed-text
   ```
2. Install LLM Wiki into your vault (community store submission is in the roadmap; until then, drop a build into `.obsidian/plugins/llm-wiki/`).
3. Enable the plugin in **Settings → Community plugins**.

## First run

1. Open **Settings → LLM Wiki → Indexing** and click **Run extraction**. The status bar shows live progress while it works.
2. When the status bar returns to `🧠 LLM Wiki`, your knowledge base is ready. You can inspect `wiki/knowledge.json` directly if you're curious.
3. Press **Cmd+Shift+K** and ask a question.

## Settings

### Indexing

| Setting | Default | What it does |
|---|---|---|
| Ollama URL | `http://localhost:11434` | Where the local Ollama server lives |
| Ollama model | `qwen2.5:7b` | Chat model used for extraction and answering |
| Extraction char limit | `12000` | Per-file character cap, to avoid blowing past the context window on long notes |
| Last run | *(shown)* | Timestamp of the most recent extraction pass |
| Run extraction | — | Walks the vault and extracts every new or modified file |
| Cancel | — | Stops an in-progress extraction at the next file boundary |

### Query

| Setting | Default | What it does |
|---|---|---|
| Embedding model | `nomic-embed-text` | Ollama model used to vectorize entities and questions |
| Default folder | *(whole vault)* | Restrict queries to this vault folder |
| Recent questions to remember | `5` | Number of previous questions kept in the up/down history (0–50) |
| Show source links in answer | on | Render cited sources as clickable links in the answer body |
| Pre-build embedding index on startup | on | Build the embedding index ~2s after Obsidian launches so the first modal open is instant. Disable to keep startup quiet at the cost of a one-time build on the first query. |

## Commands

| Command | Default hotkey |
|---|---|
| LLM Wiki: Ask knowledge base | **Cmd+Shift+K** |
| LLM Wiki: Show vocabulary | — |
| LLM Wiki: Run extraction now | — |
| LLM Wiki: Extract current file | — |
| LLM Wiki: Cancel running extraction | — |
| LLM Wiki: Reload knowledge base from disk | — |

All commands are remappable via **Settings → Hotkeys**.

## Privacy and safety

- **Nothing leaves your machine.** Every LLM call is routed to your local Ollama instance. The plugin makes zero outbound network calls to any third party, and there is no telemetry.
- **The plugin can only write to two places:** `wiki/` (knowledge base output) and `.obsidian/plugins/llm-wiki/` (its own data folder). This is enforced by a path allowlist in the vault-write layer, a custom ESLint rule that fails CI on any direct vault write outside the safety layer, and manual smoke-testing before each release.
- **Your existing notes are never modified.** The plugin only reads them.

## Roadmap

LLM Wiki is under active development. Current status:

| Phase | Goal | Status |
|---|---|---|
| 1 — Foundation | Core KB types + vault safety layer | Shipped |
| 2 — Extraction | Ollama-backed structured extraction | Shipped (beta) |
| 3 — Query | Modal with streaming answers + hybrid retrieval | Shipped |
| 4 — Page generation | Per-entity / per-concept markdown pages browsable via Obsidian Bases | Next |
| 5 — Cloud + dream + scheduling | OpenAI/Anthropic/Google providers, nightly re-rank pass, scheduled re-extraction | Planned |
| 6 — Onboarding + store submission | First-run flow + community-store listing | Planned |

Ideas under consideration (not yet planned):
- **Save answer as note** — one-click turn a streamed answer into a markdown file in your vault.
- **Per-query model override** — switch chat or embedding model on a single query without touching settings.
- **Entity/concept browser** — a side panel listing everything in the KB with counts and jump-to-source.

Design spec lives at `docs/superpowers/specs/2026-04-07-llm-wiki-obsidian-plugin-design.md`.

## Development

```bash
npm install
npm test           # vitest suite
npm run typecheck  # strict TypeScript check
npm run lint       # ESLint with custom no-direct-vault-write rule
npm run build      # production build → main.js
npm run dev        # watch-mode build for local development
```

## License

MIT
