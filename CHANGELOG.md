# Changelog

All notable changes to LM Wiki are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.7] — 2026-06-15

### Changed
- Release workflow now generates GitHub artifact attestations
  (`actions/attest-build-provenance@v2`) for `main.js`, `manifest.json`,
  and `styles.css`, so users can cryptographically verify each release
  asset was built from this repository. No runtime code change.

## [1.0.6] — 2026-06-14

### Changed
- Plugin id renamed from `llm-wiki-plugin` to `lm-wiki`. The Obsidian
  community directory's automated review rejects plugin ids that end in
  `-plugin` ("redundant suffix"); the 1.0.4 id was chosen before that
  rule was in place. Existing installs auto-migrate user data (settings,
  chat history, embeddings cache, interaction logs) into the new
  `.obsidian/plugins/lm-wiki/` folder on first load. Both prior folders
  (`llm-wiki/` and `llm-wiki-plugin/`) are kept as backups.
- Removed all `!important` declarations from the query modal styles,
  replacing them with `body`-prefixed selectors that beat Obsidian's
  defaults via specificity rather than override force.
- Switched `text-decoration-style: dotted` longhand to the shorthand
  `text-decoration: underline dotted` for broader Electron support.

## [1.0.5] — 2026-05-25

### Changed
- Plugin display name renamed from "LLM Wiki" to "LM Wiki" to resolve a
  collision with another community plugin that registered the same name.
  The plugin id (`llm-wiki-plugin`), GitHub repo, runtime folder, and
  all stored data are unchanged.

## [1.0.4] — 2026-05-25

### Changed
- Plugin id renamed from `llm-wiki` to `llm-wiki-plugin`. Existing
  installs auto-migrate user data (settings, chat history, embeddings
  cache, interaction logs) into the new folder on first load. The old
  `.obsidian/plugins/llm-wiki/` folder is kept as a backup.

### Fixed
- On-save extraction no longer spams "extract failed" notices when the
  provider is unreachable. The on-save path now preflight-pings the
  provider and surfaces a single "auto-indexing paused" notice per
  outage. Manual extractions are unaffected.

## [1.0.1] — 2026-04-11

### Added
- **Mistral** as a built-in LLM provider. (#1, thanks @StefKors)
- **Multi-folder index**: pick one or more vault folders to include in the
  knowledge base. If none are picked, the whole vault is used.
  (#4, thanks @StefKors)
- **Custom OpenAI-compatible provider**: configure your own base URL, API
  key, and model to use any OpenAI-compatible endpoint. (#6, thanks @StefKors)
- **Extraction output language** setting, including Dutch.
  (#7, thanks @StefKors)
- Content-based extraction dedupe using SHA-256 hashes. Replaces the
  previous modification-time check, which could re-extract unchanged notes
  when iCloud touched file timestamps.

### Changed
- Extraction now respects the folder scope set for queries. Previously it
  ran against the whole vault regardless of your folder selection.
  (#5, thanks @StefKors)
- Multi-folder settings UI restyled to match Obsidian's native look.
- README: reframed features into three buckets and expanded the manual
  install instructions.

### Fixed
- Model/folder picker popover: clipping at screen edges, missing selection
  checkmark, long-name truncation, and toggle behavior.

## [1.0.0] — 2026-04-10

Initial public release.
