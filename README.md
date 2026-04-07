# LLM Wiki — Obsidian Plugin

Local-first LLM-powered knowledge base for your Obsidian vault.
Port of the existing [Python CLI tool](../llm-wiki/) into a first-class Obsidian community plugin.

## Status

**Phase 2 — Extraction Beta (shipped).** The plugin now extracts a structured
knowledge base from your vault using a local Ollama model. Page generation,
querying, and cloud providers are still ahead.

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 — Foundation | core/ + vault/ + safety + smoke test | **Shipped** |
| 2 — Extraction | Ollama-backed knowledge extraction from vault files | **Shipped (beta)** |
| 3 — Query | Cmd+K modal with streamed answers | Not started |
| 4 — Page generation | Bases-compatible entity/concept/source markdown pages | Not started |
| 5 — Cloud + dream + scheduling | OpenAI/Anthropic/Google + nightly pass + ranker boost | Not started |
| 6 — Onboarding + store submission | First-run flow + community store | Not started |

See the design spec at `docs/superpowers/specs/2026-04-07-llm-wiki-obsidian-plugin-design.md`,
the Phase 1 plan at `docs/superpowers/plans/2026-04-07-phase-1-foundation.md`,
and the Phase 2 plan at `docs/superpowers/plans/2026-04-08-phase-2-extraction.md`.

## Phase 1 — Foundation

A loadable plugin with the core knowledge-base data structures, the vault I/O
safety layer, and a single read-only command: `LLM Wiki: Show vocabulary`.
This phase proved the foundation worked end-to-end before extraction was built
on top of it.

## Phase 2 — Extraction Beta

Phase 2 ships **vocabulary-aware structured extraction from your vault into
`wiki/knowledge.json`** using a local Ollama model. The extractor walks the
vault, dedupes entities/concepts against the existing vocabulary, and writes
results to a single shared JSON store with mtime-checked saves and idempotent
crash recovery.

**New commands:**
- `LLM Wiki: Run extraction now` — walks the whole vault and extracts every
  new or modified file.
- `LLM Wiki: Extract current file` — extracts only the active markdown file.
- `LLM Wiki: Cancel running extraction` — stops at the next file boundary.

**New settings section** (Settings → LLM Wiki → Indexing):
- **Ollama URL** (default `http://localhost:11434`)
- **Ollama model** (default `qwen2.5:7b`; Phase 5 will add a curated picker)
- **Last run** timestamp
- **Index now** button
- **Cancel** button

**Status bar widget:** shows `🧠 LLM Wiki` when idle and
`🧠 Indexing N/T · ETA` while a batch is running. ETA is measured-rate after
the first three files complete.

**Phase 2 deliberately does NOT do:**
- No per-entity / per-concept / per-source markdown pages (that is Phase 4)
- No cloud providers — Ollama only (Phase 5)
- No scheduler, no on-save extraction, no "dream" pass (Phase 5)
- No querying (Phase 3)

### How to use it

1. Install and start a local Ollama server:
   ```bash
   ollama serve
   ollama pull qwen2.5:7b
   ```
2. Install this plugin into your Obsidian vault.
3. Open Obsidian → Settings → LLM Wiki → Indexing → **Run extraction**.
4. Watch the status bar for progress; when it returns to `🧠 LLM Wiki`, the
   batch is done. Open `wiki/knowledge.json` to inspect the extracted KB, or
   run **LLM Wiki: Show vocabulary** for a quick summary.

## Development

```bash
npm install
npm test           # run all unit tests
npm run typecheck  # strict TypeScript check
npm run lint       # ESLint with custom no-direct-vault-write rule
npm run build      # production build → main.js
npm run dev        # watch-mode build for development
```

## Safety Guarantee

The plugin **never** writes outside `wiki/` and `.obsidian/plugins/llm-wiki/`.
Enforced at three layers:

1. A path allowlist in `src/vault/safe-write.ts` checked before every write
2. A custom ESLint rule (`no-direct-vault-write`) failing CI on any direct
   `app.vault.create()`, `app.vault.modify()`, or `app.vault.adapter.write()`
   call outside `src/vault/`
3. Manual smoke testing in a real Obsidian vault before each phase ships

## License

MIT
