# LLM Wiki — Obsidian Plugin

Local-first LLM-powered knowledge base for your Obsidian vault.
Port of the existing [Python CLI tool](../llm-wiki/) into a first-class Obsidian community plugin.

## Status

**Phase 1 — Foundation (current).** A loadable plugin with the core knowledge-base
data structures, the vault I/O safety layer, and a single read-only command:
`LLM Wiki: Show vocabulary`. **No extraction. No querying. No page generation yet.**

This phase exists to prove the foundation works end-to-end before building on it.

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 — Foundation | core/ + vault/ + safety + smoke test | **In progress** |
| 2 — Extraction | Ollama-backed knowledge extraction from vault files | Not started |
| 3 — Query | Cmd+K modal with streamed answers | Not started |
| 4 — Page generation | Bases-compatible entity/concept/source markdown pages | Not started |
| 5 — Cloud + dream + scheduling | OpenAI/Anthropic/Google + nightly pass + ranker boost | Not started |
| 6 — Onboarding + store submission | First-run flow + community store | Not started |

See the design spec at `docs/superpowers/specs/2026-04-07-llm-wiki-obsidian-plugin-design.md`
and the Phase 1 plan at `docs/superpowers/plans/2026-04-07-phase-1-foundation.md`.

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
