# LLM Wiki

Turn your Obsidian vault into a queryable knowledge base. LLM Wiki extracts entities, concepts, and relationships from your notes, then lets you ask questions grounded in your own writing.

Runs locally with [Ollama](https://ollama.com) by default. Cloud providers (OpenAI, Anthropic, Google) are available as an option.

## Features

- **Structured extraction** — walks your vault and uses an LLM to pull out entities (people, organizations, tools, books, places, events), concepts (ideas, theories, frameworks), and the connections between them.
- **Chat-style query modal** — ask your vault questions in natural language. Answers stream token by token with clickable source links back to your notes.
- **Hybrid retrieval** — BM25 keyword matching, semantic embeddings, and path-based scoring fused with Reciprocal Rank Fusion. Question type is auto-classified to adjust ranker weights.
- **Page generation** — writes structured markdown pages for each entity, concept, and source into `wiki/` folders, compatible with Obsidian [Bases](https://obsidian.md/bases).
- **Multi-turn chat** — conversations are saved and resumable. Browse past chats from the query modal.
- **On-save re-extraction** — when you edit and save a note, it is re-extracted in the background.
- **Nightly scheduler** — configurable background re-indexing of the full vault (default: 2 AM).
- **Multiple providers** — Ollama (local, free), OpenAI, Anthropic, or Google. Switch in settings.

## Requirements

- Obsidian 1.5.0+ (desktop only)
- [Ollama](https://ollama.com) running locally (if using the default local provider)
- Two models pulled in Ollama:
  - A chat model for extraction and answering (default: `qwen2.5:7b`)
  - An embedding model for semantic search (default: `nomic-embed-text`)

## Install

1. Pull the models in Ollama:
   ```
   ollama pull qwen2.5:7b
   ollama pull nomic-embed-text
   ```
2. Install LLM Wiki from the Community Plugins browser, or manually drop a release into `.obsidian/plugins/llm-wiki/`.
3. Enable the plugin in Settings > Community plugins.

## Getting started

1. Open Settings > LLM Wiki. The defaults (Ollama at `localhost:11434`, `qwen2.5:7b`) work out of the box.
2. Run the command **LLM Wiki: Run extraction now** to build your knowledge base. Progress shows in the status bar.
3. Open the command palette and run **Ask knowledge base**, or click the ribbon icon.

To use a cloud provider instead, select it in settings and enter your API key.

## Commands

| Command | Description |
|---|---|
| Ask knowledge base | Open the query modal |
| Run extraction now | Re-index the entire vault |
| Extract current file | Re-extract only the active note |
| Cancel running extraction | Stop an in-progress extraction |
| Regenerate pages from KB | Rebuild all wiki pages |
| Reload knowledge base from disk | Reload `wiki/kb.json` without re-extracting |
| Show vocabulary | Inspect raw KB data |

## What it writes

All generated files live under `wiki/` in your vault:

```
wiki/
  kb.json            # knowledge base
  index.md           # catalog page
  entities/          # one page per entity
  concepts/          # one page per concept
  sources/           # one page per source note
```

The plugin only writes to `wiki/` and its own data folder. Your existing notes are never modified.

## Network access

This plugin connects to LLM providers for extraction and query answering:

- **Ollama (default)**: `http://localhost:11434` — local, no data leaves your machine
- **OpenAI** (optional): `api.openai.com`
- **Anthropic** (optional): `api.anthropic.com`
- **Google** (optional): `generativelanguage.googleapis.com`

Cloud providers are opt-in and require your own API key. No telemetry, analytics, or other network calls are made.

## Development

```bash
npm install
npm test           # vitest (472 tests)
npm run typecheck  # strict TypeScript
npm run lint       # ESLint
npm run build      # production build
npm run dev        # watch mode
```

## License

[MIT](LICENSE)
