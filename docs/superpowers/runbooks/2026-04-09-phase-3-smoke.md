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

## Async embedding index (post-Phase-3 follow-up)

- [ ] Cold start with `prebuildEmbeddingIndex = true`: launch Obsidian, wait ~2s, then immediately press Cmd+Shift+K. The modal should open instantly. The "Building index…" line either flashes briefly or is already "Ready".
- [ ] Cold start with `prebuildEmbeddingIndex = false`: relaunch Obsidian, immediately press Cmd+Shift+K. The modal should open instantly. The input should be disabled and the status line should show `Building index… N / M` with the counter advancing. When the build finishes, the input should focus and accept typing.
- [ ] Disconnect Ollama (or stop the server), then open the query modal cold. The status line should show `Embedding index unavailable (...) — keyword-only fallback` and the input should still become enabled. A query should still complete using keyword retrieval.
- [ ] With the modal already open and the build in progress, close the modal and reopen it. The new modal should pick up the in-flight build (no double build), and the input should enable as soon as the build finishes.
